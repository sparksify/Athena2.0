import { task } from "@trigger.dev/sdk";
import { getDb } from "@athena/db";
import { createLogger, draftOutreach, LlmGateway, runSendTick, type SendTickSummary } from "@athena/core";
import { SmartleadProvider } from "@athena/email-smartlead";
import { AnthropicProvider } from "@athena/llm-anthropic";

/**
 * Scheduler tick: pushes approved drafts through the gated send path.
 * Every cap, window, suppression and verification check re-runs inside
 * core's sendApprovedDraft — this task only picks work.
 */
export const outreachSend = task({
  id: "outreach.send",
  run: async (payload: { limit?: number }): Promise<SendTickSummary> => {
    const db = getDb();
    const log = createLogger();
    const provider = new SmartleadProvider();
    const summary = await runSendTick(db, provider, { limit: payload.limit ?? 20 });
    log.info("outreach.send tick", { ...summary });
    return summary;
  },
});

/** Drafts emails for campaign members; output lands in the human approval queue. */
export const outreachDraftBatch = task({
  id: "outreach.draft",
  run: async (payload: {
    orgId: string;
    campaignId: string;
    angleId: string;
    candidateIds: string[];
  }): Promise<{ drafted: number; skipped: number }> => {
    const db = getDb();
    const log = createLogger();
    const gateway = new LlmGateway(new AnthropicProvider(), db);
    let drafted = 0;
    let skipped = 0;
    for (const candidateId of payload.candidateIds) {
      const res = await draftOutreach(db, gateway, {
        orgId: payload.orgId,
        campaignId: payload.campaignId,
        angleId: payload.angleId,
        candidateId,
      });
      if (res.drafted) drafted += 1;
      else {
        skipped += 1;
        log.info("draft skipped", { candidateId, reason: res.reason });
      }
    }
    return { drafted, skipped };
  },
});
