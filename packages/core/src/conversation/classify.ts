import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { conversation, message } from "@athena/db/schema";
import { emit, type EmitTx } from "../events/emit";
import type { LlmGateway } from "../llm/gateway";
import { addSuppression } from "../outreach/suppress";
import {
  ALL_CLASSIFICATIONS, AUTO_CLOSE_CLASSES, AUTO_REPLY_THRESHOLD, CLASS_DESCRIPTIONS,
  LOW_URGENCY_CLASSES, isAutoReplyEligible, type Classification,
} from "./classes";
import { buildConversationContext } from "./context";
import { rows } from "../db-rows";

export const CLASSIFY_MODEL = process.env.CONVERSATION_MODEL ?? "claude-sonnet-5";

const SCHEMA = {
  type: "object",
  properties: {
    classification: { type: "string", enum: [...ALL_CLASSIFICATIONS] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    summary: { type: "string" },
  },
  required: ["classification", "confidence", "summary"],
  additionalProperties: false,
} as const;

export type ConversationState = "open" | "awaiting_candidate" | "awaiting_human" | "closed";

export interface ClassifyResult {
  messageId: string;
  conversationId: string;
  classification: Classification;
  confidence: number;
  state: ConversationState;
  flagged: boolean;
  action: "auto_reply_queued" | "suppressed" | "closed" | "human_queue" | "already_classified";
}

/**
 * Deterministic routing from (class, confidence) → conversation state.
 * The model proposes; this table decides. Anything uncertain goes to a human.
 */
export function routeClassification(c: Classification, confidence: number): {
  state: ConversationState;
  flagged: boolean;
  action: ClassifyResult["action"];
} {
  if (isAutoReplyEligible(c, confidence)) return { state: "open", flagged: false, action: "auto_reply_queued" };
  if (c === "unsubscribe" && confidence >= AUTO_REPLY_THRESHOLD) return { state: "closed", flagged: false, action: "suppressed" };
  if (AUTO_CLOSE_CLASSES.includes(c) && confidence >= AUTO_REPLY_THRESHOLD) return { state: "closed", flagged: false, action: "closed" };
  if (LOW_URGENCY_CLASSES.includes(c) && confidence >= AUTO_REPLY_THRESHOLD) return { state: "awaiting_human", flagged: false, action: "human_queue" };
  return { state: "awaiting_human", flagged: true, action: "human_queue" };
}

/**
 * Classifies one inbound message and moves its conversation. Idempotent: a
 * message that already carries a classification is left untouched. LLM
 * failure degrades to `ambiguous` @ 0 — straight to the human queue.
 */
export async function classifyReply(
  db: EmitTx,
  llm: LlmGateway,
  args: { messageId: string; agentJobId?: string },
): Promise<ClassifyResult | null> {
  const [msg] = await db.select().from(message).where(eq(message.id, args.messageId)).limit(1);
  if (!msg || msg.direction !== "inbound" || !msg.candidateId) return null;
  if (msg.classification && msg.conversationId) {
    return {
      messageId: msg.id, conversationId: msg.conversationId,
      classification: msg.classification as Classification,
      confidence: Number(msg.classificationConfidence ?? 0),
      state: "open", flagged: false, action: "already_classified",
    };
  }

  const ctx = await buildConversationContext(db, { orgId: msg.orgId, candidateId: msg.candidateId });
  let classification: Classification = "ambiguous";
  let confidence = 0;
  let summary = "";
  try {
    const res = await llm.complete(
      {
        model: CLASSIFY_MODEL,
        system: [
          "You classify inbound email replies to a franchise-consulting reactivation outreach. Return exactly one class and a calibrated confidence (0-1).",
          "Classes:",
          ...ALL_CLASSIFICATIONS.map((c) => `- ${c}: ${CLASS_DESCRIPTIONS[c]}`),
          "Rules: confidence ≥ 0.9 only when the reply is unmistakable. Auto-replies, out-of-office, and empty bodies are `ambiguous`. Any request to stop contact is `unsubscribe`. Prefer `ambiguous` over guessing.",
        ].join("\n"),
        messages: [
          {
            role: "user",
            content: [
              `Candidate: ${ctx.candidate.name ?? "unknown"}${ctx.candidate.location ? `, ${ctx.candidate.location}` : ""}`,
              "Recent thread (oldest first):",
              ...ctx.messages
                .filter((m) => m.occurredAt <= msg.occurredAt)
                .map((m) => `[${m.direction}] ${m.subject ?? ""}\n${m.body}`),
              "---",
              "Classify the LAST inbound message above.",
            ].join("\n\n"),
          },
        ],
        maxTokens: 200,
        jsonSchema: SCHEMA as unknown as Record<string, unknown>,
      },
      { orgId: msg.orgId, agentJobId: args.agentJobId, traceName: "conversation.classify" },
    );
    const out = res.json as { classification?: string; confidence?: number; summary?: string } | undefined;
    if (out?.classification && (ALL_CLASSIFICATIONS as readonly string[]).includes(out.classification)) {
      classification = out.classification as Classification;
      confidence = Math.max(0, Math.min(1, Number(out.confidence ?? 0)));
      summary = out.summary ?? "";
    }
  } catch (err) {
    console.error("[conversation] classifier failed; routing to human", err);
  }

  const route = routeClassification(classification, confidence);

  return db.transaction(async (tx) => {
    // Find the candidate's open conversation on this channel, or open one.
    const [existing] = await tx
      .select({ id: conversation.id })
      .from(conversation)
      .where(
        and(
          eq(conversation.orgId, msg.orgId),
          eq(conversation.candidateId, msg.candidateId!),
          eq(conversation.channel, "email"),
          ne(conversation.state, "closed"),
        ),
      )
      .orderBy(desc(conversation.lastMessageAt))
      .limit(1);
    let conversationId = existing?.id;
    if (conversationId) {
      await tx
        .update(conversation)
        .set({ state: route.state, flagged: route.flagged, lastMessageAt: msg.occurredAt })
        .where(eq(conversation.id, conversationId));
    } else {
      const [created] = await tx
        .insert(conversation)
        .values({
          orgId: msg.orgId, candidateId: msg.candidateId!, channel: "email",
          state: route.state, flagged: route.flagged, openedAt: msg.occurredAt, lastMessageAt: msg.occurredAt,
        })
        .returning({ id: conversation.id });
      conversationId = created!.id;
      // The outreach that started this thread predates the conversation row;
      // pull the candidate's unlinked messages in so the thread is complete.
      await tx
        .update(message)
        .set({ conversationId })
        .where(and(eq(message.candidateId, msg.candidateId!), isNull(message.conversationId)));
    }

    await tx
      .update(message)
      .set({ conversationId, classification, classificationConfidence: confidence.toFixed(3) })
      .where(eq(message.id, msg.id));

    const enqueue = route.action === "auto_reply_queued" ? [{ type: "conversation.auto_reply", payload: { messageId: msg.id } }] : [];
    await emit(tx, {
      orgId: msg.orgId,
      type: "conversation.classified",
      entityType: "conversation",
      entityId: conversationId,
      payload: { messageId: msg.id, classification, confidence, summary, state: route.state, flagged: route.flagged, action: route.action },
      correlationId: args.agentJobId,
      enqueue,
    });

    if (route.action === "suppressed") {
      // candidate.primary_email is the address that replied; suppress it.
      const email = rows<{ email: string | null }>(
        await tx.execute(sql`select lower(trim("primary_email")) as email from "candidate" where "id" = ${msg.candidateId}`),
      )[0]?.email;
      if (email) {
        await addSuppression(tx, {
          orgId: msg.orgId, channel: "email", identifier: email,
          reason: "unsubscribe reply", source: "conversation", correlationId: args.agentJobId,
        });
      }
    }

    return {
      messageId: msg.id, conversationId, classification, confidence,
      state: route.state, flagged: route.flagged, action: route.action,
    };
  });
}
