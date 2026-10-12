import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { CrmContactHistory, CrmReader, LlmProvider } from "@athena/contracts";
import { agentJob, candidate, candidateAttribute, costRecord, event, identifier, interaction, org, suppression } from "@athena/db/schema";
import { drainCrmLookups, enqueueCrmLookups, enrichFromCrm } from "../src/ingest/crm-enrich";
import { importFile } from "../src/ingest/import";
import { drainResearch, enqueueResearch, researchCandidate, RESEARCH_DAILY_BUDGET_USD } from "../src/intelligence/research";
import { explainScore, scoreCandidates } from "../src/intelligence/score";
import { LlmGateway } from "../src/llm/gateway";
import { testDb } from "./helpers";

type Db = Awaited<ReturnType<typeof testDb>>["db"];
let db: Db;
beforeEach(async () => { db = (await testDb()).db; });

const D = (s: string) => new Date(s);
function history(over: Partial<CrmContactHistory> = {}): CrmContactHistory {
  return {
    contactRef: "ghl-c1", tags: ["4EverCharge", "trade-show-2025"], dnd: false, source: "Trade show", addedAt: D("2025-03-01"), assignedTo: "Rob Petka", customFields: { budget: "250k" },
    opportunities: [{ ref: "o1", name: "Pat Example", pipeline: "FCC", stage: "Talking to Zors", status: "open", valueUsd: 45000, createdAt: D("2025-03-02"), updatedAt: D("2026-06-10") }],
    messages: [
      { ref: "m1", channel: "email", direction: "outbound", occurredAt: D("2026-05-01T10:00:00Z"), subject: "Intro", body: "Hi Pat" },
      { ref: "m2", channel: "email", direction: "inbound", occurredAt: D("2026-05-02T10:00:00Z"), subject: "Re: Intro", body: "Sounds good, call me" },
      { ref: "m3", channel: "sms", direction: "outbound", occurredAt: D("2026-06-10T10:00:00Z"), subject: null, body: "Confirming Tuesday" },
    ],
    appointments: [{ ref: "a1", title: "Consult", startsAt: D("2026-06-12T15:00:00Z"), endsAt: D("2026-06-12T16:00:00Z"), status: "showed" }],
    notes: [{ ref: "n1", body: "Wants a home-services brand near Plano.", createdAt: D("2026-06-12") }],
    ...over,
  };
}
function reader(h: CrmContactHistory | null, calls: { email?: string | null; phone?: string | null }[] = []): CrmReader {
  return { name: "ghl", lookupContact: async (q) => { calls.push(q); return h; } };
}
function llmReturning(json: unknown, costUsd = 0.03): LlmGateway {
  const p: LlmProvider = { name: "mock", complete: async () => ({ text: JSON.stringify(json), json, model: "mock", inputTokens: 100, outputTokens: 50, costUsd, searches: 3, sources: ["https://example.com/pat"] }) };
  return new LlmGateway(p, db);
}

async function seedViaImport() {
  const [o] = await db.insert(org).values({ name: "T" }).returning({ id: org.id });
  const orgId = o!.id;
  const { report } = await importFile(db, {
    orgId, sourceType: "tradeshow", filename: "show.csv",
    rows: [{ "First Name": "Pat", "Last Name": "Example", Email: "pat@example.com", Phone: "+1 555 000 1111", City: "Plano", State: "TX" }],
  });
  const [c] = await db.select().from(candidate).where(eq(candidate.orgId, orgId));
  return { orgId, candidateId: c!.id, report };
}

