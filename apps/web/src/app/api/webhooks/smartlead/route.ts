import { NextResponse } from "next/server";
import { getDb } from "@athena/db";
import { handleEmailWebhook } from "@athena/core";
import { parseSmartleadWebhook, verifySmartleadSignature } from "@athena/email-smartlead";

export const dynamic = "force-dynamic";

/**
 * Smartlead delivery webhooks: replies, bounces, complaints, unsubscribes.
 * Idempotent end-to-end (message unique index / suppression unique index),
 * so provider retries are safe. Opt-outs land in suppression in the same
 * transaction as the interaction — the next send is blocked on commit.
 */
export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }
  const rawBody = await req.text();

  const secret = process.env.SMARTLEAD_WEBHOOK_SECRET;
  if (secret) {
    const signature = req.headers.get("x-smartlead-signature") ?? "";
    if (!verifySmartleadSignature(rawBody, signature, secret)) {
      return NextResponse.json({ error: "bad signature" }, { status: 401 });
    }
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const evt = parseSmartleadWebhook(payload);
  if (!evt) return NextResponse.json({ ignored: true });

  const result = await handleEmailWebhook(getDb(), evt);
  return NextResponse.json(result);
}
