import { task } from "@trigger.dev/sdk";
import { getDb } from "@athena/db";
import { createLogger, pendingVerificationJobs, runVerificationJob } from "@athena/core";
import { MillionVerifierProvider } from "@athena/verify-millionverifier";

/**
 * Drains queued verify.email outbox jobs for an org. Enqueued by the import
 * pipeline; safe to run repeatedly (claims are status-guarded and verification
 * results dedupe per identifier).
 */
export const verifyEmails = task({
  id: "verify.emails",
  run: async (payload: { orgId: string; limit?: number }) => {
    const db = getDb();
    const log = createLogger();
    const verifier = new MillionVerifierProvider();
    const jobs = await pendingVerificationJobs(db, payload.orgId, payload.limit ?? 1000);
    let done = 0, failed = 0, skipped = 0;
    for (const job of jobs) {
      const p = job.payload as { identifierId: string; email: string };
      const outcome = await runVerificationJob(db, verifier, {
        id: job.id,
        orgId: payload.orgId,
        identifierId: p.identifierId,
        email: p.email,
      });
      if (outcome === "done") done += 1;
      else if (outcome === "failed") failed += 1;
      else skipped += 1;
    }
    log.info("verify.emails drained", { done, failed, skipped });
    return { done, failed, skipped };
  },
});
