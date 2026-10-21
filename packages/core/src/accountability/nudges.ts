import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import type { SmsProvider } from "@athena/contracts";
import { appointment, assignment, candidate, consultant as consultantTable, consultantNudge, costRecord } from "@athena/db/schema";
import { emit, type EmitTx } from "../events/emit";
import { rows } from "../db-rows";
import { NUDGE_LADDER, TAKE_BACK_AFTER_MS, nudgeText, type NudgeSubject } from "./ladder";
import { takeBackAssignment } from "./take-back";

export interface TickSummary {
  nudgesCreated: number;
  nudgesSent: number;
  sendFailures: number;
  takeBacks: number;
}

/**
 * The accountability tick (every 5 minutes). Deterministic and idempotent:
 * a nudge row is created exactly once per (subject, kind) when due — the
 * unique indexes guarantee it — and sent when a phone exists; unsent rows
 * retry next tick. 48h with no first touch → take-back and re-route.
 *
 * Subjects: assignments awaiting first touch (clock from offered_at) and
 * appointments that have ended without a disposition (clock from ends_at).
 */
/** A fixed provider, or one chosen per consultant (e.g. their own CRM sub-account). */
export type SmsResolver = SmsProvider | null | ((consultant: { id: string; ghlRef: string | null }) => SmsProvider | null);

export async function runAccountabilityTick(
  db: EmitTx,
  sms: SmsResolver,
  args: { orgId?: string; managerPhone?: string | null; now?: Date },
): Promise<TickSummary> {
  const now = args.now ?? new Date();
  const summary: TickSummary = { nudgesCreated: 0, nudgesSent: 0, sendFailures: 0, takeBacks: 0 };
  const orgFilter = args.orgId ? sql`and org_id = ${args.orgId}` : sql``;

  // 1. First-touch ladder + take-back.
  const pending = rows<{ id: string; org_id: string; consultant_id: string; candidate_id: string; offered_at: string | Date }>(
    await db.execute(sql`select id, org_id, consultant_id, candidate_id, offered_at from assignment
      where status in ('offered', 'accepted') and first_touch_at is null ${orgFilter}`),
  );
  for (const a of pending) {
    const offeredAt = new Date(a.offered_at);
    const elapsed = now.getTime() - offeredAt.getTime();
    if (elapsed >= TAKE_BACK_AFTER_MS) {
      const r = await takeBackAssignment(db, { orgId: a.org_id, assignmentId: a.id, reason: "no_touch_48h", now });
      if (r.ok) summary.takeBacks += 1;
      continue;
    }
    for (const step of NUDGE_LADDER) {
      if (elapsed < step.afterMs) break;
      const created = await createNudge(db, { orgId: a.org_id, consultantId: a.consultant_id, assignmentId: a.id, kind: step.kind, dueAt: new Date(offeredAt.getTime() + step.afterMs) });
      if (created) summary.nudgesCreated += 1;
    }
  }

  // 2. Disposition ladder for ended appointments without a disposition.
  const ended = rows<{ id: string; org_id: string; consultant_id: string; ends_at: string | Date }>(
    await db.execute(sql`select ap.id, ap.org_id, ap.consultant_id, ap.ends_at from appointment ap
      left join disposition d on d.appointment_id = ap.id
      where ap.status = 'scheduled' and ap.ends_at <= ${now.toISOString()}::timestamptz and d.id is null ${args.orgId ? sql`and ap.org_id = ${args.orgId}` : sql``}`),
  );
  for (const ap of ended) {
    const endsAt = new Date(ap.ends_at);
    const elapsed = now.getTime() - endsAt.getTime();
    for (const step of NUDGE_LADDER) {
      if (elapsed < step.afterMs) break;
      const created = await createNudge(db, { orgId: ap.org_id, consultantId: ap.consultant_id, appointmentId: ap.id, kind: step.kind, dueAt: new Date(endsAt.getTime() + step.afterMs) });
      if (created) summary.nudgesCreated += 1;
    }
  }

  // 3. Send anything due and unsent.
  const unsent = await db.select().from(consultantNudge)
    .where(and(isNull(consultantNudge.sentAt), lte(consultantNudge.dueAt, now), ...(args.orgId ? [eq(consultantNudge.orgId, args.orgId)] : [])));
  for (const n of unsent) {
    const sent = await sendNudge(db, sms, n, { managerPhone: args.managerPhone ?? null, now });
    if (sent) summary.nudgesSent += 1;
    else summary.sendFailures += 1;
  }
  return summary;
}

