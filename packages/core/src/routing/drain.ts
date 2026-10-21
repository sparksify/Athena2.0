import { eq, inArray } from "drizzle-orm";
import type { CrmSyncAdapter, EmailProvider } from "@athena/contracts";
import { agentJob, consultant, consultantSecret, opportunity } from "@athena/db/schema";
import { syncOpportunity } from "../accountability/crm";
import type { EmitTx } from "../events/emit";
import type { LlmGateway } from "../llm/gateway";
import { routeCandidate, type RoutingTrigger } from "./assign";
import { sendWarmIntro } from "./intro";

/** What a per-consultant adapter needs: the sub-account and, when on file, its own token. */
export interface ConsultantRef { id: string; ghlRef: string | null; ghlToken: string | null }

export const ROUTING_JOB_TYPES = ["routing.assign", "routing.intro", "crm.sync"] as const;

export interface DrainDeps {
  llm: LlmGateway;
  /** Persona sender; null until the Gmail service account is configured (intros stay queued). */
  email: EmailProvider | null;
  /** GHL mirror; null until configured (sync jobs stay queued). A function picks the consultant's own sub-account. */
  crm: CrmSyncAdapter | null | ((consultant: ConsultantRef) => CrmSyncAdapter | null);
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
        const crm = typeof deps.crm === "function" ? await resolveCrm(db, deps.crm, String(p.opportunityId)) : deps.crm;
        if (!crm) throw new Error("no CRM sub-account for this consultant (set ghl_ref on the roster or GHL_LOCATION_ID)");
        result = await syncOpportunity(db, crm, { opportunityId: String(p.opportunityId), agentJobId: job.id });
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

async function resolveCrm(
  db: EmitTx,
  pick: (c: ConsultantRef) => CrmSyncAdapter | null,
  opportunityId: string,
): Promise<CrmSyncAdapter | null> {
  const [row] = await db.select({ id: consultant.id, ghlRef: consultant.ghlRef, ghlToken: consultantSecret.ghlToken }).from(consultant)
    .innerJoin(opportunity, eq(opportunity.consultantId, consultant.id))
    .leftJoin(consultantSecret, eq(consultantSecret.consultantId, consultant.id))
    .where(eq(opportunity.id, opportunityId)).limit(1);
  return row ? pick({ id: row.id, ghlRef: row.ghlRef, ghlToken: row.ghlToken ?? null }) : null;
}
