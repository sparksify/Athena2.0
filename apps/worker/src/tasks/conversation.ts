import { task } from "@trigger.dev/sdk";
import { eq } from "drizzle-orm";
import { getDb } from "@athena/db";
import { agentJob } from "@athena/db/schema";
import { classifyReply, createLogger, LlmGateway, sendAutoReply } from "@athena/core";
import { SmartleadProvider } from "@athena/email-smartlead";
import { AnthropicProvider } from "@athena/llm-anthropic";

/**
 * Drains the conversation outbox: classify jobs (queued by the reply
 * webhook) and auto-reply jobs (queued by the classifier, only for eligible
 * classes at ≥0.90 — and re-checked in code before any send).
 */
export const conversationDrain = task({
  id: "conversation.drain",
  run: async (payload: { limit?: number }) => {
    const db = getDb();
    const log = createLogger();
    const gateway = new LlmGateway(new AnthropicProvider(), db);
    const jobs = await db
      .select()
      .from(agentJob)
      .where(eq(agentJob.status, "queued"))
      .limit(payload.limit ?? 50);
    const summary = { classified: 0, autoReplied: 0, refused: 0, skipped: 0 };
    for (const job of jobs) {
      if (job.type !== "conversation.classify" && job.type !== "conversation.auto_reply") continue;
      const claimed = await db
        .update(agentJob)
        .set({ status: "running" })
        .where(eq(agentJob.id, job.id))
        .returning({ id: agentJob.id });
      if (!claimed[0]) continue;
      const messageId = (job.payload as { messageId: string }).messageId;
      try {
        if (job.type === "conversation.classify") {
          const r = await classifyReply(db, gateway, { messageId, agentJobId: job.id });
          if (r) summary.classified += 1;
          else summary.skipped += 1;
        } else {
          const r = await sendAutoReply(db, gateway, new SmartleadProvider(), { messageId, agentJobId: job.id });
          if (r.sent) summary.autoReplied += 1;
          else summary.refused += 1;
        }
        await db.update(agentJob).set({ status: "succeeded" }).where(eq(agentJob.id, job.id));
      } catch (err) {
        log.error("conversation job failed", { jobId: job.id, error: String(err) });
        await db.update(agentJob).set({ status: "failed" }).where(eq(agentJob.id, job.id));
      }
    }
    return summary;
  },
});
