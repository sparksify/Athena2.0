import type { EmailVerifier } from "@athena/contracts";
import { agentJob, costRecord, emailVerification } from "@athena/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { emit, type EmitTx } from "../events/emit";

type Db = EmitTx & {
  transaction: <T>(fn: (tx: EmitTx) => Promise<T>) => Promise<T>;
};

/** Per-verification cost written to cost_record (MillionVerifier list pricing). */
const VERIFICATION_COST_USD = Number(process.env.EMAIL_VERIFICATION_COST_USD ?? "0.0004");

/**
 * Runs one queued verify.email job: calls the verifier, then commits the
 * verification result, cost record, job completion, and event atomically.
 * Idempotent: a job not in 'queued' status is skipped.
 */
export async function runVerificationJob(
  db: Db,
  verifier: EmailVerifier,
  job: { id: string; orgId: string; identifierId: string; email: string },
): Promise<"done" | "skipped" | "failed"> {
  // Claim only queued or previously-failed jobs — a duplicate runner finds
  // nothing to claim. succeeded/running jobs are never re-claimed.
  const [claimed] = await db
    .update(agentJob)
    .set({ status: "running", startedAt: new Date() })
    .where(and(eq(agentJob.id, job.id), inArray(agentJob.status, ["queued", "failed"])))
    .returning({ id: agentJob.id });
  if (!claimed) return "skipped";

  // Retry safety: if a prior attempt already recorded a verification for this
  // identifier, complete the job without re-verifying (no duplicate work/spend).
  const [already] = await db
    .select({ result: emailVerification.result })
    .from(emailVerification)
    .where(eq(emailVerification.identifierId, job.identifierId))
    .limit(1);
  if (already) {
    await db
      .update(agentJob)
      .set({ status: "succeeded", finishedAt: new Date(), result: { result: already.result, deduped: true } })
      .where(eq(agentJob.id, job.id));
    return "done";
  }

  try {
    const { result, raw } = await verifier.verify(job.email);
    await db.transaction(async (tx) => {
      await tx.insert(emailVerification).values({
        orgId: job.orgId,
        identifierId: job.identifierId,
        provider: verifier.name,
        result,
        raw: raw ?? {},
      });
      await tx.insert(costRecord).values({
        orgId: job.orgId,
        agentJobId: job.id,
        category: "verification",
        provider: verifier.name,
        amountUsd: VERIFICATION_COST_USD.toFixed(6),
        detail: { email: job.email },
      });
      await tx
        .update(agentJob)
        .set({ status: "succeeded", finishedAt: new Date(), result: { result } })
        .where(eq(agentJob.id, job.id));
      await emit(tx, {
        orgId: job.orgId,
        type: "identifier.verified",
        entityType: "identifier",
        entityId: job.identifierId,
        payload: { result, provider: verifier.name },
      });
    });
    return "done";
  } catch (err) {
    await db
      .update(agentJob)
      .set({ status: "failed", finishedAt: new Date(), error: String(err) })
      .where(eq(agentJob.id, job.id));
    return "failed";
  }
}