describe("CRM enrichment on import", () => {
  it("import queues one crm.lookup per candidate; the lookup lands attributes, timeline and events with provenance", async () => {
    const { orgId, candidateId, report } = await seedViaImport();
    expect(report.crmLookupsQueued).toBe(1);
    const [job] = await db.select().from(agentJob).where(eq(agentJob.type, "crm.lookup"));
    expect(job!.payload).toEqual({ candidateId });

    const calls: { email?: string | null; phone?: string | null }[] = [];
    const r = await enrichFromCrm(db, reader(history(), calls), { id: job!.id, orgId, candidateId });
    expect(r.outcome).toBe("enriched");
    expect(calls[0]).toEqual({ email: "pat@example.com", phone: "+15550001111" });

    const attrs = await db.select().from(candidateAttribute).where(eq(candidateAttribute.candidateId, candidateId));
    const byKey = Object.fromEntries(attrs.map((a) => [a.key, a.value]));
    expect(byKey.crm_stage).toBe("Talking to Zors");
    expect(byKey.crm_opportunity_status).toBe("open");
    expect(byKey.crm_tags).toEqual(["4EverCharge", "trade-show-2025"]);
    expect(byKey.crm_messages_in).toBe(1);
    expect(byKey.crm_notes).toContain("home-services");
    expect(attrs.every((a) => a.agentJobId === job!.id)).toBe(true);

    const timeline = await db.select().from(interaction).where(eq(interaction.candidateId, candidateId));
    expect(timeline.map((i) => i.type).sort()).toEqual(["email_reply", "email_sent", "meeting", "sms"]);
    expect(timeline.find((i) => i.type === "meeting")!.payload).toMatchObject({ outcome: "showed" });
    expect(await db.select().from(event).where(eq(event.type, "candidate.crm_enriched"))).toHaveLength(1);
    expect((await db.select().from(costRecord).where(eq(costRecord.agentJobId, job!.id)))[0]!.category).toBe("other");
    expect((await db.select().from(agentJob).where(eq(agentJob.id, job!.id)))[0]!.status).toBe("succeeded");
  });

  it("re-running supersedes attributes and never duplicates the timeline; DND lands in suppression", async () => {
    const { orgId, candidateId } = await seedViaImport();
    const [job] = await db.select().from(agentJob).where(eq(agentJob.type, "crm.lookup"));
    await enrichFromCrm(db, reader(history()), { id: job!.id, orgId, candidateId });
    // second run with the same history plus DND and a moved stage
    const [job2] = await db.insert(agentJob).values({ orgId, type: "crm.lookup", payload: { candidateId } }).returning({ id: agentJob.id });
    const h2 = history({ dnd: true, opportunities: [{ ...history().opportunities[0]!, stage: "D-Day Scheduled" }] });
    const r = await enrichFromCrm(db, reader(h2), { id: job2!.id, orgId, candidateId });
    expect(r).toMatchObject({ outcome: "enriched", interactions: 0, suppressed: true });
    const live = await db.select().from(candidateAttribute).where(and(eq(candidateAttribute.candidateId, candidateId), eq(candidateAttribute.key, "crm_stage")));
    expect(live.filter((a) => a.supersededById == null).map((a) => a.value)).toEqual(["D-Day Scheduled"]);
    expect(live).toHaveLength(2);
    expect(await db.select().from(interaction).where(eq(interaction.candidateId, candidateId))).toHaveLength(4);
    const sup = await db.select().from(suppression).where(eq(suppression.orgId, orgId));
    expect(sup.map((s) => `${s.channel}:${s.identifier}`).sort()).toEqual(["email:pat@example.com", "sms:+15550001111"]);
  });

  it("someone the CRM has never seen is recorded as checked, not failed; drain and backfill are idempotent", async () => {
    const { orgId, candidateId } = await seedViaImport();
    const s = await drainCrmLookups(db, reader(null), { orgId });
    expect(s).toMatchObject({ enriched: 0, notInCrm: 1, failed: 0 });
    expect(await db.select().from(event).where(eq(event.type, "candidate.crm_checked"))).toHaveLength(1);
    expect(await enqueueCrmLookups(db, orgId)).toBe(0); // already checked
    expect(await enqueueCrmLookups(db, orgId, { force: true })).toBe(1);
    expect(await drainCrmLookups(db, reader(null), { orgId })).toMatchObject({ notInCrm: 1 });
    expect(await db.select().from(identifier).where(eq(identifier.candidateId, candidateId))).toHaveLength(2);
  });

  it("CRM history moves the score: recency, engagement, a showed meeting, and the pipeline stage all count", async () => {
    const { orgId, candidateId } = await seedViaImport();
    await scoreCandidates(db, orgId, { now: D("2026-09-01") });
    const before = (await explainScore(db, orgId, candidateId))!;
    const [job] = await db.select().from(agentJob).where(eq(agentJob.type, "crm.lookup"));
    await enrichFromCrm(db, reader(history()), { id: job!.id, orgId, candidateId });
    await scoreCandidates(db, orgId, { now: D("2026-09-01") });
    const after = (await explainScore(db, orgId, candidateId))!;
    expect(after.score).toBeGreaterThan(before.score + 30);
    type F = { factor: string; points: number; reason: string };
    const f = Object.fromEntries((after.factors as F[]).map((x) => [x.factor, x]));
    expect(f.crm_pipeline!.points).toBe(10);
    expect(f.prior_engagement!.points).toBe(12);
    expect(f.recency!.points).toBeGreaterThan(0);
    expect(f.interest_known!.reason).toMatch(/4EverCharge|interest/i);
    // a won deal is already a franchisee: pushed down
    const [job2] = await db.insert(agentJob).values({ orgId, type: "crm.lookup", payload: { candidateId } }).returning({ id: agentJob.id });
    await enrichFromCrm(db, reader(history({ opportunities: [{ ...history().opportunities[0]!, status: "won" }] })), { id: job2!.id, orgId, candidateId });
    await scoreCandidates(db, orgId, { now: D("2026-09-01") });
    expect(Object.fromEntries(((await explainScore(db, orgId, candidateId))!.factors as F[]).map((x) => [x.factor, x.points])).crm_pipeline).toBe(-10);
  });
});

