import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { CrmContactHistory, CrmReader } from "@athena/contracts";
import { agentJob, candidate, candidateAttribute, costRecord, identifier, interaction, suppression } from "@athena/db/schema";
import { emit, type EmitTx } from "../events/emit";
import { rows } from "../db-rows";

/** Attribute keys this job owns; re-running supersedes the previous set. */
export const CRM_ATTRIBUTE_KEYS = [
  "crm_contact_id", "crm_tags", "crm_source", "crm_added_at", "crm_assigned_to", "crm_dnd",
  "crm_pipeline", "crm_stage", "crm_opportunity_status", "crm_opportunity_value_usd", "crm_opportunity_count",
  "crm_last_contact_at", "crm_messages_in", "crm_messages_out", "crm_appointments", "crm_notes", "crm_custom_fields", "crm_locations",
] as const;

export interface CrmEnrichResult {
  outcome: "enriched" | "not_in_crm" | "skipped" | "failed";
  attributes?: number;
  interactions?: number;
  suppressed?: boolean;
}

/**
 * Pulls a candidate's CRM history into Athena with provenance (every row
 * carries agent_job_id). Messages, calls and appointments become
 * interactions, so the existing recency / engagement / appointment scoring
 * factors see them; tags, stage and status become attributes for the
 * crm_pipeline factor, routing specialties, drafting and the consultant
 * brief; DND becomes suppression. Idempotent: interactions dedupe on
 * provider_ref, attributes supersede the last run's.
 */
