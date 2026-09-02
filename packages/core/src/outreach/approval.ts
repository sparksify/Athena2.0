import { and, eq } from "drizzle-orm";
import { outreachDraft } from "@athena/db/schema";
import { emit, type EmitTx } from "../events/emit";

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