describe("research step", () => {
  async function seedScored(score: number) {
    const s = await seedViaImport();
    await db.update(candidate).set({ currentScore: score }).where(eq(candidate.id, s.candidateId));
    return s;
  }

  it("queues only candidates at or above the floor, writes a sourced note with provenance, and records the spend as research", async () => {
    const { orgId, candidateId } = await seedScored(82);
    expect(await enqueueResearch(db, orgId, { minScore: 70 })).toBe(1);
    expect(await enqueueResearch(db, orgId, { minScore: 70 })).toBe(0); // no double queue
    const llm = llmReturning({ found: true, note: "Pat runs a plumbing company in Plano and recently sold a second location.", currentRole: "Owner", company: "Example Plumbing", location: "Plano, TX", signals: ["owns a business"] });
    const s = await drainResearch(db, llm, { orgId });
    expect(s).toMatchObject({ researched: 1, failed: 0 });
    const attrs = Object.fromEntries((await db.select().from(candidateAttribute).where(eq(candidateAttribute.candidateId, candidateId))).map((a) => [a.key, a]));
    expect(String(attrs.research_note!.value)).toContain("plumbing");
    expect(attrs.research_sources!.value).toEqual(["https://example.com/pat"]);
    expect(attrs.research_note!.agentJobId).not.toBeNull();
    const [cost] = await db.select().from(costRecord).where(eq(costRecord.category, "llm"));
    expect(cost!.detail).toMatchObject({ purpose: "research", searches: 3 });
    expect(await enqueueResearch(db, orgId, { minScore: 70 })).toBe(0); // note exists
    // below the floor: never queued
    const [o2] = await db.insert(org).values({ name: "T2" }).returning({ id: org.id });
    await db.insert(candidate).values({ orgId: o2!.id, fullName: "Low Score", currentScore: 40 });
    expect(await enqueueResearch(db, o2!.id, { minScore: 70 })).toBe(0);
  });

  it("an unconfirmed identity writes nothing; the daily budget cap stops spend and leaves the job queued", async () => {
    const { orgId, candidateId } = await seedScored(90);
    await enqueueResearch(db, orgId);
    const [job] = await db.select().from(agentJob).where(eq(agentJob.type, "research.candidate"));
    const r = await researchCandidate(db, llmReturning({ found: false, note: "", currentRole: null, company: null, location: null, signals: [] }), { id: job!.id, orgId, candidateId });
    expect(r.outcome).toBe("nothing_found");
    expect(await db.select().from(candidateAttribute).where(and(eq(candidateAttribute.candidateId, candidateId), eq(candidateAttribute.key, "research_note")))).toHaveLength(0);
    // blow the budget, then try again
    await db.insert(costRecord).values({ orgId, category: "llm", provider: "mock", amountUsd: String(RESEARCH_DAILY_BUDGET_USD + 1), detail: { purpose: "research" } });
    const [job2] = await db.insert(agentJob).values({ orgId, type: "research.candidate", payload: { candidateId } }).returning({ id: agentJob.id });
    const r2 = await researchCandidate(db, llmReturning({ found: true, note: "x", currentRole: null, company: null, location: null, signals: [] }), { id: job2!.id, orgId, candidateId });
    expect(r2.outcome).toBe("over_budget");
    expect((await db.select().from(agentJob).where(eq(agentJob.id, job2!.id)))[0]!.status).toBe("queued");
    expect(await db.select().from(event).where(eq(event.type, "research.deferred"))).toHaveLength(1);
  });
});
