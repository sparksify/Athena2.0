import { NextResponse } from "next/server";
import { getDb } from "@athena/db";
import { drainRoutingJobs, LlmGateway, runAccountabilityTick } from "@athena/core";
import { GmailProvider } from "@athena/email-gmail";
import { GhlCrmAdapter } from "@athena/crm-ghl";
import { GhlSmsProvider } from "@athena/sms-ghl";
import { AnthropicProvider } from "@athena/llm-anthropic";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Routing + accountability tick (Vercel cron, every 5 minutes). Drains
 * routing.assign / routing.intro / crm.sync jobs, then runs the nudge
 * ladder and the 48h take-back. Every step is idempotent, so manual or
 * overlapping invocations are safe. Unconfigured vendors defer their jobs.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.DATABASE_URL) return NextResponse.json({ skipped: "DATABASE_URL not configured" });
  const db = getDb();
  const appUrl = process.env.APP_URL ?? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "athena2-0.vercel.app"}`;
  const drained = await drainRoutingJobs(db, {
    llm: new LlmGateway(new AnthropicProvider(), db),
    email: GmailProvider.configured() ? new GmailProvider() : null,
    crm: GhlCrmAdapter.configured() ? new GhlCrmAdapter() : null,
    appUrl,
  }, { limit: 50 });
  const tick = await runAccountabilityTick(db, GhlSmsProvider.configured() ? new GhlSmsProvider() : null, {
    managerPhone: process.env.MANAGER_SMS_TO ?? null,
  });
  return NextResponse.json({ drained, tick });
}
