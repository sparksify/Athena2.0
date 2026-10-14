import { NextResponse } from "next/server";
import { getDb } from "@athena/db";
import { drainCrmLookups, drainResearch, enqueueResearch, LlmGateway } from "@athena/core";
import { GhlAgencyReader, GhlCrmAdapter } from "@athena/crm-ghl";
import { AnthropicProvider } from "@athena/llm-anthropic";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Enrichment tick (Vercel cron, every 10 minutes): CRM history lookups
 * queued by imports, then research for anyone who crossed the score floor.
 * Both are idempotent and budget-aware; unconfigured vendors leave their
 * jobs queued rather than failing them.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.DATABASE_URL) return NextResponse.json({ skipped: "DATABASE_URL not configured" });
  const db = getDb();
  const crm = GhlCrmAdapter.readConfigured() ? await drainCrmLookups(db, new GhlAgencyReader(), { limit: 150 }) : { skipped: "GHL not configured" };
  let research: unknown = { skipped: "ANTHROPIC_API_KEY not configured" };
  if (process.env.ANTHROPIC_API_KEY) {
    const orgs = await db.execute(`select distinct org_id from candidate where current_score is not null`);
    const ids = (Array.isArray(orgs) ? orgs : ((orgs as { rows?: unknown[] }).rows ?? [])) as { org_id: string }[];
    let queued = 0;
    for (const o of ids) queued += await enqueueResearch(db, o.org_id, { limit: 100 });
    research = { queued, ...(await drainResearch(db, new LlmGateway(new AnthropicProvider(), db), { limit: 20 })) };
  }
  return NextResponse.json({ crm, research });
}
