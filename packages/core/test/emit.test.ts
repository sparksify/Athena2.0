import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { agentJob, candidate, event, org } from "@athena/db/schema";
import { emit } from "../src/events/emit.js";
import { testDb } from "./helpers.js";

describe("emit()", () => {
  it("commits state row, event, and enqueued job together", async () => {
    const { db, client } = await testDb();
    const [o] = await db.insert(org).values({ name: "Test" }).returning();

    await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(candidate)
        .values({ orgId: o!.id, fullName: "Jane Doe" })
        .returning();
      await emit(tx, {
        orgId: o!.id,
        type: "candidate.created",
        entityType: "candidate",
        entityId: c!.id,
        enqueue: [{ type: "research.candidate", payload: { candidateId: c!.id } }],
      });
    });

    expect((await db.select({ n: count() }).from(candidate))[0]!.n).toBe(1);
    expect((await db.select({ n: count() }).from(event))[0]!.n).toBe(1);
    const jobs = await db.select().from(agentJob);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe("queued");
    await client.close();
  });

  it("rolls back state row, event, and job when the transaction fails", async () => {
    const { db, client } = await testDb();
    const [o] = await db.insert(org).values({ name: "Test" }).returning();

    await expect(
      db.transaction(async (tx) => {
        const [c] = await tx
          .insert(candidate)
          .values({ orgId: o!.id, fullName: "Ghost" })
          .returning();
        await emit(tx, {
          orgId: o!.id,
          type: "candidate.created",
          entityType: "candidate",
          entityId: c!.id,
          enqueue: [{ type: "research.candidate" }],
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect((await db.select({ n: count() }).from(candidate))[0]!.n).toBe(0);
    expect((await db.select({ n: count() }).from(event))[0]!.n).toBe(0);
    expect((await db.select({ n: count() }).from(agentJob))[0]!.n).toBe(0);
    await client.close();
  });
});
