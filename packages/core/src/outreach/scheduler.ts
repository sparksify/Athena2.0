import { and, asc, count, eq, gte, inArray, isNull } from "drizzle-orm";
import type { EmailProvider } from "@athena/contracts";
import { campaign, mailbox, message, outreachDraft } from "@athena/db/schema";
import type { EmitTx } from "../events/emit";
import { sendApprovedDraft } from "./send";

export interface SendTickSummary {
  attempted: number;
  sent: number;
  blocked: number;
  refused: number;
  failed: number;
}

/**
 * One scheduler tick: pick approved drafts on active campaigns (oldest
 * first), assign a mailbox to any draft without one (least-loaded active
 * mailbox under its daily cap), and push each through the gated send path.
 * All caps/windows re-check inside sendApprovedDraft; this function only
 * chooses work, it enforces nothing.
 */
export async function runSendTick(
  db: EmitTx,
  provider: EmailProvider,
  opts: { now?: Date; limit?: number } = {},
): Promise<SendTickSummary> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 20;

  const drafts = await db
    .select({ id: outreachDraft.id, orgId: outreachDraft.orgId, mailboxId: outreachDraft.mailboxId })
    .from(outreachDraft)
    .innerJoin(campaign, eq(outreachDraft.campaignId, campaign.id))
    .where(and(eq(outreachDraft.status, "approved"), eq(campaign.status, "active")))
    .orderBy(asc(outreachDraft.createdAt))
    .limit(limit);

  const summary: SendTickSummary = { attempted: 0, sent: 0, blocked: 0, refused: 0, failed: 0 };

  for (const d of drafts) {
    if (!d.mailboxId) {
      const assigned = await assignMailbox(db, d.orgId, d.id, now);
      if (!assigned) continue; // no capacity anywhere; leave approved for next tick
    }
    summary.attempted++;
    const res = await sendApprovedDraft(db, provider, d.id, { now });
    if (res.sent) summary.sent++;
    else summary[res.outcome]++;
  }
  return summary;
}

/** Least-loaded active mailbox still under its daily cap, or null. */
async function assignMailbox(db: EmitTx, orgId: string, draftId: string, now: Date): Promise<boolean> {
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);

  const boxes = await db
    .select({ id: mailbox.id, dailyCap: mailbox.dailyCap })
    .from(mailbox)
    .where(and(eq(mailbox.orgId, orgId), eq(mailbox.status, "active")));
  if (boxes.length === 0) return false;

  const counts = await db
    .select({ mailboxId: message.mailboxId, n: count() })
    .from(message)
    .where(
      and(
        eq(message.direction, "outbound"),
        gte(message.occurredAt, dayStart),
        inArray(
          message.mailboxId,
          boxes.map((b) => b.id),
        ),
      ),
    )
    .groupBy(message.mailboxId);
  const byId = new Map(counts.map((c) => [c.mailboxId, c.n]));

  const candidates = boxes
    .map((b) => ({ ...b, sent: byId.get(b.id) ?? 0 }))
    .filter((b) => b.sent < b.dailyCap)
    .sort((a, b) => a.sent - b.sent);
  const pick = candidates[0];
  if (!pick) return false;

  await db
    .update(outreachDraft)
    .set({ mailboxId: pick.id })
    .where(and(eq(outreachDraft.id, draftId), isNull(outreachDraft.mailboxId)));
  return true;
}

/** Queue metrics for the operator UI. */
export async function outreachQueueCounts(db: EmitTx, orgId: string) {
  const rows = await db
    .select({ status: outreachDraft.status, n: count() })
    .from(outreachDraft)
    .where(eq(outreachDraft.orgId, orgId))
    .groupBy(outreachDraft.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
}
