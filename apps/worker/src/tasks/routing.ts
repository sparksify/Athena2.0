import { schedules, task } from "@trigger.dev/sdk";
import { getDb } from "@athena/db";
import { createLogger, drainRoutingJobs, LlmGateway, runAccountabilityTick } from "@athena/core";
import { GmailProvider } from "@athena/email-gmail";
import { GhlCrmAdapter } from "@athena/crm-ghl";
import { GhlSmsProvider } from "@athena/sms-ghl";
import { AnthropicProvider } from "@athena/llm-anthropic";
import { ghlAgency } from "../ghl";

const appUrl = () => process.env.APP_URL ?? "https://athena2-0.vercel.app";

/** Drains routing.assign / routing.intro / crm.sync from the outbox. */
export const routingDrain = task({
  id: "routing.drain",
  run: async (payload: { limit?: number }) => {
    const db = getDb();
    const agency = await ghlAgency();
    const ghl = { agencyToken: agency?.agencyToken, companyId: agency?.companyId ?? undefined };
    const summary = await drainRoutingJobs(db, {
      llm: new LlmGateway(new AnthropicProvider(), db),
      email: GmailProvider.configured() ? new GmailProvider() : null,
      crm: GhlCrmAdapter.configured(agency) ? (c) => (c.ghlRef || process.env.GHL_LOCATION_ID ? new GhlCrmAdapter(ghl).forLocation(c.ghlRef ?? process.env.GHL_LOCATION_ID!, c.ghlToken) : null) : null,
      appUrl: appUrl(),
    }, { limit: payload.limit ?? 50 });
    createLogger().info("routing.drain", { ...summary });
    return summary;
  },
});

/** Nudge ladder (+1h / +4h / +24h manager) and the 48h take-back, every 5 minutes. */
export const accountabilityTick = schedules.task({
  id: "accountability.tick",
  cron: "*/5 * * * *",
  run: async () => {
    const db = getDb();
    const agency = await ghlAgency();
    const ghl = { agencyToken: agency?.agencyToken, companyId: agency?.companyId ?? undefined };
    const summary = await runAccountabilityTick(db, GhlSmsProvider.configured(agency) ? (c) => (c.ghlRef || process.env.GHL_LOCATION_ID ? new GhlSmsProvider(ghl).forLocation(c.ghlRef ?? process.env.GHL_LOCATION_ID!, c.ghlToken) : null) : null, {
      managerPhone: process.env.MANAGER_SMS_TO ?? null,
    });
    createLogger().info("accountability.tick", { ...summary });
    return summary;
  },
});
