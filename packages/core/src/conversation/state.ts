import { and, eq, sql } from "drizzle-orm";
import type { EmailProvider } from "@athena/contracts";
import { conversation, costRecord, interaction, message } from "@athena/db/schema";
import { emit, type EmitTx } from "../events/emit";
import { addSuppression } from "../outreach/suppress";
import { ALL_CLASSIFICATIONS, type Classification } from "./classes";
import { rows } from "../db-rows";

/** A human corrects the classifier. Recorded as an event so the override rate is measurable. */
export async function overrideClassification(
  db: EmitTx,
  args: { orgId: string; messageId: string; classification: Classification; userId: string },
): Promise<{ ok: boolean; reason?: string }> {
  if (!(ALL_CLASSIFICATIONS as readonly string[]).includes(args.classification)) return { ok: false, reason: "unknown_class" };
  return db.transaction(async (tx) => {
    const [msg] = await tx.select().from(message).where(and(eq(message.id, args.messageId), eq(message.orgId, args.orgId))).limit(1);
    if (!msg || !msg.conversationId) return { ok: false, reason: "not_classified" };
    await tx.update(message).set({ classification: args.classification, classificationConfidence: "1.000" }).where(eq(message.id, msg.id));
    // A human looked: no longer flagged, waits on the human's next action.
    await tx.update(conversation).set({ flagged: false, state: "awaiting_human" }).where(eq(conversation.id, msg.conversationId));
    await emit(tx, {
      orgId: args.orgId, type: "conversation.classification_overridden", entityType: "conversation",
      entityId: msg.conversationId, actorType: "user", actorId: args.userId,
      payload: { messageId: msg.id, from: msg.classification, fromConfidence: Number(msg.classificationConfidence ?? 0), to: args.classification },
    });
    if (args.classification === "unsubscribe" && msg.candidateId) {
      const email = rows<{ email: string | null }>(await tx.execute(sql`select lower(trim("primary_email")) as email from "candidate" where "id" = ${msg.candidateId}`))[0]?.email;
      if (email) await addSuppression(tx, { orgId: args.orgId, channel: "email", identifier: email, reason: "unsubscribe (human override)", source: "conversation" });
      await tx.update(conversation).set({ state: "closed" }).where(eq(conversation.id, msg.conversationId));
    }
    return { ok: true };
  });
}

export async function closeConversation(db: EmitTx, args: { orgId: string; conversationId: string; userId: string; reason?: string }) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(conversation)
      .set({ state: "closed", flagged: false })
      .where(and(eq(conversation.id, args.conversationId), eq(conversation.orgId, args.orgId)))
      .returning({ id: conversation.id });
    if (!rows[0]) return { ok: false };
    await emit(tx, {
      orgId: args.orgId, type: "conversation.closed", entityType: "conversation", entityId: args.conversationId,
      actorType: "user", actorId: args.userId, payload: { reason: args.reason },
    });
    return { ok: true };
  });
}

export async function assignConversation(db: EmitTx, args: { orgId: string; conversationId: string; assigneeId: string | null; userId: string }) {
  return db.transaction(async (tx) => {
    await tx
      .update(conversation)
      .set({ assignedUserId: args.assigneeId })
      .where(and(eq(conversation.id, args.conversationId), eq(conversation.orgId, args.orgId)));
    await emit(tx, {
      orgId: args.orgId, type: "conversation.assigned", entityType: "conversation", entityId: args.conversationId,
      actorType: "user", actorId: args.userId, payload: { assigneeId: args.assigneeId },
    });
    return { ok: true };
  });
}

/** Mailbox that carried the last outbound message in the conversation (reply from the same address). */
export async function conversationMailbox(db: EmitTx, conversationId: string) {
  const found = rows<{ id: string; external_ref: string | null; address: string }>(await db.execute(sql`
    select m."id", m."external_ref", m."address" from "message" x
    join "mailbox" m on m."id" = x."mailbox_id"
    where x."conversation_id" = ${conversationId} and x."direction" = 'outbound'
    order by x."occurred_at" desc limit 1
  `));
  return found[0] ?? null;
}

/** A human replies inside the thread. Same recording as every send. */
export async function humanReply(
  db: EmitTx,
  provider: EmailProvider,
  args: { orgId: string; conversationId: string; subject: string; bodyText: string; userId: string; now?: Date },
): Promise<{ ok: boolean; reason?: string }> {
  const now = args.now ?? new Date();
  const [conv] = await db.select().from(conversation).where(and(eq(conversation.id, args.conversationId), eq(conversation.orgId, args.orgId))).limit(1);
  if (!conv) return { ok: false, reason: "not_found" };
  const to = rows<{ email: string | null }>(await db.execute(sql`select lower(trim("primary_email")) as email from "candidate" where "id" = ${conv.candidateId}`))[0]?.email;
  if (!to) return { ok: false, reason: "no_email" };
  const mb = await conversationMailbox(db, conv.id);

  let providerMessageId: string;
  try {
    ({ providerMessageId } = await provider.sendEmail({ to, subject: args.subject, bodyText: args.bodyText, mailboxRef: mb?.external_ref ?? mb?.address ?? "" }));
  } catch (err) {
    console.error("[conversation] human reply send failed", err);
    return { ok: false, reason: "provider_error" };
  }

  await db.transaction(async (tx) => {
    await tx.insert(message).values({
      orgId: args.orgId, candidateId: conv.candidateId, direction: "outbound", provider: provider.name,
      providerMessageId, mailboxId: mb?.id ?? null, subject: args.subject, bodyText: args.bodyText,
      occurredAt: now, conversationId: conv.id,
    });
    await tx.insert(interaction).values({ orgId: args.orgId, candidateId: conv.candidateId, type: "email_sent", direction: "outbound", occurredAt: now, providerRef: providerMessageId });
    await tx.insert(costRecord).values({ orgId: args.orgId, category: "message", provider: provider.name, amountUsd: "0", detail: { conversationId: conv.id, human: true } });
    await tx.update(conversation).set({ state: "awaiting_candidate", flagged: false, lastMessageAt: now }).where(eq(conversation.id, conv.id));
    await emit(tx, {
      orgId: args.orgId, type: "conversation.human_replied", entityType: "conversation", entityId: conv.id,
      actorType: "user", actorId: args.userId, payload: { providerMessageId },
    });
  });
  return { ok: true };
}
