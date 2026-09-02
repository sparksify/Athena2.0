import { and, count, desc, eq, gte } from "drizzle-orm";
import { candidate, emailVerification, identifier, mailbox, message } from "@athena/db/schema";
import type { EmitTx } from "../events/emit";
import { isSuppressed } from "./suppress";

export interface SendWindow {
  days: number[]; // 0=Sunday … 6=Saturday
  startHour: number; // inclusive, local to timezone
  endHour: number; // exclusive
  timezone: string;
}

export type GateResult =
  | { ok: true; email: string }
  | { ok: false; reason: string };

/** Local weekday + hour for a timezone, via Intl (no tz dependency). */
export function localParts(now: Date, timezone: string): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const dayName = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(dayName);
  return { day, hour };
}

export function windowOpen(window: SendWindow, now: Date): boolean {
  const { day, hour } = localParts(now, window.timezone);
  return window.days.includes(day) && hour >= window.startHour && hour < window.endHour;
}

/**
 * The deterministic pre-send gates, in ARCHITECTURE.md C.6 order:
 * verification → suppression → mailbox cap/window. Callers must have already
 * verified draft.status === 'approved' under lock. Every gate is code — no
 * agent is ever asked to honor these.
 */
export async function evaluateSendGates(
  tx: EmitTx,
  args: {
    orgId: string;
    candidateId: string;
    mailboxId: string | null;
    sendWindow: SendWindow;
    now: Date;
  },
): Promise<GateResult> {
  const [cand] = await tx
    .select({ email: candidate.primaryEmail, mergedIntoId: candidate.mergedIntoId })
    .from(candidate)
    .where(and(eq(candidate.orgId, args.orgId), eq(candidate.id, args.candidateId)))
    .limit(1);
  if (!cand) return { ok: false, reason: "candidate_not_found" };
  if (cand.mergedIntoId) return { ok: false, reason: "candidate_merged" };
  const email = cand.email?.trim().toLowerCase();
  if (!email) return { ok: false, reason: "no_email" };

  // Verification gate: the latest verification for this address must be 'valid'.
  const [ident] = await tx
    .select({ id: identifier.id })
    .from(identifier)
    .where(
      and(
        eq(identifier.orgId, args.orgId),
        eq(identifier.type, "email"),
        eq(identifier.valueNormalized, email),
      ),
    )
    .limit(1);
  if (!ident) return { ok: false, reason: "email_unverified" };
  const [verif] = await tx
    .select({ result: emailVerification.result })
    .from(emailVerification)
    .where(eq(emailVerification.identifierId, ident.id))
    .orderBy(desc(emailVerification.checkedAt))
    .limit(1);
  if (!verif) return { ok: false, reason: "email_unverified" };
  if (verif.result !== "valid") return { ok: false, reason: `email_${verif.result}` };

  // Suppression gate.
  if (await isSuppressed(tx, args.orgId, "email", email)) {
    return { ok: false, reason: "suppressed" };
  }

  // Mailbox: assigned, active, under today's cap.
  if (!args.mailboxId) return { ok: false, reason: "no_mailbox" };
  const [mb] = await tx
    .select({ status: mailbox.status, dailyCap: mailbox.dailyCap })
    .from(mailbox)
    .where(and(eq(mailbox.orgId, args.orgId), eq(mailbox.id, args.mailboxId)))
    .limit(1);
  if (!mb) return { ok: false, reason: "mailbox_not_found" };
  if (mb.status !== "active") return { ok: false, reason: `mailbox_${mb.status}` };
  const dayStart = new Date(args.now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const [sentToday] = await tx
    .select({ n: count() })
    .from(message)
    .where(
      and(
        eq(message.mailboxId, args.mailboxId),
        eq(message.direction, "outbound"),
        gte(message.occurredAt, dayStart),
      ),
    );
  if ((sentToday?.n ?? 0) >= mb.dailyCap) return { ok: false, reason: "mailbox_cap_reached" };

  // Send window.
  if (!windowOpen(args.sendWindow, args.now)) return { ok: false, reason: "outside_send_window" };

  return { ok: true, email };
}
