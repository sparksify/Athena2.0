import { and, count, eq } from "drizzle-orm";
import { outreachDraft } from "@athena/db/schema";
import { emit, type EmitTx } from "../events/emit";
import type { LlmGateway } from "../llm/gateway";
import { draftOutreach } from "./drafting";

/** After this many rejected drafts for one person in one campaign, stop rewriting and leave it to a human. */
export const MAX_REWRITES = 3;

/** 100% human approval: only a person moves a draft to 'approved'. */
export async function approveDraft(
  db: EmitTx,
  args: { orgId: string; draftId: string; userId: string },
): Promise<{ ok: boolean; reason?: string }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(outreachDraft)
      .set({ status: "approved", approvedBy: args.userId })
      .where(
        and(
          eq(outreachDraft.id, args.draftId),
          eq(outreachDraft.orgId, args.orgId),
          eq(outreachDraft.status, "draft"),
        ),
      )
      .returning({ id: outreachDraft.id });
    if (!rows[0]) return { ok: false, reason: "not_in_draft_status" };
    await emit(tx, {
      orgId: args.orgId,
      type: "outreach.approved",
      entityType: "outreach_draft",
      entityId: args.draftId,
      actorType: "user",
      actorId: args.userId,
    });
    return { ok: true };
  });
}

export async function rejectDraft(
  db: EmitTx,
  args: { orgId: string; draftId: string; userId: string; reason?: string },
): Promise<{ ok: boolean; reason?: string }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(outreachDraft)
      .set({ status: "rejected", blockedReason: args.reason })
      .where(
        and(
          eq(outreachDraft.id, args.draftId),
          eq(outreachDraft.orgId, args.orgId),
          eq(outreachDraft.status, "draft"),
        ),
      )
      .returning({ id: outreachDraft.id });
    if (!rows[0]) return { ok: false, reason: "not_in_draft_status" };
    await emit(tx, {
      orgId: args.orgId,
      type: "outreach.rejected",
      entityType: "outreach_draft",
      entityId: args.draftId,
      actorType: "user",
      actorId: args.userId,
      payload: { reason: args.reason },
    });
    return { ok: true };
  });
}

export type RewriteResult =
  | { ok: true; rewritten: true; draftId: string; attempt: number }
  | { ok: true; rewritten: false; reason: string; attempt: number }
  | { ok: false; reason: string };

/**
 * Reject with a note and immediately write the next version from it. The
 * reviewer's note is the whole point: it goes to the writer verbatim along
 * with the rejected text. Stops after MAX_REWRITES for the same person so a
 * bad fit does not loop; the membership stays "drafted" with no live draft,
 * which the campaign page reports.
 */
export async function rejectAndRewrite(
  db: EmitTx,
  llm: LlmGateway,
  args: { orgId: string; draftId: string; userId: string; reason: string; rewrite?: boolean },
): Promise<RewriteResult> {
  const [prev] = await db.select().from(outreachDraft)
    .where(and(eq(outreachDraft.id, args.draftId), eq(outreachDraft.orgId, args.orgId))).limit(1);
  if (!prev) return { ok: false, reason: "not_found" };
  const rejected = await rejectDraft(db, { orgId: args.orgId, draftId: args.draftId, userId: args.userId, reason: args.reason });
  if (!rejected.ok) return { ok: false, reason: rejected.reason ?? "reject_failed" };

  const [c] = await db.select({ n: count() }).from(outreachDraft)
    .where(and(eq(outreachDraft.campaignId, prev.campaignId), eq(outreachDraft.candidateId, prev.candidateId), eq(outreachDraft.status, "rejected")));
  const attempt = Number(c?.n ?? 1);
  if (args.rewrite === false) return { ok: true, rewritten: false, reason: "not_requested", attempt };
  if (attempt > MAX_REWRITES) {
    await emit(db, {
      orgId: args.orgId, type: "outreach.rewrite_exhausted", entityType: "outreach_draft", entityId: args.draftId,
      actorType: "user", actorId: args.userId, payload: { campaignId: prev.campaignId, candidateId: prev.candidateId, attempts: attempt },
    });
    return { ok: true, rewritten: false, reason: "max_rewrites", attempt };
  }
  const next = await draftOutreach(db, llm, {
    orgId: args.orgId, campaignId: prev.campaignId, candidateId: prev.candidateId, angleId: prev.angleId,
    revision: { previousDraftId: prev.id, previousSubject: prev.subject, previousBody: prev.bodyText, feedback: args.reason, attempt },
  });
  return next.drafted ? { ok: true, rewritten: true, draftId: next.draftId, attempt } : { ok: true, rewritten: false, reason: next.reason, attempt };
}
