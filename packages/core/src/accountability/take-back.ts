import { and, eq } from "drizzle-orm";
import { assignment, candidate } from "@athena/db/schema";
import { emit, type EmitTx } from "../events/emit";
import { routeCandidate, type RouteResult } from "../routing/assign";

/**
 * Reclaims a lead from a consultant who has not made first contact (48h
 * rule) or on a manager's say-so, then re-routes it excluding them. Leaves
 * events; feeds the routing reward loop through take_backs_30d.
 */
export async function takeBackAssignment(
  db: EmitTx,
  args: { orgId: string; assignmentId: string; reason: "no_touch_48h" | "manager"; actorType?: "system" | "user"; actorId?: string; now?: Date },
): Promise<{ ok: boolean; reason?: string; reroute?: RouteResult }> {
  const now = args.now ?? new Date();
  const taken = await db.transaction(async (tx) => {
    const [a] = await tx.select().from(assignment).where(and(eq(assignment.id, args.assignmentId), eq(assignment.orgId, args.orgId))).limit(1);
    if (!a) return { ok: false as const, reason: "not_found" };
    if (a.status !== "offered" && a.status !== "accepted") return { ok: false as const, reason: "assignment_ended" };
    await tx.update(assignment).set({ status: "taken_back", endedAt: now }).where(eq(assignment.id, a.id));
    await tx.update(candidate).set({ assignedToUserId: null, updatedAt: now }).where(eq(candidate.id, a.candidateId));
    await emit(tx, {
      orgId: args.orgId, type: "assignment.taken_back", entityType: "assignment", entityId: a.id,
      actorType: args.actorType ?? "system", actorId: args.actorId,
      payload: { candidateId: a.candidateId, consultantId: a.consultantId, reason: args.reason, hoursSinceOffer: (now.getTime() - a.offeredAt.getTime()) / 3_600_000 },
    });
    return { ok: true as const, a };
  });
  if (!taken.ok) return taken;
  const reroute = await routeCandidate(db, {
    orgId: args.orgId, candidateId: taken.a.candidateId, trigger: "take_back", conversationId: taken.a.conversationId,
    personaMailboxId: taken.a.personaMailboxId, excludeConsultantIds: [taken.a.consultantId], now,
  });
  return { ok: true, reroute };
}
