import { createHmac, timingSafeEqual } from "node:crypto";
import type { CalendarProvider } from "@athena/contracts";

export interface CalendlyEvent {
  kind: "scheduled" | "canceled";
  provider: "calendly";
  externalRef: string;
  startsAt: Date;
  endsAt?: Date;
  inviteeEmail: string;
  hostEmail?: string;
  raw: unknown;
}

/** Calendly webhook subscription events: invitee.created / invitee.canceled. */
export function parseCalendlyEvent(payload: unknown): CalendlyEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { event?: string; payload?: Record<string, unknown> };
  const body = p.payload ?? {};
  const kind = p.event === "invitee.created" ? "scheduled" : p.event === "invitee.canceled" ? "canceled" : null;
  if (!kind) return null;
  const scheduled = (body.scheduled_event ?? {}) as Record<string, unknown>;
  const externalRef = String(scheduled.uri ?? body.event ?? "").trim();
  const inviteeEmail = String(body.email ?? "").trim();
  const start = scheduled.start_time ? new Date(String(scheduled.start_time)) : null;
  if (!externalRef || !inviteeEmail || !start || Number.isNaN(start.getTime())) return null;
  const memberships = (scheduled.event_memberships ?? []) as { user_email?: string }[];
  return {
    kind, provider: "calendly", externalRef, startsAt: start,
    endsAt: scheduled.end_time ? new Date(String(scheduled.end_time)) : undefined,
    inviteeEmail, hostEmail: memberships[0]?.user_email, raw: payload,
  };
}

/** Calendly-Webhook-Signature: t=<ts>,v1=<hmac-sha256(ts + "." + body)>. */
export function verifyCalendlySignature(rawBody: string, header: string, signingKey: string, toleranceSec = 300): boolean {
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;
  const expected = createHmac("sha256", signingKey).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class CalendlyProvider implements CalendarProvider {
  readonly name = "calendly";
  parseWebhook(payload: unknown) {
    const e = parseCalendlyEvent(payload);
    if (!e) return null;
    return { kind: e.kind, externalRef: e.externalRef, startsAt: e.startsAt, inviteeEmail: e.inviteeEmail };
  }
}
