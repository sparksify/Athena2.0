import { count, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  candidate,
  candidateSourceLink,
  event,
  identifier,
  identityReview,
  org,
} from "@athena/db/schema";
import { importFile } from "../src/ingest/import.js";
import { applyResolution, pendingReviews } from "../src/identity/resolve.js";
import { testDb } from "./helpers.js";

/** Two deterministic-distinct candidates that are really the same human. */
async function seedBobs() {
  const { db, client } = await testDb();
  const [o] = await db.insert(org).values({ name: "Test" }).returning();
  const orgId = o!.id;
  await importFile(db, {
    orgId, sourceType: "resume", filename: "a.csv",
    rows: [{ Name: "Robert Smith", Email: "robert@gmail.com", Phone: "214-555-0101", City: "Plano", State: "TX" }],
  });
  await importFile(db, {
    orgId, sourceType: "purchased", filename: "b.csv",
    rows: [{ first_name: "Bob", last_name: "Smith", email: "bob.smith@company.com", phone: "", city: "Plano", state: "TX" }],
  });
  const cands = await db.select().from(candidate).orderBy(candidate.createdAt);
  expect(cands).toHaveLength(2);
  const a = cands.find((c) => c.primaryEmail === "robert@gmail.com")!;
  const b = cands.find((c) => c.primaryEmail === "bob.smith@company.com")!;
  return { db, client, orgId, a, b };
}

describe("identity resolution — Phase 2", () => {
  it("auto-merges at ≥ 0.85, and split reverses the merge exactly", async () => {
    const { db, client, orgId, a, b } = await seedBobs();

    const res = await applyResolution(db, orgId, [
      { candidateAId: a.id, candidateBId: b.id, confidence: 0.92, evidence: { name: "jw 0.95" } },
    ]);
    expect(res).toEqual({ autoMerged: 1, queuedForReview: 0, ignored: 0, skipped: 0 });

    // b is merged, everything b owned now belongs to a
    const [bNow] = await db.select().from(candidate).where(eq(candidate.id, b.id));
    expect(bNow!.mergedIntoId).toBe(a.id);
    expect(bNow!.status).toBe("merged");
    expect((await db.select().from(identifier).where(eq(identifier.candidateId, a.id)))).toHaveLength(3);
    expect((await db.select().from(candidateSourceLink).where(eq(candidateSourceLink.candidateId, a.id)))).toHaveLength(2);
    const merges = await db.select().from(event).where(eq(event.type, "identity.merged"));
    expect(merges).toHaveLength(1);

    // split restores b byte-for-byte
    const [review] = await db.select().from(identityReview);
    await db.execute(sql`select public.split_merge(${review!.id}::uuid)`);
    const [bAfter] = await db.select().from(candidate).where(eq(candidate.id, b.id));
    expect(bAfter!.mergedIntoId).toBeNull();
    expect(bAfter!.status).toBe("new");
    expect((await db.select().from(identifier).where(eq(identifier.candidateId, b.id)))).toHaveLength(1);
    expect((await db.select().from(candidateSourceLink).where(eq(candidateSourceLink.candidateId, b.id)))).toHaveLength(1);
    expect((await db.select().from(event).where(eq(event.type, "identity.split")))).toHaveLength(1);
    await client.close();
  });

  it("queues 0.60–0.85 for human review; merge from the review works; duplicates are skipped", async () => {
    const { db, client, orgId, a, b } = await seedBobs();

    const res = await applyResolution(db, orgId, [
      { candidateAId: a.id, candidateBId: b.id, confidence: 0.72 },
    ]);
    expect(res.queuedForReview).toBe(1);
    const pending = await pendingReviews(db, orgId);
    expect(pending).toHaveLength(1);

    // re-running resolution can't open a second review for the same pair
    const again = await applyResolution(db, orgId, [
      { candidateAId: b.id, candidateBId: a.id, confidence: 0.74 },
    ]);
    expect(again.skipped).toBe(1);

    // a human merges from the queue (same SQL function the UI calls)
    await db.execute(sql`select public.merge_candidates(${pending[0]!.id}::uuid)`);
    const [bNow] = await db.select().from(candidate).where(eq(candidate.id, b.id));
    expect(bNow!.mergedIntoId).toBe(a.id);

    // a later pair involving the merged candidate is skipped
    const later = await applyResolution(db, orgId, [
      { candidateAId: a.id, candidateBId: b.id, confidence: 0.9 },
    ]);
    expect(later.skipped).toBe(1);
    await client.close();
  });

  it("ignores pairs below 0.60 and supports rejecting a review", async () => {
    const { db, client, orgId, a, b } = await seedBobs();
    const low = await applyResolution(db, orgId, [
      { candidateAId: a.id, candidateBId: b.id, confidence: 0.4 },
    ]);
    expect(low.ignored).toBe(1);
    expect((await db.select({ n: count() }).from(identityReview))[0]!.n).toBe(0);

    await applyResolution(db, orgId, [{ candidateAId: a.id, candidateBId: b.id, confidence: 0.65 }]);
    const [review] = await db.select().from(identityReview);
    await db.execute(sql`select public.reject_review(${review!.id}::uuid)`);
    const [after] = await db.select().from(identityReview);
    expect(after!.status).toBe("rejected");
    // both candidates untouched
    const cands = await db.select().from(candidate);
    expect(cands.every((c) => c.mergedIntoId === null)).toBe(true);
    expect((await db.select().from(event).where(eq(event.type, "identity.review_rejected")))).toHaveLength(1);
    await client.close();
  });

  it("merge is safe when both candidates share a source record (dropped link restored on split)", async () => {
    const { db, client, orgId, a, b } = await seedBobs();
    // simulate Phase-2 discovering both candidates relate to one source record
    const [linkA] = await db.select().from(candidateSourceLink).where(eq(candidateSourceLink.candidateId, a.id));
    await db.insert(candidateSourceLink).values({
      orgId, candidateId: b.id, sourceRecordId: linkA!.sourceRecordId, confidence: "1.0", method: "manual",
    });

    await applyResolution(db, orgId, [{ candidateAId: a.id, candidateBId: b.id, confidence: 0.95 }]);
    // no duplicate pair rows on a
    const linksOnA = await db.select().from(candidateSourceLink).where(eq(candidateSourceLink.candidateId, a.id));
    expect(new Set(linksOnA.map((l) => l.sourceRecordId)).size).toBe(linksOnA.length);

    const [review] = await db.select().from(identityReview);
    await db.execute(sql`select public.split_merge(${review!.id}::uuid)`);
    const linksOnB = await db.select().from(candidateSourceLink).where(eq(candidateSourceLink.candidateId, b.id));
    expect(linksOnB).toHaveLength(2); // its own + the restored shared link
    await client.close();
  });
});
