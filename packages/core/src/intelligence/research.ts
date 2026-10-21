import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { agentJob, candidate, candidateAttribute } from "@athena/db/schema";
import { emit, type EmitTx } from "../events/emit";
import type { LlmGateway } from "../llm/gateway";
import { rows } from "../db-rows";

export const RESEARCH_JOB_TYPE = "research.candidate";
export const RESEARCH_MODEL = process.env.RESEARCH_MODEL ?? "claude-sonnet-5";
/** Only candidates at or above this score get looked up (rule 8: spend where it pays). */
export const RESEARCH_MIN_SCORE = Number(process.env.RESEARCH_MIN_SCORE ?? 70);
/** Hard daily cap on research spend across the org, in USD. */
export const RESEARCH_DAILY_BUDGET_USD = Number(process.env.RESEARCH_DAILY_BUDGET_USD ?? 25);
const MAX_SEARCHES = 4;

export interface ResearchResult {
  outcome: "researched" | "nothing_found" | "over_budget" | "skipped" | "failed";
  costUsd?: number;
}

const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["found", "note", "currentRole", "company", "location", "signals"],
  properties: {
    found: { type: "boolean" },
    note: { type: "string" },
    currentRole: { type: ["string", "null"] },
    company: { type: ["string", "null"] },
    location: { type: ["string", "null"] },
    signals: { type: "array", items: { type: "string" } },
  },
} as const;

/** Research spend recorded today (UTC) for the org. */
export async function researchSpentToday(db: EmitTx, orgId: string, now = new Date()): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const r = rows<{ usd: string | number | null }>(await db.execute(sql`
    select coalesce(sum(amount_usd), 0) as usd from cost_record
    where org_id = ${orgId} and category = 'llm' and detail->>'purpose' = 'research' and created_at >= ${start.toISOString()}::timestamptz`));
  return Number(r[0]?.usd ?? 0);
}

/**
 * One sourced research note per high-scoring candidate: current role,
 * company, location and anything public that matters for a franchise
 * conversation. The model may only use what the search returns; the note
 * is stored with its sources and provenance, and the email writer and the
 * consultant brief already read `research_note`. Budget-capped per day.
 */
export async function researchCandidate(
  db: EmitTx,
  llm: LlmGateway,
  job: { id: string; orgId: string; candidateId: string; now?: Date },
): Promise<ResearchResult> {
  const now = job.now ?? new Date();
  const [claimed] = await db.update(agentJob).set({ status: "running", startedAt: now })
    .where(and(eq(agentJob.id, job.id), inArray(agentJob.status, ["queued", "failed"]))).returning({ id: agentJob.id });
  if (!claimed) return { outcome: "skipped" };

  const spent = await researchSpentToday(db, job.orgId, now);
  if (spent >= RESEARCH_DAILY_BUDGET_USD) {
    // Leave it queued for tomorrow; say so once.
    await db.update(agentJob).set({ status: "queued", startedAt: null }).where(eq(agentJob.id, job.id));
    await emit(db, { orgId: job.orgId, type: "research.deferred", entityType: "candidate", entityId: job.candidateId, payload: { reason: "daily_budget", spentUsd: spent, budgetUsd: RESEARCH_DAILY_BUDGET_USD } });
    return { outcome: "over_budget" };
  }

  const [c] = await db.select().from(candidate).where(eq(candidate.id, job.candidateId)).limit(1);
  if (!c) {
    await db.update(agentJob).set({ status: "failed", finishedAt: now, error: "candidate not found" }).where(eq(agentJob.id, job.id));
    return { outcome: "failed" };
  }
  const attrs = await db.select({ key: candidateAttribute.key, value: candidateAttribute.value }).from(candidateAttribute)
    .where(and(eq(candidateAttribute.candidateId, c.id), isNull(candidateAttribute.supersededById)));
  const known = attrs.filter((a) => !["research_note", "research_sources", "crm_notes", "crm_custom_fields"].includes(a.key))
    .map((a) => `- ${a.key}: ${JSON.stringify(a.value)}`).join("\n");
  const emailDomain = c.primaryEmail?.split("@")[1] ?? null;

  let out: { found?: boolean; note?: string; currentRole?: string | null; company?: string | null; location?: string | null; signals?: string[] } | undefined;
  let sources: string[] = [];
  let costUsd = 0;
  try {
    const res = await llm.complete(
      {
        model: RESEARCH_MODEL,
        system: [
          "You research one person for a franchise consulting firm that helps people buy a franchise. Use web search to find public, professional information only: current role and employer, location, business ownership, career changes, anything that bears on whether they could fund and run a franchise.",
          "Rules: never guess; if you cannot confirm it is the same person (same name AND a matching city, employer, or email domain), say found=false and leave the note empty. No personal life, no family, no health, no politics. Note 60-120 words, plain prose, each fact traceable to a search result. signals = short tags like 'recent job change', 'owns a business', 'laid off', 'senior operator'.",
        ].join("\n"),
        messages: [{ role: "user", content: [
          `Name: ${c.fullName ?? "unknown"}`, `Location: ${[c.city, c.state].filter(Boolean).join(", ") || "unknown"}`,
          `Email domain: ${emailDomain ?? "unknown"}`, "What we already know:", known || "- (nothing beyond the above)",
          "Search, then answer.",
        ].join("\n") }],
        maxTokens: 1500,
        jsonSchema: SCHEMA as unknown as Record<string, unknown>,
        webSearch: { maxSearches: MAX_SEARCHES },
      },
      { orgId: job.orgId, agentJobId: job.id, traceName: "research.candidate", purpose: "research" },
    );
    out = res.json as typeof out;
    sources = res.sources ?? [];
    costUsd = res.costUsd;
  } catch (err) {
    await db.update(agentJob).set({ status: "failed", finishedAt: new Date(), error: String(err) }).where(eq(agentJob.id, job.id));
    return { outcome: "failed" };
  }

  return db.transaction(async (tx) => {
    if (!out?.found || !out.note?.trim()) {
      await tx.update(agentJob).set({ status: "succeeded", finishedAt: new Date(), result: { found: false, costUsd } }).where(eq(agentJob.id, job.id));
      await emit(tx, { orgId: job.orgId, type: "candidate.researched", entityType: "candidate", entityId: c.id, actorType: "agent", correlationId: job.id, payload: { found: false, costUsd } });
      return { outcome: "nothing_found", costUsd };
    }
    const values: [string, unknown][] = [
      ["research_note", out.note.trim()],
      ["research_sources", sources],
      ...(out.currentRole ? [["current_role", out.currentRole] as [string, unknown]] : []),
      ...(out.company ? [["current_company", out.company] as [string, unknown]] : []),
      ...(out.signals?.length ? [["research_signals", out.signals] as [string, unknown]] : []),
    ];
    const inserted = await tx.insert(candidateAttribute).values(values.map(([key, value]) => ({
      orgId: job.orgId, candidateId: c.id, key, value: value as object, confidence: "0.8", agentJobId: job.id,
    }))).returning({ id: candidateAttribute.id, key: candidateAttribute.key });
    for (const row of inserted) {
      await tx.update(candidateAttribute).set({ supersededById: row.id }).where(and(
        eq(candidateAttribute.candidateId, c.id), eq(candidateAttribute.key, row.key), isNull(candidateAttribute.supersededById), sql`${candidateAttribute.id} <> ${row.id}`));
    }
    await tx.update(agentJob).set({ status: "succeeded", finishedAt: new Date(), result: { found: true, sources: sources.length, costUsd } }).where(eq(agentJob.id, job.id));
    await emit(tx, { orgId: job.orgId, type: "candidate.researched", entityType: "candidate", entityId: c.id, actorType: "agent", correlationId: job.id, payload: { found: true, sources: sources.length, signals: out.signals ?? [], costUsd } });
    return { outcome: "researched", costUsd };
  });
}