export async function enrichFromCrm(
  db: EmitTx,
  crm: CrmReader,
  job: { id: string; orgId: string; candidateId: string },
): Promise<CrmEnrichResult> {
  const [claimed] = await db.update(agentJob).set({ status: "running", startedAt: new Date() })
    .where(and(eq(agentJob.id, job.id), inArray(agentJob.status, ["queued", "failed"]))).returning({ id: agentJob.id });
  if (!claimed) return { outcome: "skipped" };

  const idents = await db.select({ type: identifier.type, value: identifier.valueNormalized }).from(identifier)
    .where(and(eq(identifier.candidateId, job.candidateId), inArray(identifier.type, ["email", "phone"])));
  const email = idents.find((i) => i.type === "email")?.value ?? null;
  const phone = idents.find((i) => i.type === "phone")?.value ?? null;

  let history: CrmContactHistory | null;
  try {
    history = await crm.lookupContact({ email, phone });
  } catch (err) {
    await db.update(agentJob).set({ status: "failed", finishedAt: new Date(), error: String(err) }).where(eq(agentJob.id, job.id));
    return { outcome: "failed" };
  }

  return db.transaction(async (tx) => {
    await tx.insert(costRecord).values({ orgId: job.orgId, agentJobId: job.id, category: "other", provider: crm.name, amountUsd: "0.000000", detail: { kind: "crm_lookup", found: Boolean(history) } });
    if (!history) {
      await tx.update(agentJob).set({ status: "succeeded", finishedAt: new Date(), result: { found: false } }).where(eq(agentJob.id, job.id));
      await emit(tx, { orgId: job.orgId, type: "candidate.crm_checked", entityType: "candidate", entityId: job.candidateId, actorType: "agent", correlationId: job.id, payload: { provider: crm.name, found: false } });
      return { outcome: "not_in_crm" };
    }

    // Opportunity of record: the open one, else the most recently touched.
    const opps = [...history.opportunities].sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
    const primary = opps.find((o) => o.status === "open") ?? opps[0] ?? null;
    const inbound = history.messages.filter((m) => m.direction === "inbound").length;
    const outbound = history.messages.length - inbound;
    const lastContact = [...history.messages.map((m) => m.occurredAt), ...history.appointments.map((a) => a.startsAt)]
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const notes = history.notes.map((n) => n.body.trim()).filter(Boolean).join("\n---\n").slice(0, 4000);

    const values: Record<(typeof CRM_ATTRIBUTE_KEYS)[number], unknown> = {
      crm_contact_id: history.contactRef,
      crm_tags: history.tags,
      crm_source: history.source,
      crm_added_at: history.addedAt?.toISOString() ?? null,
      crm_assigned_to: history.assignedTo,
      crm_dnd: history.dnd,
      crm_pipeline: primary?.pipeline ?? null,
      crm_stage: primary?.stage ?? null,
      crm_opportunity_status: primary?.status ?? null,
      crm_opportunity_value_usd: primary?.valueUsd ?? null,
      crm_opportunity_count: history.opportunities.length,
      crm_last_contact_at: lastContact?.toISOString() ?? null,
      crm_messages_in: inbound,
      crm_messages_out: outbound,
      crm_appointments: history.appointments.length,
      crm_notes: notes || null,
      crm_custom_fields: history.customFields,
      crm_locations: (history.locations ?? []).map((l) => l.name ?? l.id),
    };
    const toWrite = Object.entries(values).filter(([, v]) => v != null && !(Array.isArray(v) && v.length === 0) && !(typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0));

    const inserted = await tx.insert(candidateAttribute).values(
      toWrite.map(([key, value]) => ({ orgId: job.orgId, candidateId: job.candidateId, key, value: value as object, confidence: "1.0", agentJobId: job.id })),
    ).returning({ id: candidateAttribute.id, key: candidateAttribute.key });
    // Supersede the previous run's rows for the same keys (history stays, provenance intact).
    for (const row of inserted) {
      await tx.update(candidateAttribute).set({ supersededById: row.id }).where(and(
        eq(candidateAttribute.candidateId, job.candidateId), eq(candidateAttribute.key, row.key), isNull(candidateAttribute.supersededById),
        sql`${candidateAttribute.id} <> ${row.id}`,
      ));
    }

    // Timeline: messages, calls, appointments. Dedupe on provider_ref.
    const refs = [
      ...history.messages.map((m) => `${crm.name}:msg:${m.ref}`),
      ...history.appointments.map((a) => `${crm.name}:appt:${a.ref}`),
    ];
    const existing = new Set(refs.length
      ? (await tx.select({ ref: interaction.providerRef }).from(interaction).where(and(eq(interaction.candidateId, job.candidateId), inArray(interaction.providerRef, refs)))).map((r) => r.ref)
      : []);
    const newInteractions = [
      ...history.messages.map((m) => ({
        ref: `${crm.name}:msg:${m.ref}`,
        type: m.channel === "email" ? (m.direction === "inbound" ? "email_reply" : "email_sent") : m.channel === "call" ? "call" : "sms",
        direction: m.direction, occurredAt: m.occurredAt,
        payload: { source: crm.name, subject: m.subject, excerpt: m.body?.slice(0, 500) ?? null, channel: m.channel },
      })),
      ...history.appointments.map((a) => ({
        ref: `${crm.name}:appt:${a.ref}`, type: "meeting", direction: "inbound" as const, occurredAt: a.startsAt,
        payload: { source: crm.name, title: a.title, status: a.status, outcome: /show|complete|confirm/i.test(a.status ?? "") && !/no.?show/i.test(a.status ?? "") ? "showed" : a.status },
      })),
    ].filter((i) => !existing.has(i.ref));
    if (newInteractions.length) {
      await tx.insert(interaction).values(newInteractions.map((i) => ({
        orgId: job.orgId, candidateId: job.candidateId, type: i.type as typeof interaction.$inferInsert.type, direction: i.direction,
        occurredAt: i.occurredAt, payload: i.payload, providerRef: i.ref,
      })));
    }

    // DND anywhere in the CRM is an opt-out here, on every channel we have.
    let suppressed = false;
    if (history.dnd) {
      const entries = [email ? { channel: "email" as const, identifier: email } : null, phone ? { channel: "sms" as const, identifier: phone } : null].filter((x): x is NonNullable<typeof x> => x != null);
      if (entries.length) {
        const r = await tx.insert(suppression).values(entries.map((e) => ({ orgId: job.orgId, channel: e.channel, identifier: e.identifier, reason: "CRM do-not-disturb", source: crm.name })))
          .onConflictDoNothing().returning({ id: suppression.id });
        suppressed = r.length > 0;
      }
    }

    await tx.update(candidate).set({ updatedAt: new Date() }).where(eq(candidate.id, job.candidateId));
    await tx.update(agentJob).set({ status: "succeeded", finishedAt: new Date(), result: { found: true, attributes: inserted.length, interactions: newInteractions.length, suppressed } }).where(eq(agentJob.id, job.id));
    await emit(tx, {
      orgId: job.orgId, type: "candidate.crm_enriched", entityType: "candidate", entityId: job.candidateId, actorType: "agent", correlationId: job.id,
      payload: { provider: crm.name, contactRef: history.contactRef, stage: values.crm_stage, status: values.crm_opportunity_status, tags: history.tags.length, messages: history.messages.length, appointments: history.appointments.length, dnd: history.dnd },
    });
    return { outcome: "enriched", attributes: inserted.length, interactions: newInteractions.length, suppressed };
  });
}

