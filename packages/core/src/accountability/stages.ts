import { and, eq, notInArray } from "drizzle-orm";
import { OPPORTUNITY_STAGES, candidate, opportunity, type OpportunityStage } from "@athena/db/schema";
import { emit, type EmitTx } from "../events/emit";

/** Display names carried over verbatim from the FCC CRM (Steve, 2026-09-01). */
export const STAGE_LABELS: Record<OpportunityStage, string> = {
  lead_in: "Lead In",
  contact_made: "Contact Made",
  cq_sent: "CQ Sent",
  cq_received: "CQ Received",
  talking_to_zors: "Talking to Zors",
  d_day_scheduled: "D-Day Scheduled",
  contract_out: "Contract Out",
  closed_funded: "Closed / Funded",
  closed_lost: "Closed / Lost",
};

export const PIPELINE_STAGES: OpportunityStage[] = OPPORTUNITY_STAGES.filter((s) => s !== "closed_lost");

export function stageIndex(s: OpportunityStage): number {
  return PIPELINE_STAGES.indexOf(s);
}

export function nextStage(s: OpportunityStage): OpportunityStage {
  const i = stageIndex(s);
  if (i < 0 || i >= PIPELINE_STAGES.length - 1) return s;
  return PIPELINE_STAGES[i + 1]!;
}

export function stageFromLabel(label: string): OpportunityStage | null {
  const norm = label.trim().toLowerCase().replace(/[^a-z]/g, "");
  for (const [k, v] of Object.entries(STAGE_LABELS)) {
    if (v.toLowerCase().replace(/[^a-z]/g, "") === norm) return k as OpportunityStage;
  }
  return null;
}

/**
 * Moves the candidate's open opportunity. `minimumOnly` never moves
 * backwards (used by automatic advances); an explicit move from a human or
 * the CRM may set any stage. Emits the stage change and enqueues the CRM
 * mirror in the same transaction. Returns null when nothing changed.
 */
export async function advanceStage(
  tx: EmitTx,
  args: {
    orgId: string; candidateId: string; to: OpportunityStage; lostReason?: string; minimumOnly?: boolean;
    source?: "athena" | "ghl"; actorType?: "system" | "user" | "agent"; actorId?: string; now?: Date;
  },
): Promise<{ opportunityId: string; from: OpportunityStage; to: OpportunityStage } | null> {
  const now = args.now ?? new Date();
  const [o] = await tx.select().from(opportunity)
    .where(and(eq(opportunity.orgId, args.orgId), eq(opportunity.candidateId, args.candidateId), notInArray(opportunity.stage, ["closed_funded", "closed_lost"])))
    .limit(1);
  if (!o) return null;
  if (o.stage === args.to) return null;
  if (args.minimumOnly && stageIndex(args.to) <= stageIndex(o.stage)) return null;

  await tx.update(opportunity)
    .set({ stage: args.to, stageUpdatedAt: now, ...(args.lostReason ? { lostReason: args.lostReason } : {}) })
    .where(eq(opportunity.id, o.id));
  if (args.to === "closed_funded" || args.to === "closed_lost") {
    await tx.update(candidate).set({ status: args.to === "closed_funded" ? "closed_won" : "closed_lost", updatedAt: now }).where(eq(candidate.id, args.candidateId));
  }
  await emit(tx, {
    orgId: args.orgId, type: "opportunity.stage_changed", entityType: "opportunity", entityId: o.id,
    actorType: args.actorType ?? "system", actorId: args.actorId,
    payload: { from: o.stage, to: args.to, source: args.source ?? "athena", consultantId: o.consultantId, candidateId: args.candidateId, lostReason: args.lostReason ?? null },
    enqueue: args.source === "ghl" ? [] : [{ type: "crm.sync", payload: { opportunityId: o.id } }],
  });
  return { opportunityId: o.id, from: o.stage, to: args.to };
}