/** Queue research for scored candidates at/above the floor that have no note and no job yet. */
export async function enqueueResearch(db: EmitTx, orgId: string, opts: { minScore?: number; limit?: number; candidateIds?: string[] } = {}): Promise<number> {
  const min = opts.minScore ?? RESEARCH_MIN_SCORE;
  const ids = opts.candidateIds ?? rows<{ id: string }>(await db.execute(sql`
    select c.id from candidate c
    where c.org_id = ${orgId} and c.merged_into_id is null and c.current_score >= ${min}
      and not exists (select 1 from candidate_attribute a where a.candidate_id = c.id and a.key = 'research_note' and a.superseded_by_id is null)
      and not exists (select 1 from agent_job j where j.type = ${RESEARCH_JOB_TYPE} and j.org_id = ${orgId}
                      and j.payload->>'candidateId' = c.id::text and j.status in ('queued', 'running', 'succeeded'))
      and not exists (select 1 from suppression s join identifier i on i.value_normalized = s.identifier and i.candidate_id = c.id where s.org_id = ${orgId})
    order by c.current_score desc limit ${opts.limit ?? 500}`)).map((r) => r.id);
  if (!ids.length) return 0;
  await db.insert(agentJob).values(ids.map((candidateId) => ({ orgId, type: RESEARCH_JOB_TYPE, payload: { candidateId } })));
  return ids.length;
}

export async function drainResearch(db: EmitTx, llm: LlmGateway, opts: { orgId?: string; limit?: number; now?: Date } = {}) {
  const jobs = await db.select({ id: agentJob.id, orgId: agentJob.orgId, payload: agentJob.payload }).from(agentJob)
    .where(and(eq(agentJob.type, RESEARCH_JOB_TYPE), eq(agentJob.status, "queued"), ...(opts.orgId ? [eq(agentJob.orgId, opts.orgId)] : [])))
    .orderBy(agentJob.createdAt).limit(opts.limit ?? 25);
  const summary = { researched: 0, nothingFound: 0, overBudget: 0, failed: 0, skipped: 0, costUsd: 0 };
  for (const j of jobs) {
    const r = await researchCandidate(db, llm, { id: j.id, orgId: j.orgId, candidateId: String((j.payload as { candidateId: string }).candidateId), now: opts.now });
    summary.costUsd += r.costUsd ?? 0;
    if (r.outcome === "researched") summary.researched += 1;
    else if (r.outcome === "nothing_found") summary.nothingFound += 1;
    else if (r.outcome === "over_budget") { summary.overBudget += 1; break; }
    else if (r.outcome === "failed") summary.failed += 1;
    else summary.skipped += 1;
  }
  return summary;
}