async function createNudge(
  db: EmitTx,
  n: { orgId: string; consultantId: string; assignmentId?: string; appointmentId?: string; kind: (typeof NUDGE_LADDER)[number]["kind"]; dueAt: Date },
): Promise<boolean> {
  const inserted = await db.insert(consultantNudge)
    .values({ orgId: n.orgId, consultantId: n.consultantId, assignmentId: n.assignmentId, appointmentId: n.appointmentId, kind: n.kind, dueAt: n.dueAt })
    .onConflictDoNothing()
    .returning({ id: consultantNudge.id });
  return inserted.length > 0;
}

async function sendNudge(
  db: EmitTx,
  smsResolver: SmsResolver,
  n: typeof consultantNudge.$inferSelect,
  opts: { managerPhone: string | null; now: Date },
): Promise<boolean> {
  const [cons] = await db.select().from(consultantTable).where(eq(consultantTable.id, n.consultantId)).limit(1);
  if (!cons) return false;
  const sms = typeof smsResolver === "function" ? smsResolver({ id: cons.id, ghlRef: cons.ghlRef }) : smsResolver;
  const subject: NudgeSubject = n.assignmentId ? "first_touch" : "disposition";
  let candidateName = "the candidate";
  let anchor = n.dueAt;
  if (n.assignmentId) {
    const [a] = await db.select({ candidateId: assignment.candidateId, offeredAt: assignment.offeredAt }).from(assignment).where(eq(assignment.id, n.assignmentId)).limit(1);
    if (a) { anchor = a.offeredAt; candidateName = (await nameOf(db, a.candidateId)) ?? candidateName; }
  } else if (n.appointmentId) {
    const [ap] = await db.select({ candidateId: appointment.candidateId, endsAt: appointment.endsAt }).from(appointment).where(eq(appointment.id, n.appointmentId)).limit(1);
    if (ap) { anchor = ap.endsAt; candidateName = (await nameOf(db, ap.candidateId)) ?? candidateName; }
  }
  const hours = Math.round((opts.now.getTime() - anchor.getTime()) / 3_600_000);
  const step = NUDGE_LADDER.find((s) => s.kind === n.kind)!;
  const to = step.toManager ? opts.managerPhone : cons.phone;
  const body = nudgeText(n.kind, subject, { consultantFirst: cons.name.split(" ")[0] ?? cons.name, candidateName, hours });
  if (!sms || !to) return false;
  let providerRef: string;
  try {
    providerRef = (await sms.sendSms({ to, body })).providerMessageId;
  } catch {
    return false;
  }
  await db.transaction(async (tx) => {
    await tx.update(consultantNudge).set({ sentAt: opts.now, providerRef }).where(eq(consultantNudge.id, n.id));
    await tx.insert(costRecord).values({ orgId: n.orgId, category: "message", provider: sms.name, amountUsd: "0.010000", detail: { kind: "nudge_sms", nudgeId: n.id } });
    await emit(tx, {
      orgId: n.orgId, type: "consultant.nudged", entityType: n.assignmentId ? "assignment" : "appointment", entityId: n.assignmentId ?? n.appointmentId ?? undefined,
      payload: { nudgeId: n.id, kind: n.kind, subject, consultantId: n.consultantId, toManager: step.toManager },
    });
  });
  return true;
}

async function nameOf(db: EmitTx, candidateId: string): Promise<string | null> {
  const [c] = await db.select({ name: candidate.fullName }).from(candidate).where(eq(candidate.id, candidateId)).limit(1);
  return c?.name ?? null;
}

/** Nudges awaiting a reply from this consultant, newest first. */
export async function openNudgesFor(db: EmitTx, consultantId: string) {
  return db.select().from(consultantNudge)
    .where(and(eq(consultantNudge.consultantId, consultantId), isNull(consultantNudge.response), inArray(consultantNudge.kind, ["plus_1h", "plus_4h", "plus_24h_manager"])))
    .orderBy(sql`sent_at desc nulls last, due_at desc`);
}

