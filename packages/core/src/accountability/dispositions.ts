import { and, eq, isNull } from "drizzle-orm";
import { appointment, consultant as consultantTable, consultantNudge, disposition, interaction, opportunity } from "@athena/db/schema";
import { emit, type EmitTx } from "../events/emit";
import { recordFirstTouch } from "../routing/first-touch";
import { openNudgesFor } from "./nudges";
import { advanceStage, nextStage } from "./stages";

/** Numeric reply vocabulary — what the nudge SMS asks for. */
export const DISPOSITION_CODES = {
  "1": { label: "Showed — advancing", appointmentStatus: "showed", stage: "next" },
  "2": { label: "Showed — not a fit", appointmentStatus: "showed", stage: "closed_lost" },
  "3": { label: "No-show", appointmentStatus: "no_show", stage: "hold" },
  "4": { label: "Rescheduled", appointmentStatus: "canceled", stage: "hold" },
} as const;
export type DispositionCode = keyof typeof DISPOSITION_CODES;

export function parseDispositionReply(text: string): DispositionCode | null {
  const m = text.trim().match(/^\D*([1-4])(?:\D|$)/);
  return m ? (m[1] as DispositionCode) : null;
}

export async function recordDisposition(
  db: EmitTx,
  args: { orgId: string; appointmentId: string; code: DispositionCode; notes?: string; via: "sms" | "ui"; actorType: "user" | "system"; actorId?: string; now?: Date },
): Promise<{ ok: boolean; reason?: string; stageTo?: string | null }> {
  const now = args.now ?? new Date();
  const spec = DISPOSITION_CODES[args.code];
  if (!spec) return { ok: false, reason: "unknown_code" };
  return db.transaction(async (tx) => {
    const [ap] = await tx.select().from(appointment).where(and(eq(appointment.id, args.appointmentId), eq(appointment.orgId, args.orgId))).limit(1);
    if (!ap) return { ok: false, reason: "not_found" };
    const inserted = await tx.insert(disposition)
      .values({ orgId: args.orgId, appointmentId: ap.id, consultantId: ap.consultantId, code: args.code, notes: args.notes, recordedVia: args.via, recordedAt: now })
      .onConflictDoNothing().returning({ id: disposition.id });
    if (!inserted[0]) return { ok: false, reason: "already_recorded" };

    await tx.update(appointment).set({ status: spec.appointmentStatus }).where(eq(appointment.id, ap.id));
    await tx.update(consultantNudge).set({ response: args.code }).where(and(eq(consultantNudge.appointmentId, ap.id), isNull(consultantNudge.response)));
    await tx.insert(interaction).values({
      orgId: args.orgId, candidateId: ap.candidateId, type: "meeting", direction: "outbound", occurredAt: ap.startsAt, consultantId: ap.consultantId,
      payload: { disposition: args.code, label: spec.label, notes: args.notes ?? null, appointmentId: ap.id },
    });
    await emit(tx, {
      orgId: args.orgId, type: "disposition.recorded", entityType: "appointment", entityId: ap.id, actorType: args.actorType, actorId: args.actorId,
      payload: { candidateId: ap.candidateId, consultantId: ap.consultantId, code: args.code, label: spec.label, via: args.via, realConsult: spec.appointmentStatus === "showed" && ap.kind === "consultation" },
    });

    let stageTo: string | null = null;
    if (spec.stage === "closed_lost") {
      stageTo = (await advanceStage(tx, { orgId: args.orgId, candidateId: ap.candidateId, to: "closed_lost", lostReason: "not_a_fit", actorType: args.actorType, actorId: args.actorId, now }))?.to ?? null;
    } else if (spec.stage === "next") {
      const [o] = await tx.select({ stage: opportunity.stage }).from(opportunity).where(eq(opportunity.id, ap.opportunityId ?? "00000000-0000-0000-0000-000000000000")).limit(1);
      const from = o?.stage ?? "contact_made";
      const to = nextStage(from === "lead_in" ? "contact_made" : from);
      stageTo = (await advanceStage(tx, { orgId: args.orgId, candidateId: ap.candidateId, to, minimumOnly: true, actorType: args.actorType, actorId: args.actorId, now }))?.to ?? null;
    }
    return { ok: true, stageTo };
  });
}

export interface InboundSmsResult {
  handled: boolean;
  action?: "disposition" | "first_touch" | "ignored";
  reason?: string;
}

/**
 * A consultant texts back. The most recent unanswered nudge decides what
 * the digit means: after a consult it is a disposition; after an
 * assignment, "1" means "I've reached out" and stops the 48h clock.
 */
export async function handleInboundSms(db: EmitTx, args: { fromPhone: string; text: string; now?: Date }): Promise<InboundSmsResult> {
  const digits = args.fromPhone.replace(/\D/g, "");
  const [cons] = await db.select().from(consultantTable)
    .where(eq(consultantTable.phone, args.fromPhone)).limit(1);
  const consultant = cons ?? (await db.select().from(consultantTable)).find((c) => (c.phone ?? "").replace(/\D/g, "").endsWith(digits.slice(-10)));
  if (!consultant) return { handled: false, reason: "unknown_sender" };
  const nudges = await openNudgesFor(db, consultant.id);
  const latest = nudges[0];
  if (!latest) return { handled: false, action: "ignored", reason: "no_open_nudge" };
  const code = parseDispositionReply(args.text);
  if (latest.appointmentId) {
    if (!code) return { handled: false, action: "ignored", reason: "no_code" };
    const r = await recordDisposition(db, { orgId: latest.orgId, appointmentId: latest.appointmentId, code, via: "sms", actorType: "user", actorId: consultant.userId ?? undefined, now: args.now });
    return { handled: r.ok, action: "disposition", reason: r.reason };
  }
  if (latest.assignmentId && (code === "1" || /\b(done|contacted|reached|called|emailed)\b/i.test(args.text))) {
    const r = await recordFirstTouch(db, { orgId: latest.orgId, assignmentId: latest.assignmentId, channel: "call", note: "confirmed by SMS", actorType: "user", actorId: consultant.userId ?? undefined, now: args.now });
    return { handled: r.ok, action: "first_touch", reason: r.reason };
  }
  return { handled: false, action: "ignored", reason: "no_code" };
}
