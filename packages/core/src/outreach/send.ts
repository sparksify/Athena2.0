import { and, eq } from "drizzle-orm";
import type { EmailProvider } from "@athena/contracts";
import {
  campaign, campaignMembership, costRecord, interaction, mailbox, message, outreachDraft,
} from "@athena/db/schema";
import { emit, type EmitTx } from "../events/emit";
import { evaluateSendGates, type SendWindow } from "./gates";

export type SendOutcome =
  | { sent: true; messageId: string; providerMessageId: string }
  | { sent: false; outcome: "refused" | "blocked" | "failed"; reason: string };

/**
 * The one send path (ARCHITECTURE.md C.6): claim the approved draft under
 * lock, run verification → suppression → cap/window gates, send via the
 * adapter, then record message + interaction + cost + events atomically.
 *
 * - A draft in any status other than 'approved' (including 'sent') is REFUSED
 *   and the refusal is logged as an event — this is the duplicate-send guard.
 * - A gate failure marks the draft 'blocked' with the reason, and logs.
 * - A provider failure returns the draft to 'approved' for retry, and logs.
 */
export async function sendApprovedDraft(
  db: EmitTx,
  provider: EmailProvider,
  draftId: string,
  opts: { now?: Date } = {},
): Promise<SendOutcome> {
  const now = opts.now ?? new Date();

  // Phase A — claim under lock and run every gate.
  const claim = await db.transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(outreachDraft)
      .where(eq(outreachDraft.id, draftId))
      .for("update")
      .limit(1);
    if (!draft) return { kind: "refused" as const, reason: "draft_not_found", orgId: null };

    if (draft.status !== "approved") {
      await emit(tx, {
        orgId: draft.orgId,
        type: "outreach.send_refused",
        entityType: "outreach_draft",
        entityId: draft.id,
        payload: { reason: `status_${draft.status}`, attemptedAt: now.toISOString() },
      });
      return { kind: "refused" as const, reason: `status_${draft.status}`, orgId: draft.orgId };
    }

    const [camp] = await tx
      .select({ status: campaign.status, sendWindow: campaign.sendWindow })
      .from(campaign)
      .where(eq(campaign.id, draft.campaignId))
      .limit(1);
    if (!camp || camp.status !== "active") {
      await emit(tx, {
        orgId: draft.orgId,
        type: "outreach.send_refused",
        entityType: "outreach_draft",
        entityId: draft.id,
        payload: { reason: "campaign_not_active" },
      });
      return { kind: "refused" as const, reason: "campaign_not_active", orgId: draft.orgId };
    }

    const gate = await evaluateSendGates(tx, {
      orgId: draft.orgId,
      candidateId: draft.candidateId,
      mailboxId: draft.mailboxId,
      sendWindow: camp.sendWindow as SendWindow,
      now,
    });
    if (!gate.ok) {
      await tx
        .update(outreachDraft)
        .set({ status: "blocked", blockedReason: gate.reason })
        .where(eq(outreachDraft.id, draft.id));
      await emit(tx, {
        orgId: draft.orgId,
        type: "outreach.send_blocked",
        entityType: "outreach_draft",
        entityId: draft.id,
        payload: { reason: gate.reason },
      });
      return { kind: "blocked" as const, reason: gate.reason, orgId: draft.orgId };
    }

    const [mb] = await tx
      .select({ externalRef: mailbox.externalRef, address: mailbox.address })
      .from(mailbox)
      .where(eq(mailbox.id, draft.mailboxId!))
      .limit(1);

    await tx.update(outreachDraft).set({ status: "scheduled" }).where(eq(outreachDraft.id, draft.id));
    return {
      kind: "claimed" as const,
      draft,
      email: gate.email,
      mailboxRef: mb?.externalRef ?? mb?.address ?? "",
    };
  });

  if (claim.kind === "refused") return { sent: false, outcome: "refused", reason: claim.reason };
  if (claim.kind === "blocked") return { sent: false, outcome: "blocked", reason: claim.reason };

  const { draft, email, mailboxRef } = claim;

  // Phase B — the provider call, outside any transaction.
  let providerMessageId: string;
  try {
    const res = await provider.sendEmail({
      to: email,
      subject: draft.subject,
      bodyText: draft.bodyText,
      mailboxRef,
    });
    providerMessageId = res.providerMessageId;
  } catch (err) {
    await db.transaction(async (tx) => {
      await tx
        .update(outreachDraft)
        .set({ status: "approved" })
        .where(and(eq(outreachDraft.id, draft.id), eq(outreachDraft.status, "scheduled")));
      await emit(tx, {
        orgId: draft.orgId,
        type: "outreach.send_failed",
        entityType: "outreach_draft",
        entityId: draft.id,
        payload: { error: err instanceof Error ? err.message : String(err) },
      });
    });
    return { sent: false, outcome: "failed", reason: "provider_error" };
  }

  // Phase C — record everything atomically.
  const messageId = await db.transaction(async (tx) => {
    const [msg] = await tx
      .insert(message)
      .values({
        orgId: draft.orgId,
        candidateId: draft.candidateId,
        direction: "outbound",
        provider: provider.name,
        providerMessageId,
        mailboxId: draft.mailboxId,
        subject: draft.subject,
        bodyText: draft.bodyText,
        agentJobId: draft.agentJobId,
        occurredAt: now,
      })
      .returning({ id: message.id });
    if (!msg) throw new Error("message insert returned no row");

    await tx
      .update(outreachDraft)
      .set({ status: "sent", sentMessageId: msg.id })
      .where(eq(outreachDraft.id, draft.id));
    await tx
      .update(campaignMembership)
      .set({ status: "sent" })
      .where(
        and(
          eq(campaignMembership.campaignId, draft.campaignId),
          eq(campaignMembership.candidateId, draft.candidateId),
        ),
      );
    await tx.insert(interaction).values({
      orgId: draft.orgId,
      candidateId: draft.candidateId,
      type: "email_sent",
      direction: "outbound",
      occurredAt: now,
      campaignId: draft.campaignId,
      providerRef: providerMessageId,
    });
    await tx.insert(costRecord).values({
      orgId: draft.orgId,
      category: "message",
      provider: provider.name,
      amountUsd: "0",
      detail: { draftId: draft.id, providerMessageId },
    });
    await emit(tx, {
      orgId: draft.orgId,
      type: "outreach.sent",
      entityType: "outreach_draft",
      entityId: draft.id,
      payload: {
        candidateId: draft.candidateId,
        campaignId: draft.campaignId,
        mailboxId: draft.mailboxId,
        providerMessageId,
      },
    });
    return msg.id;
  });

  return { sent: true, messageId, providerMessageId };
}
