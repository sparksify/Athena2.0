import { and, eq } from "drizzle-orm";
import { assignment, interaction, consultantNudge } from "@athena/db/schema";
import { emit, type EmitTx } from "../events/emit";
import { advanceStage } from "../accountability/stages";

export type TouchChannel = "call" | "email_sent" | "sms" | "meeting";

/**
 * The consultant made first contact. Stops the 48h clock, records the touch
 * on the candidate timeline, moves Lead In → Contact Made. Idempotent: a
 * second touch is just another interaction.
 */
export async function recordFirstTouch(
  db: EmitTx,
  args: { orgId: string; assignmentId: string; channel: TouchChannel; note?: string; actorType: "user" | "system"; actorId?: string; now?: Date },
): Promise<{ ok: boolean; reason?: string; firstTouch: boolean }> {
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(assignment).where(and(eq(assignment.id, args.assignmentId), eq(assignment.orgId, args.orgId))).limit(1);
    if (!a) return { ok: false, reason: "not_found", firstTouch: false };
    if (a.status !== "offered" && a.status !== "accepted") return { ok: false, reason: "assignment_ended", firstTouch: false };

    await tx.insert(interaction).values({
      orgId: args.orgId, candidateId: a.candidateId, type: args.channel, direction: "outbound", occurredAt: now,
      consultantId: a.consultantId, payload: { note: args.note ?? null, assignmentId: a.id },
    });
    const first = a.firstTouchAt == null;
    if (first) {
      await tx.update(assignment)
        .set({ firstTouchAt: now, ...(a.status === "offered" ? { status: "accepted", respondedAt: now } : {}) })
        .where(eq(assignment.id, a.id));
      await tx.update(consultantNudge).set({ response: "touched" })
        .where(and(eq(consultantNudge.assignmentId, a.id)));
      await emit(tx, {
        orgId: args.orgId, type: "assignment.first_touch", entityType: "assignment", entityId: a.id,
        actorType: args.actorType, actorId: args.actorId,
        payload: { candidateId: a.candidateId, consultantId: a.consultantId, channel: args.channel, hoursSinceOffer: (now.getTime() - a.offeredAt.getTime()) / 3_600_000 },
      });
      await advanceStage(tx, { orgId: args.orgId, candidateId: a.candidateId, to: "contact_made", actorType: args.actorType, actorId: args.actorId, now, minimumOnly: true });
    }
    return { ok: true, firstTouch: first };
  });
}
