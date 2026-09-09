import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { appointment, assignment, consultant as consultantTable, identifier, opportunity } from "@athena/db/schema";
import { emit, type EmitTx } from "../events/emit";
import { rows } from "../db-rows";
import { advanceStage } from "./stages";

export interface CalendarEvent {
  kind: "scheduled" | "canceled" | "completed";
  provider: "calendly" | "gcal" | "manual";
  externalRef: string;
  startsAt: Date;
  endsAt?: Date;
  inviteeEmail: string;
  /** The calendar owner, used to pick the consultant when the candidate has no live assignment. */
  hostEmail?: string;
  appointmentKind?: "consultation" | "intro" | "other";
  raw?: unknown;
}

export interface AppointmentResult {
  handled: boolean;
  deduped: boolean;
  appointmentId?: string;
  cqMissing?: boolean;
  reason?: "unknown_invitee" | "no_consultant";
}

const DEFAULT_LENGTH_MS = 45 * 60_000;

/**
 * Idempotent calendar ingestion (UNIQUE(provider, external_ref)). A booked
 * consultation counts as first touch, moves Lead In → Contact Made, and is
 * flagged when no completed CQ is on file (decision 7: tracked and chased
 * now; the booking hard-gate needs the CQ send flow).
 */
export async function handleCalendarEvent(db: EmitTx, evt: CalendarEvent): Promise<AppointmentResult> {
  const email = evt.inviteeEmail.trim().toLowerCase();
  const now = new Date();
  return db.transaction(async (tx) => {
    if (evt.kind === "canceled") {
      const [ap] = await tx.update(appointment).set({ status: "canceled" })
        .where(and(eq(appointment.provider, evt.provider), eq(appointment.externalRef, evt.externalRef), eq(appointment.status, "scheduled")))
        .returning({ id: appointment.id, orgId: appointment.orgId, candidateId: appointment.candidateId, consultantId: appointment.consultantId });
      if (!ap) return { handled: false, deduped: true };
      await emit(tx, { orgId: ap.orgId, type: "appointment.canceled", entityType: "appointment", entityId: ap.id, payload: { candidateId: ap.candidateId, consultantId: ap.consultantId } });
      return { handled: true, deduped: false, appointmentId: ap.id };
    }
    if (evt.kind === "completed") return { handled: false, deduped: false }; // the disposition ladder owns completion

    const [ident] = await tx.select({ candidateId: identifier.candidateId, orgId: identifier.orgId }).from(identifier)
      .where(and(eq(identifier.type, "email"), eq(identifier.valueNormalized, email))).limit(1);
    if (!ident?.candidateId) return { handled: false, deduped: false, reason: "unknown_invitee" };
    const { orgId, candidateId } = ident;

    const [live] = await tx.select().from(assignment)
      .where(and(eq(assignment.candidateId, candidateId), inArray(assignment.status, ["offered", "accepted"]))).limit(1);
    let consultantId = live?.consultantId ?? null;
    if (!consultantId && evt.hostEmail) {
      const [c] = await tx.select({ id: consultantTable.id }).from(consultantTable)
        .where(and(eq(consultantTable.orgId, orgId), sql`lower(${consultantTable.email}) = ${evt.hostEmail.toLowerCase()}`)).limit(1);
      consultantId = c?.id ?? null;
    }
    if (!consultantId) return { handled: false, deduped: false, reason: "no_consultant" };

    const [open] = await tx.select({ id: opportunity.id }).from(opportunity)
      .where(and(eq(opportunity.candidateId, candidateId), notInArray(opportunity.stage, ["closed_funded", "closed_lost"]))).limit(1);

    const inserted = await tx.insert(appointment).values({
      orgId, candidateId, consultantId, opportunityId: open?.id ?? null, provider: evt.provider, externalRef: evt.externalRef,
      kind: evt.appointmentKind ?? "consultation", startsAt: evt.startsAt, endsAt: evt.endsAt ?? new Date(evt.startsAt.getTime() + DEFAULT_LENGTH_MS),
    }).onConflictDoNothing().returning({ id: appointment.id });
    if (!inserted[0]) return { handled: true, deduped: true };
    const apId = inserted[0].id;

    const cq = rows<{ n: number }>(await tx.execute(sql`select count(*)::int as n from questionnaire where candidate_id = ${candidateId} and kind = 'cq_complete'`))[0];
    const cqMissing = !cq || Number(cq.n) === 0;

    if (live && live.firstTouchAt == null) {
      await tx.update(assignment).set({ firstTouchAt: now, ...(live.status === "offered" ? { status: "accepted", respondedAt: now } : {}) }).where(eq(assignment.id, live.id));
      await emit(tx, { orgId, type: "assignment.first_touch", entityType: "assignment", entityId: live.id, payload: { candidateId, consultantId, channel: "meeting", via: "calendar", hoursSinceOffer: (now.getTime() - live.offeredAt.getTime()) / 3_600_000 } });
    }
    await emit(tx, {
      orgId, type: "appointment.scheduled", entityType: "appointment", entityId: apId,
      payload: { candidateId, consultantId, provider: evt.provider, startsAt: evt.startsAt.toISOString(), kind: evt.appointmentKind ?? "consultation", cqMissing },
    });
    if (cqMissing) {
      await emit(tx, { orgId, type: "appointment.cq_missing", entityType: "appointment", entityId: apId, payload: { candidateId, consultantId, startsAt: evt.startsAt.toISOString() } });
    }
    await advanceStage(tx, { orgId, candidateId, to: "contact_made", minimumOnly: true, now });
    return { handled: true, deduped: false, appointmentId: apId, cqMissing };
  });
}
