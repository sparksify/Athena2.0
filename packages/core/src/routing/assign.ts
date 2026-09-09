import { and, eq, inArray, notInArray } from "drizzle-orm";
import { assignment, candidate, opportunity, personaMailbox } from "@athena/db/schema";
import { emit, type EmitTx } from "../events/emit";
import { buildRoutingContext } from "./context";
import { rankConsultants, type RankedConsultant } from "./rank";

export type RoutingTrigger = "positive_reply" | "override" | "decline" | "take_back" | "manual";

export interface RouteResult {
  assigned: boolean;
  assignmentId?: string;
  consultantId?: string;
  opportunityId?: string;
  reason?: "already_assigned" | "no_consultant_available" | "candidate_not_found";
  ranked?: RankedConsultant[];
}

/**
 * Routes a candidate to one consultant. Writes the assignment, the open
 * opportunity (or moves it to the new consultant), the candidate's
 * ownership hook for RLS, and the event — in one transaction — and
 * enqueues the warm intro on the outbox. Deterministic: the rules decide,
 * the full factor table is stored as assignment.reason.
 */
export async function routeCandidate(
  db: EmitTx,
  args: {
    orgId: string;
    candidateId: string;
    trigger: RoutingTrigger;
    conversationId?: string | null;
    personaMailboxId?: string | null;
    excludeConsultantIds?: string[];
    actorType?: "system" | "user" | "agent";
    actorId?: string;
    agentJobId?: string;
    now?: Date;
  },
): Promise<RouteResult> {
  const now = args.now ?? new Date();
  const { ctx, consultants } = await buildRoutingContext(db, { orgId: args.orgId, candidateId: args.candidateId, now });
  const ranked = rankConsultants(consultants, ctx, { excludeIds: args.excludeConsultantIds });

  return db.transaction(async (tx) => {
    const live = await tx
      .select({ id: assignment.id })
      .from(assignment)
      .where(and(eq(assignment.candidateId, args.candidateId), inArray(assignment.status, ["offered", "accepted"])))
      .limit(1);
    if (live[0]) return { assigned: false, reason: "already_assigned" as const, ranked };

    const pick = ranked[0];
    if (!pick) {
      await emit(tx, {
        orgId: args.orgId, type: "routing.unrouted", entityType: "candidate", entityId: args.candidateId,
        actorType: args.actorType ?? "system", actorId: args.actorId, payload: { trigger: args.trigger, excluded: args.excludeConsultantIds ?? [] },
      });
      return { assigned: false, reason: "no_consultant_available" as const, ranked };
    }
    const chosen = consultants.find((c) => c.id === pick.consultantId)!;

    // Which named agent hands this off (Steve: "Assigned by Sophie").
    let personaId = args.personaMailboxId ?? null;
    if (!personaId) {
      const [p] = await tx.select({ id: personaMailbox.id }).from(personaMailbox)
        .where(and(eq(personaMailbox.orgId, args.orgId), eq(personaMailbox.active, true))).orderBy(personaMailbox.name).limit(1);
      personaId = p?.id ?? null;
    }

    const [row] = await tx
      .insert(assignment)
      .values({
        orgId: args.orgId, candidateId: args.candidateId, consultantId: pick.consultantId,
        conversationId: args.conversationId ?? null, personaMailboxId: personaId,
        reason: { trigger: args.trigger, total: pick.total, factors: pick.factors, runnerUp: ranked[1] ? { consultantId: ranked[1].consultantId, total: ranked[1].total } : null },
        status: "offered", offeredAt: now,
      })
      .returning({ id: assignment.id });

    // Open opportunity follows the candidate: move it, or open one at Lead In.
    const [open] = await tx.select({ id: opportunity.id }).from(opportunity)
      .where(and(eq(opportunity.candidateId, args.candidateId), notInArray(opportunity.stage, ["closed_funded", "closed_lost"]))).limit(1);
    let opportunityId: string;
    if (open) {
      await tx.update(opportunity).set({ consultantId: pick.consultantId, assignmentId: row!.id }).where(eq(opportunity.id, open.id));
      opportunityId = open.id;
    } else {
      const [o] = await tx.insert(opportunity)
        .values({ orgId: args.orgId, candidateId: args.candidateId, consultantId: pick.consultantId, assignmentId: row!.id, stage: "lead_in", stageUpdatedAt: now })
        .returning({ id: opportunity.id });
      opportunityId = o!.id;
      await emit(tx, { orgId: args.orgId, type: "opportunity.opened", entityType: "opportunity", entityId: opportunityId, payload: { candidateId: args.candidateId, consultantId: pick.consultantId, stage: "lead_in" } });
    }

    await tx.update(candidate)
      .set({ assignedToUserId: chosen.userId ?? null, status: "interested", updatedAt: now })
      .where(eq(candidate.id, args.candidateId));

    await emit(tx, {
      orgId: args.orgId, type: "assignment.offered", entityType: "assignment", entityId: row!.id,
      actorType: args.actorType ?? "system", actorId: args.actorId, correlationId: args.agentJobId,
      payload: { candidateId: args.candidateId, consultantId: pick.consultantId, trigger: args.trigger, total: pick.total, personaMailboxId: personaId, opportunityId },
      enqueue: [{ type: "routing.intro", payload: { assignmentId: row!.id } }],
    });
    return { assigned: true, assignmentId: row!.id, consultantId: pick.consultantId, opportunityId, ranked };
  });
}
