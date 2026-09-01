import { task } from "@trigger.dev/sdk";
import { getDb } from "@athena/db";
import { createLogger, scoreCandidates } from "@athena/core";

/** Re-scores an org's unmerged candidates. Idempotent — unchanged inputs write nothing. */
export const intelligenceScore = task({
  id: "intelligence.score",
  run: async (payload: { orgId: string }): Promise<{ scored: number; unchanged: number }> => {
    const db = getDb();
    const log = createLogger();
    const result = await scoreCandidates(db, payload.orgId);
    log.info("intelligence.score completed", { ...result });
    return result;
  },
});
