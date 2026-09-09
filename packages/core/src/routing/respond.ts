import { and, eq } from "drizzle-orm";
import { assignment, candidate } from "@athena/db/schema";
import { emit, type EmitTx } from "../events/emit";
import { routeCandidate, type RouteResult } from "./assign";

type Actor = { actorType: "user" | "system"; actorId?: string };

/** The consultant takes the lead. Speed-to-consult clock is already running (from offer). */
export async function acceptAssignment(db: EmitTx, args: { orgId: string; assignmentId: string; now?: Date } & Actor) {
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(assignment).where(and(eq(assignment.id, args.assignmentId), eq(assignment.orgId, args.orgId))).limit(1);
    if (!a) return { ok: false as const, reason: "not_found" as const };
    if (a.status !== "offered") return { ok: false as const, reason: "not_offered" as const };
    await tx.update(assignment).set({ status: "accepted", respondedAt: now }).where(eq(assignment.id, a.id));
    await tx.update(candidate).set({ status: "in_opportunity", updatedAt: now }).where(eq(candidate.id, a.candidateId));
    await emit(tx, {
      orgId: args.orgId, type: "assignment.accepted", entityType: "assignment", entityId: a.id,
      actorType: args.actorType, actorId: args.actorId,
      payload: { candidateId: a.candidateId, consultantId: a.consultantId, hoursToRespond: (now.getTime() - a.offeredAt.getTime()) / 3_600_000 },
    });
    return { ok: true as const };
  });
}

/** The consultant passes; the candidate is re-routed immediately, excluding everyone who has declined. */
export async function declineAssignment(
  db: EmitTx,
  args: { orgId: string; assignmentId: string; reason?: string; now?: Date } & Actor,
): Promise<{ ok: boolean; reason?: string; reroute?: RouteResult }> {
  const now = args.now ?? new Date();
  const declined = await db.transaction(async (tx) => {
    const [a] = await tx.select().from(assignment).where(and(eq(assignment.id, args.assignmentId), eq(assignment.orgId, args.orgId))).limit(1);
    if (!a) return { ok: false as const, reason: "not_found" };
    if (a.status !== "offered") return { ok: false as const, reason: "not_offered" };
    await tx.update(assignment).set({ status: "declined", respondedAt: now, endedAt: now }).where(eq(assignment.id, a.id));
    await tx.update(candidate).set({ assignedToUserId: null, updatedAt: now }).where(eq(candidate.id, a.candidateId));
    await emit(tx, {
      orgId: args.orgId, type: "assignment.declined", entityType: "assignment", entityId: a.id,
      actorType: args.actorType, actorId: args.actorId,
      payload: { candidateId: a.candidateId, consultantId: a.consultantId, reason: args.reason ?? null },
    });
    const priorDecliners = await tx.select({ consultantId: assignment.consultantId }).from(assignment)
      .where(and(eq(assignment.candidateId, a.candidateId), eq(assignment.status, "declined")));
    return { ok: true as const, a, exclude: [...new Set(priorDecliners.map((d) => d.consultantId))] };
  });
  if (!declined.ok) return declined;
  const reroute = await routeCandidate(db, {
    orgId: args.orgId, candidateId: declined.a.candidateId, trigger: "decline", conversationId: declined.a.conversationId,
    personaMailboxId: declined.a.personaMailboxId, excludeConsultantIds: declined.exclude, now,
  });
  return { ok: true, reroute };
}