export const CRM_JOB_TYPE = "crm.lookup";

/**
 * Sub-account refs the CRM reader should search: the active consultants'
 * own sub-accounts. Callers add GHL_LOCATION_IDS (the central accounts that
 * hold lead history) through the adapter.
 */
export async function crmLookupScope(db: EmitTx, orgId?: string): Promise<string[]> {
  return rows<{ ghl_ref: string }>(await db.execute(sql`
    select distinct ghl_ref from consultant where status = 'active' and ghl_ref is not null ${orgId ? sql`and org_id = ${orgId}` : sql``}`)).map((r) => r.ghl_ref);
}

/** Queue a lookup for every candidate that has never been checked (or everyone with `force`). */
export async function enqueueCrmLookups(db: EmitTx, orgId: string, opts: { candidateIds?: string[]; force?: boolean; limit?: number } = {}): Promise<number> {
  const limit = opts.limit ?? 5000;
  const ids = opts.candidateIds ?? rows<{ id: string }>(await db.execute(sql`
    select c.id from candidate c
    where c.org_id = ${orgId} and c.merged_into_id is null
      and (${opts.force ?? false} or not exists (
        select 1 from agent_job j where j.type = ${CRM_JOB_TYPE} and j.org_id = ${orgId}
          and j.payload->>'candidateId' = c.id::text and j.status in ('queued', 'running', 'succeeded')))
    order by c.current_score desc nulls last limit ${limit}`)).map((r) => r.id);
  if (!ids.length) return 0;
  await db.insert(agentJob).values(ids.map((candidateId) => ({ orgId, type: CRM_JOB_TYPE, payload: { candidateId } })));
  return ids.length;
}

export async function drainCrmLookups(db: EmitTx, crm: CrmReader, opts: { orgId?: string; limit?: number } = {}) {
  const jobs = await db.select({ id: agentJob.id, orgId: agentJob.orgId, payload: agentJob.payload }).from(agentJob)
    .where(and(eq(agentJob.type, CRM_JOB_TYPE), eq(agentJob.status, "queued"), ...(opts.orgId ? [eq(agentJob.orgId, opts.orgId)] : [])))
    .orderBy(agentJob.createdAt).limit(opts.limit ?? 100);
  const summary = { enriched: 0, notInCrm: 0, failed: 0, skipped: 0 };
  for (const j of jobs) {
    const r = await enrichFromCrm(db, crm, { id: j.id, orgId: j.orgId, candidateId: String((j.payload as { candidateId: string }).candidateId) });
    if (r.outcome === "enriched") summary.enriched += 1;
    else if (r.outcome === "not_in_crm") summary.notInCrm += 1;
    else if (r.outcome === "failed") summary.failed += 1;
    else summary.skipped += 1;
  }
  return summary;
}
