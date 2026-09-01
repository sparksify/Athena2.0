import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  candidate,
  candidateSourceLink,
  event,
  financialProfile,
  interaction,
  org,
  questionnaire,
  scoreSnapshot,
  suppression,
} from "@athena/db/schema";
import { importFile } from "../src/ingest/import.js";
import { computeScore, explainScore, scoreCandidates, SCORE_VERSION } from "../src/intelligence/score.js";
import type { ScoringContext } from "../src/intelligence/types.js";
import { testDb } from "./helpers.js";

const NOW = new Date("2026-09-01T00:00:00Z");

function baseCtx(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return {
    candidate: { id: "c1", fullName: "Robert Smith", city: "Plano", state: "TX" },
    latestActivityAt: null,
    sourceTypes: ["resume"],
    interactions: [],
    hasCqComplete: false,
    hasCqPartial: false,
    liquidityUsd: null,
    attributes: {},
    emailVerification: null,
    hasEmail: true,
    hasPhone: true,
    suppressed: false,
    now: NOW,
    ...overrides,
  };
}

describe("computeScore — pure factor math", () => {
  it("a fully-loaded historical candidate scores like a 91", () => {
    const { score, factors } = computeScore(
      baseCtx({
        latestActivityAt: new Date("2026-06-01T00:00:00Z"), // ~3 months
        interactions: [
          { type: "meeting", direction: "inbound", occurredAt: new Date("2026-06-01"), payload: { outcome: "showed" } },
        ],
        hasCqComplete: true,
        liquidityUsd: 250_000,
        attributes: { franchise_interest: "home services" },
        emailVerification: "valid",
      }),
    );
    // 20 recency + 12 engagement + 15 CQ + 15 financial + 8 appointment
    // + 5 showed + 8 interest + 5 geography + 10 contactable + 0 + 4 resume = 102 → 100
    expect(score).toBe(100);
    expect(factors).toHaveLength(11);
    expect(factors.every((f) => typeof f.reason === "string" && f.reason.length > 0)).toBe(true);
  });

  it("a suppressed candidate is floored to zero no matter what else is true", () => {
    const { score, factors } = computeScore(
      baseCtx({ suppressed: true, hasCqComplete: true, liquidityUsd: 500_000, emailVerification: "valid" }),
    );
    expect(score).toBe(0);
    expect(factors.find((f) => f.factor === "prior_opt_out")!.points).toBe(-100);
  });

  it("a bare purchased record with nothing known scores low", () => {
    const { score } = computeScore(
      baseCtx({ sourceTypes: ["purchased"], candidate: { id: "c", fullName: null, city: null, state: null }, hasEmail: true, hasPhone: false }),
    );
    // 5 cold recency + 2 unverified email + 2 purchased = 9
    expect(score).toBe(9);
  });

  it("no-show history subtracts", () => {
    const withShow = computeScore(baseCtx({
      interactions: [{ type: "meeting", direction: "inbound", occurredAt: new Date("2024-01-01"), payload: { outcome: "showed" } }],
      latestActivityAt: new Date("2024-01-01"),
    }));
    const withNoShow = computeScore(baseCtx({
      interactions: [{ type: "meeting", direction: "inbound", occurredAt: new Date("2024-01-01"), payload: { outcome: "no_show" } }],
      latestActivityAt: new Date("2024-01-01"),
    }));
    expect(withShow.score - withNoShow.score).toBe(10); // +5 vs -5
  });
});

describe("scoreCandidates — persistence and idempotency", () => {
  it("scores, explains, re-scores idempotently, and reacts to new facts", async () => {
    const { db, client } = await testDb();
    const [o] = await db.insert(org).values({ name: "Test" }).returning();
    const orgId = o!.id;
    await importFile(db, {
      orgId, sourceType: "resume", filename: "r.csv",
      rows: [
        { Name: "Robert Smith", Email: "robert@gmail.com", Phone: "214-555-0101", City: "Plano", State: "TX" },
        { Name: "Jane Roe", Email: "jane@example.com", Phone: "", City: "", State: "" },
      ],
    });

    const first = await scoreCandidates(db, orgId, { now: NOW });
    expect(first.scored).toBe(2);
    expect(first.unchanged).toBe(0);

    // proof: re-scoring is idempotent — zero new snapshots
    const second = await scoreCandidates(db, orgId, { now: NOW });
    expect(second).toEqual({ scored: 0, unchanged: 2 });
    expect((await db.select({ n: count() }).from(scoreSnapshot))[0]!.n).toBe(2);

    // proof: the explanation returns the factor table
    const [robert] = await db.select().from(candidate).where(eq(candidate.primaryEmail, "robert@gmail.com"));
    const explanation = await explainScore(db, orgId, robert!.id);
    expect(explanation).not.toBeNull();
    expect(explanation!.version).toBe(SCORE_VERSION);
    const factors = explanation!.factors as { factor: string; points: number; reason: string }[];
    expect(factors.map((f) => f.factor)).toContain("contactability");
    expect(factors.reduce((s, f) => s + f.points, 0)).toBeGreaterThanOrEqual(explanation!.score);
    expect(robert!.currentScore).toBe(explanation!.score);

    // new facts change the score: CQ + financials + a showed meeting
    const [link] = await db.select().from(candidateSourceLink).where(eq(candidateSourceLink.candidateId, robert!.id));
    await db.insert(questionnaire).values({
      orgId, candidateId: robert!.id, kind: "cq_complete", sourceRecordId: link!.sourceRecordId,
    });
    await db.insert(financialProfile).values({
      orgId, candidateId: robert!.id, liquidityUsd: "250000", sourceRecordId: link!.sourceRecordId,
    });
    await db.insert(interaction).values({
      orgId, candidateId: robert!.id, type: "meeting", direction: "inbound",
      occurredAt: new Date("2026-06-01"), payload: { outcome: "showed" }, sourceRecordId: link!.sourceRecordId,
    });

    const third = await scoreCandidates(db, orgId, { now: NOW });
    expect(third.scored).toBe(1); // only Robert changed
    const after = await explainScore(db, orgId, robert!.id);
    expect(after!.score).toBeGreaterThan(explanation!.score);
    expect((await db.select({ n: count() }).from(event).where(eq(event.type, "candidate.scored")))[0]!.n).toBe(3);
    await client.close();
  });

  it("suppression floors a persisted score to 0", async () => {
    const { db, client } = await testDb();
    const [o] = await db.insert(org).values({ name: "Test" }).returning();
    const orgId = o!.id;
    await importFile(db, {
      orgId, sourceType: "resume", filename: "r.csv",
      rows: [{ Name: "Opted Out", Email: "optout@example.com", Phone: "", City: "Plano", State: "TX" }],
    });
    await db.insert(suppression).values({
      orgId, channel: "email", identifier: "optout@example.com", reason: "unsubscribed", source: "athena1_import",
    });
    await scoreCandidates(db, orgId, { now: NOW });
    const [c] = await db.select().from(candidate);
    expect(c!.currentScore).toBe(0);
    const explanation = await explainScore(db, orgId, c!.id);
    const optOut = (explanation!.factors as { factor: string; reason: string }[]).find(
      (f) => f.factor === "prior_opt_out",
    );
    expect(optOut!.reason).toContain("do not contact");
    await client.close();
  });
});
