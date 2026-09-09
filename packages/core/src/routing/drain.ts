import { eq, inArray } from "drizzle-orm";
import type { CrmSyncAdapter, EmailProvider } from "@athena/contracts";
import { agentJob } from "@athena/db/schema";
import { syncOpportunity } from "../accountability/crm";
import type { EmitTx } from "../events/emit";
import type { LlmGateway } from "../llm/gateway";
import { routeCandidate, type RoutingTrigger } from "./assign";
import { sendWarmIntro } from "./intro";

export const ROUTING_JOB_TYPES = ["routing.assign", "routing.intro", "crm.sync"] as const;

export interface DrainDeps {
  llm: LlmGateway;
  /** Persona sender; null until the Gmail service account is configured (intros stay queued). */
  email: EmailProvider | null;
  /** GHL mirror; null until configured (sync jobs stay queued). */
  crm: CrmSyncAdapter | null;
  appUrl: string;
}

export interface DrainSummary { assigned: number; introsSent: number; introsRefused: number; synced: number; failed: number; deferred: number }

/**
 * Drains the routing outbox. Jobs whose dependency isn't configured yet are
 * left queued (deferred) rather than failed, so the intro goes out the
 * moment the persona mailbox exists — the 5-minute clock is measured from
 * the offer, and the event carries the delay.
 */
export async function drainRoutingJobs(db: EmitTx, deps: DrainDeps, opts: { limit?: number; now?: Date } = {}): Promise<DrainSummary> {
  const summary: DrainSummary = { assigned: 0, introsSent: 0, introsRefused: 0, synced: 0, failed: 0, deferred: 0 };
  const jobs = await db.select().from(agentJob)
    .where(inArray(agentJob.type, [...ROUTING_JOB_TYPES]))
    .orderBy(agentJob.createdAt)
    .limit(opts.limit ?? 50);
  for (const job of jobs) {
    if (job.status !== "queued") continue;
    if (job.type === "routing.intro" && !deps.email) { summary.deferred += 1; continue; }
    if (job.type === "crm.sync" && !deps.crm) { summary.deferred += 1; continue; }
    const claimed = await db.update(agentJob).set({ status: "running", startedAt: new Date() })
      .where(eq(agentJob.id, job.id)).returning({ id: agentJob.id });
    if (!claimed[0]) continue;
    const p = job.payload as Record<string, unknown>;
    try {
      let result: unknown;
      if (job.type === "routing.assign") {
        result = await routeCandidate(db, {
          orgId: job.orgId, candidateId: String(p.candidateId), trigger: (p.trigger as RoutingTrigger) ?? "positive_reply",
          conversationId: (p.conversationId as string | null) ?? null, actorType: p.actorId ? "user" : "agent", actorId: p.actorId as string | undefined,
          agentJobId: job.id, now: opts.now,
        });
        if ((result as { assigned: boolean }).assigned) summary.assigned += 1;
      } else if (job.type === "routing.intro") {
        result = await sendWarmIntro(db, deps.llm, deps.email!, { assignmentId: String(p.assignmentId), appUrl: deps.appUrl, agentJobId: job.id, now: opts.now });
        if ((result as { sent: boolean }).sent) summary.introsSent += 1;
        else summary.introsRefused += 1;
      } else {
        result = await syncOpportunity(db, deps.crm!, { opportunityId: String(p.opportunityId), agentJobId: job.id });
        summary.synced += 1;
      }
      await db.update(agentJob).set({ status: "succeeded", finishedAt: new Date(), result: result as Record<string, unknown> }).where(eq(agentJob.id, job.id));
    } catch (err) {
      summary.failed += 1;
      await db.update(agentJob).set({ status: "failed", finishedAt: new Date(), error: String(err) }).where(eq(agentJob.id, job.id));
    }
  }
  return summary;
}
