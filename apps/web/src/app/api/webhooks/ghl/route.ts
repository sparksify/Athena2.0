import { NextResponse } from "next/server";
import { getDb } from "@athena/db";
import { applyCrmStage, handleInboundSms } from "@athena/core";
import { parseGhlStageWebhook } from "@athena/crm-ghl";
import { parseGhlInboundSms } from "@athena/sms-ghl";

export const dynamic = "force-dynamic";

/**
 * GoHighLevel webhooks (workflow → webhook action). Two shapes arrive here:
 * a consultant's SMS reply (numeric disposition / "1" = first contact made)
 * and an opportunity stage change (mirrored into Athena without echo).
 * Guarded by a shared secret in the URL (?key=) or x-athena-secret header.
 */
export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "database not configured" }, { status: 503 });
  const secret = process.env.GHL_WEBHOOK_SECRET;
  if (secret) {
    const given = req.headers.get("x-athena-secret") ?? new URL(req.url).searchParams.get("key");
    if (given !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let payload: unknown;
  try { payload = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const sms = parseGhlInboundSms(payload);
  if (sms) return NextResponse.json(await handleInboundSms(getDb(), sms));
  const stage = parseGhlStageWebhook(payload);
  if (stage) return NextResponse.json(await applyCrmStage(getDb(), stage));
  return NextResponse.json({ ignored: true });
}
