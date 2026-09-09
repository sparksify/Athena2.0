import { eq } from "drizzle-orm";
import type { CrmSyncAdapter } from "@athena/contracts";
import { candidate, opportunity } from "@athena/db/schema";
import { emit, type EmitTx } from "../events/emit";
import { STAGE_LABELS, advanceStage, stageFromLabel } from "./stages";

/** Mirror the opportunity into GHL (ADR 0004: Athena is the source of truth). */
export async function syncOpportunity(db: EmitTx, crm: CrmSyncAdapter, args: { opportunityId: string; agentJobId?: string }) {
  const [o] = await db.select().from(opportunity).where(eq(opportunity.id, args.opportunityId)).limit(1);
  if (!o) return { ok: false as const, reason: "not_found" };
  const [c] = await db.select({ name: candidate.fullName, email: candidate.primaryEmail, phone: candidate.primaryPhone }).from(candidate).where(eq(candidate.id, o.candidateId)).limit(1);
  const { externalRef } = await crm.upsertOpportunity({
    externalContactRef: o.ghlRef ?? undefined,
    name: c?.name ?? c?.email ?? "Athena candidate",
    stage: STAGE_LABELS[o.stage],
    email: c?.email ?? undefined,
    phone: c?.phone ?? undefined,
  });
  await db.transaction(async (tx) => {
    if (externalRef !== o.ghlRef) await tx.update(opportunity).set({ ghlRef: externalRef }).where(eq(opportunity.id, o.id));
    await emit(tx, { orgId: o.orgId, type: "opportunity.crm_synced", entityType: "opportunity", entityId: o.id, correlationId: args.agentJobId, payload: { provider: crm.name, externalRef, stage: o.stage } });
  });
  return { ok: true as const, externalRef };
}

/** A stage moved in GHL: apply it here without echoing it back. */
export async function applyCrmStage(db: EmitTx, args: { externalRef: string; stage: string; now?: Date }) {
  const to = stageFromLabel(args.stage);
  if (!to) return { ok: false as const, reason: "unknown_stage" };
  const [o] = await db.select().from(opportunity).where(eq(opportunity.ghlRef, args.externalRef)).limit(1);
  if (!o) return { ok: false as const, reason: "not_found" };
  const changed = await db.transaction((tx) => advanceStage(tx, { orgId: o.orgId, candidateId: o.candidateId, to, source: "ghl", now: args.now }));
  return { ok: true as const, changed: changed != null, to };
}
