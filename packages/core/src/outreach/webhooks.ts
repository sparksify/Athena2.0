import { and, eq } from "drizzle-orm";
import { campaignMembership, identifier, interaction, message } from "@athena/db/schema";
import { emit, type EmitTx } from "../events/emit";
import { addSuppression } from "./suppress";

/** Normalized provider event; adapters translate raw payloads into this. */
export interface EmailWebhookEvent {
  kind: "reply" | "bounce" | "complaint" | "unsubscribe";
  provider: string;
  /** Provider's id for the message this event is about (the reply itself for kind=reply). */
  providerMessageId: string;
  email: string;
  subject?: string;
  bodyText?: string;
  occurredAt: Date;
  raw?: unknown;
}

export interface WebhookResult {
  handled: boolean;
  deduped: boolean;
  suppressed: boolean;
}

const SUPPRESS_REASON: Record<string, string> = {
  bounce: "hard bounce",
  complaint: "spam complaint",
  unsubscribe: "unsubscribed",
};

/**
 * Idempotent webhook ingestion. Replies dedupe on the message table's
 * UNIQUE(provider, provider_message_id); bounce/complaint/unsubscribe dedupe
 * on the suppression unique index. Bounces, complaints, and opt-outs land in
 * suppression IN THE SAME TRANSACTION as the interaction — the next send
 * attempt is blocked the moment this commits.
 */
export async function handleEmailWebhook(db: EmitTx, evt: EmailWebhookEvent): Promise<WebhookResult> {
  const email = evt.email.trim().toLowerCase();
  return db.transaction(async (tx) => {
    // Resolve candidate via the identifier graph (best effort).
    const [ident] = await tx
      .select({ candidateId: identifier.candidateId, orgId: identifier.orgId })
      .from(identifier)
      .where(and(eq(identifier.type, "email"), eq(identifier.valueNormalized, email)))
      .limit(1);
    if (!ident) return { handled: false, deduped: false, suppressed: false };
    const { orgId, candidateId } = ident;

    if (evt.kind === "reply") {
      const inserted = await tx
        .insert(message)
        .values({
          orgId,
          candidateId,
          direction: "inbound",
          provider: evt.provider,
          providerMessageId: evt.providerMessageId,
          subject: evt.subject,
          bodyText: evt.bodyText,
          occurredAt: evt.occurredAt,
        })
        .onConflictDoNothing()
        .returning({ id: message.id });
      const msg = inserted[0];
      if (!msg) return { handled: true, deduped: true, suppressed: false };

      if (candidateId) {
        await tx.insert(interaction).values({
          orgId,
          candidateId,
          type: "email_reply",
          direction: "inbound",
          occurredAt: evt.occurredAt,
          providerRef: evt.providerMessageId,
        });
        await tx
          .update(campaignMembership)
          .set({ status: "replied" })
          .where(and(eq(campaignMembership.candidateId, candidateId), eq(campaignMembership.status, "sent")));
      }
      await emit(tx, {
        orgId,
        type: "outreach.reply_received",
        entityType: "message",
        entityId: msg.id,
        payload: { candidateId, provider: evt.provider },
        // Phase 6 classifies the reply; the outbox job is queued now.
        enqueue: [{ type: "conversation.classify", payload: { messageId: msg.id } }],
      });
      return { handled: true, deduped: false, suppressed: false };
    }

    // bounce / complaint / unsubscribe → hard suppression, idempotent.
    const suppressionId = await addSuppression(tx, {
      orgId,
      channel: "email",
      identifier: email,
      reason: SUPPRESS_REASON[evt.kind] ?? evt.kind,
      source: evt.provider,
    });
    if (!suppressionId) return { handled: true, deduped: true, suppressed: true };

    const interactionType =
      evt.kind === "bounce" ? "email_bounce" : evt.kind === "complaint" ? "email_complaint" : "opt_out";
    if (candidateId) {
      await tx.insert(interaction).values({
        orgId,
        candidateId,
        type: interactionType,
        direction: "inbound",
        occurredAt: evt.occurredAt,
        providerRef: evt.providerMessageId,
      });
    }
    await emit(tx, {
      orgId,
      type: `outreach.${evt.kind}`,
      entityType: "candidate",
      entityId: candidateId ?? undefined,
      payload: { email, provider: evt.provider },
    });
    return { handled: true, deduped: false, suppressed: true };
  });
}
