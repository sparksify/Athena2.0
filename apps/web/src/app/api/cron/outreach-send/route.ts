import { NextResponse } from "next/server";
import { getDb } from "@athena/db";
import { runSendTick } from "@athena/core";
import { SmartleadProvider } from "@athena/email-smartlead";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduler tick (Vercel cron, every 10 minutes — see vercel.json). Every
 * gate re-checks inside the send path, so an extra or manual invocation is
 * always safe. The Trigger.dev task is the successor once the worker deploys.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ skipped: "DATABASE_URL not configured" });
  }
  if (!process.env.SMARTLEAD_API_KEY || !process.env.SMARTLEAD_API_CAMPAIGN_ID) {
    return NextResponse.json({ skipped: "Smartlead not configured" });
  }
  const summary = await runSendTick(getDb(), new SmartleadProvider(), { limit: 20 });
  return NextResponse.json(summary);
}
