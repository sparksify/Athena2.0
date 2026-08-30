import { task } from "@trigger.dev/sdk";
import { agentJob, costRecord } from "@athena/db/schema";
import { getDb } from "@athena/db";
import { createLogger, emit } from "@athena/core";
import { eq } from "drizzle-orm";

/**
 * Phase 0 proof task: writes an agent_job, an event, and a $0 cost_record,
 * all visible in the DB and on /ops/jobs.
 */
export const systemPing = task({
  id: "system.ping",
  run: async (payload: { orgId: string; agentJobId?: string }) => {
    const db = getDb();
    const log = createLogger();
    log.info("system.ping started", { orgId: payload.orgId });

    const jobId = await db.transaction(async (tx) => {
      let id = payload.agentJobId;
      if (id) {
        await tx
          .update(agentJob)
          .set({ status: "running", startedAt: new Date() })
          .where(eq(agentJob.id, id));
      } else {
        const [row] = await tx
          .insert(agentJob)
          .values({
            orgId: payload.orgId,
            type: "system.ping",
            status: "running",
            startedAt: new Date(),
            correlationId: log.correlationId,
          })
          .returning({ id: agentJob.id });
        id = row!.id;
      }

      await tx
        .update(agentJob)
        .set({ status: "succeeded", finishedAt: new Date(), result: { pong: true } })
        .where(eq(agentJob.id, id));

      await tx.insert(costRecord).values({
        orgId: payload.orgId,
        agentJobId: id,
        category: "other",
        provider: "system",
        amountUsd: "0",
        detail: { task: "system.ping" },
      });

      await emit(tx, {
        orgId: payload.orgId,
        type: "system.ping.completed",
        entityType: "agent_job",
        entityId: id,
        correlationId: log.correlationId,
      });
      return id;
    });

    log.info("system.ping completed", { jobId });
    return { jobId };
  },
});
