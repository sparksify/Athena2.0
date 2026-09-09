import { NextResponse } from "next/server";
import { getDb } from "@athena/db";
import { handleCalendarEvent } from "@athena/core";
import { parseCalendlyEvent, verifyCalendlySignature } from "@athena/calendar-calendly";

export const dynamic = "force-dynamic";

/**
 * Calendly webhook subscription (invitee.created / invitee.canceled).
 * Idempotent on the appointment's UNIQUE(provider, external_ref).
 */
export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "database not configured" }, { status: 503 });
  const rawBody = await req.text();
  const key = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  if (key && !verifyCalendlySignature(rawBody, req.headers.get("calendly-webhook-signature") ?? "", key)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const evt = parseCalendlyEvent(payload);
  if (!evt) return NextResponse.json({ ignored: true });
  const result = await handleCalendarEvent(getDb(), evt);
  return NextResponse.json(result);
}
