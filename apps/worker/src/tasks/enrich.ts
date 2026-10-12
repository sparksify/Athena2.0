import { schedules } from "@trigger.dev/sdk";
import { sql } from "drizzle-orm";
import { getDb } from "@athena/db";
import { createLogger, drainCrmLookups, drainResearch, enqueueResearch, LlmGateway } from "@athena/core";
import { GhlCrmAdapter } from "@athena/crm-ghl";
import { AnthropicProvider } from "@athena/llm-anthropic";

/** CRM history lookups and research notes, every 10 minutes. */
export const enrichTick = schedules.task({
  id: "enrich.tick",
  cron: "*/10 * * * *",
  run: async () => {
    const db = getDb();
    const log = createLogger();
    const crm = GhlCrmAdapter.readConfigured() ? await drainCrmLookups(db, new GhlCrmAdapter(), { limit: 300 }) : null;
    let research = null;
    if (process.env.ANTHROPIC_API_KEY) {
      const orgs = await db.execute(sql`select distinct org_id from candidate where current_score is not null`);
      const ids = (Array.isArray(orgs) ? orgs : ((orgs as { rows?: unknown[] }).rows ?? [])) as { org_id: string }[];
      for (const o of ids) await enqueueResearch(db, o.org_id, { limit: 200 });
      research = await drainResearch(db, new LlmGateway(new AnthropicProvider(), db), { limit: 40 });
    }
    log.info("enrich.tick", { crm, research });
    return { crm, research };
  },
});
