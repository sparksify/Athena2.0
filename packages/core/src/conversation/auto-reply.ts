import { and, eq, gt } from "drizzle-orm";
import type { EmailProvider } from "@athena/contracts";
import { candidate, conversation, costRecord, interaction, message } from "@athena/db/schema";
import { emit, type EmitTx } from "../events/emit";
import type { LlmGateway } from "../llm/gateway";
import { isSuppressed } from "../outreach/suppress";
import { AUTO_REPLY_THRESHOLD, isAutoReplyEligible } from "./classes";
import { buildConversationContext } from "./context";
import { conversationMailbox } from "./state";

export const AUTO_REPLY_MODEL = process.env.CONVERSATION_MODEL ?? "claude-sonnet-5";

const SCHEMA = {
  type: "object",
  properties: { subject: { type: "string" }, bodyText: { type: "string" } },
  required: ["subject", "bodyText"],
  additionalProperties: false,
} as const;

export type RefuseReason =
  | "below_threshold" | "class_not_eligible" | "suppressed" | "already_replied"
  | "no_email" | "not_found" | "provider_error" | "bad_llm_output";
export type AutoReplyOutcome = { sent: true; messageId: string } | { sent: false; reason: RefuseReason };

/**
 * Sends Athena's own reply — ONLY for `asks_what_this_is` / `needs_info` at
 * confidence ≥ 0.90. The eligibility check is code, re-run here regardless of
 * who enqueued the job; a refused attempt is logged as an event.
 */
export async function sendAutoReply(
  db: EmitTx,
  llm: LlmGateway,
  provider: EmailProvider,
  args: { messageId: string; agentJobId?: string; now?: Date },
): Promise<AutoReplyOutcome> {
  const now = args.now ?? new Date();
  const [msg] = await db.select().from(message).where(eq(message.id, args.messageId)).limit(1);
  if (!msg || !msg.conversationId || !msg.candidateId) return { sent: false, reason: "not_found" };

  const refuse = async (reason: RefuseReason): Promise<AutoReplyOutcome> => {
    await emit(db, {
      orgId: msg.orgId, type: "conversation.auto_reply_refused", entityType: "conversation",
      entityId: msg.conversationId!, payload: { messageId: msg.id, reason, classification: msg.classification, confidence: Number(msg.classificationConfidence ?? 0), threshold: AUTO_REPLY_THRESHOLD },
      correlationId: args.agentJobId,
    });
    return { sent: false as const, reason };
  };

  const confidence = Number(msg.classificationConfidence ?? 0);
  if (!msg.classification || !["asks_what_this_is", "needs_info"].includes(msg.classification)) return refuse("class_not_eligible");
  if (!isAutoReplyEligible(msg.classification, confidence)) return refuse("below_threshold");

  const [cand] = await db.select({ email: candidate.primaryEmail }).from(candidate).where(eq(candidate.id, msg.candidateId)).limit(1);
  const to = cand?.email?.trim().toLowerCase();
  if (!to) return refuse("no_email");
  if (await isSuppressed(db, msg.orgId, "email", to)) return refuse("suppressed");

  const [later] = await db
    .select({ id: message.id })
    .from(message)
    .where(and(eq(message.conversationId, msg.conversationId), eq(message.direction, "outbound"), gt(message.occurredAt, msg.occurredAt)))
    .limit(1);
  if (later) return refuse("already_replied");

  const ctx = await buildConversationContext(db, { orgId: msg.orgId, candidateId: msg.candidateId });
  let subject: string;
  let bodyText: string;
  try {
    const res = await llm.complete(
      {
        model: AUTO_REPLY_MODEL,
        system: [
          "You are a coordinator at a franchise consulting firm replying to someone who answered our email. Write a short, warm, plain-text reply (40-90 words) that answers their question directly, using ONLY the facts provided. If a fact isn't provided, say a consultant will follow up with specifics. One sentence inviting a quick call. Sign off with {{sender_first_name}}. No links, no marketing language, no bullet points.",
          ctx.researchNote ? `Background note: ${ctx.researchNote}` : "",
          "Facts we know about them: " + (ctx.facts.length ? ctx.facts.map((f) => `${f.key}=${JSON.stringify(f.value)}`).join("; ") : "(none)"),
          "Who we are: FranChoice — franchise consultants who help people evaluate franchise ownership at no cost to the candidate.",
        ].filter(Boolean).join("\n"),
        messages: [
          {
            role: "user",
            content: ["Thread (oldest first):", ...ctx.messages.map((m) => `[${m.direction}] ${m.subject ?? ""}\n${m.body}`), "---", "Write the reply to the last inbound message."].join("\n\n"),
          },
        ],
        maxTokens: 400,
        jsonSchema: SCHEMA as unknown as Record<string, unknown>,
      },
      { orgId: msg.orgId, agentJobId: args.agentJobId, traceName: "conversation.auto_reply" },
    );
    const out = res.json as { subject?: string; bodyText?: string } | undefined;
    if (!out?.subject || !out?.bodyText) return refuse("bad_llm_output");
    subject = out.subject.startsWith("Re:") ? out.subject : `Re: ${msg.subject?.replace(/^re:\s*/i, "") ?? out.subject}`;
    bodyText = out.bodyText;
  } catch {
    return refuse("bad_llm_output");
  }

  const mb = await conversationMailbox(db, msg.conversationId);
  let providerMessageId: string;
  try {
    ({ providerMessageId } = await provider.sendEmail({ to, subject, bodyText, mailboxRef: mb?.external_ref ?? mb?.address ?? "" }));
  } catch (err) {
    console.error("[conversation] auto-reply send failed", err);
    return refuse("provider_error");
  }

  const messageId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(message)
      .values({
        orgId: msg.orgId, candidateId: msg.candidateId, direction: "outbound", provider: provider.name,
        providerMessageId, mailboxId: mb?.id ?? null, subject, bodyText, occurredAt: now,
        conversationId: msg.conversationId, agentJobId: args.agentJobId,
      })
      .returning({ id: message.id });
    await tx.insert(interaction).values({ orgId: msg.orgId, candidateId: msg.candidateId!, type: "email_sent", direction: "outbound", occurredAt: now, providerRef: providerMessageId });
    await tx.insert(costRecord).values({ orgId: msg.orgId, category: "message", provider: provider.name, amountUsd: "0", detail: { conversationId: msg.conversationId, autoReply: true } });
    await tx.update(conversation).set({ state: "awaiting_candidate", flagged: false, lastMessageAt: now }).where(eq(conversation.id, msg.conversationId!));
    await emit(tx, {
      orgId: msg.orgId, type: "conversation.auto_replied", entityType: "conversation", entityId: msg.conversationId!,
      payload: { inboundMessageId: msg.id, outboundMessageId: row!.id, classification: msg.classification, confidence },
      correlationId: args.agentJobId,
    });
    return row!.id;
  });
  return { sent: true, messageId };
}
