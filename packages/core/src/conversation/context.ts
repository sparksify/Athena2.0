import { and, desc, eq, isNull } from "drizzle-orm";
import { candidate, candidateAttribute, message } from "@athena/db/schema";
import type { EmitTx } from "../events/emit";

export interface ConversationContext {
  candidate: { name: string | null; location: string | null; score: number | null };
  /** Provenance-backed facts only (candidate_attribute rows, current versions). */
  facts: { key: string; value: unknown }[];
  researchNote: string | null;
  /** Last N messages, newest last, bodies trimmed. Never the raw history dump. */
  messages: {
    direction: "inbound" | "outbound";
    subject: string | null;
    body: string;
    occurredAt: Date;
    classification: string | null;
  }[];
}

const BODY_LIMIT = 1200;

/**
 * Intelligent context retrieval (CLAUDE.md Phase 6): attributes + last N
 * messages + research note. The model never sees the full candidate history.
 */
export async function buildConversationContext(
  db: EmitTx,
  args: { orgId: string; candidateId: string; lastN?: number },
): Promise<ConversationContext> {
  const lastN = args.lastN ?? 6;
  const [cand] = await db
    .select({ name: candidate.fullName, city: candidate.city, state: candidate.state, score: candidate.currentScore })
    .from(candidate)
    .where(and(eq(candidate.orgId, args.orgId), eq(candidate.id, args.candidateId)))
    .limit(1);

  const attrs = await db
    .select({ key: candidateAttribute.key, value: candidateAttribute.value })
    .from(candidateAttribute)
    .where(
      and(
        eq(candidateAttribute.orgId, args.orgId),
        eq(candidateAttribute.candidateId, args.candidateId),
        isNull(candidateAttribute.supersededById),
      ),
    );
  const researchNote = attrs.find((a) => a.key === "research_note");

  const msgs = await db
    .select({
      direction: message.direction,
      subject: message.subject,
      body: message.bodyText,
      occurredAt: message.occurredAt,
      classification: message.classification,
    })
    .from(message)
    .where(and(eq(message.orgId, args.orgId), eq(message.candidateId, args.candidateId)))
    .orderBy(desc(message.occurredAt))
    .limit(lastN);

  return {
    candidate: {
      name: cand?.name ?? null,
      location: cand ? [cand.city, cand.state].filter(Boolean).join(", ") || null : null,
      score: cand?.score ?? null,
    },
    facts: attrs.filter((a) => a.key !== "research_note"),
    researchNote: researchNote ? String(researchNote.value) : null,
    messages: msgs.reverse().map((m) => ({
      direction: m.direction,
      subject: m.subject,
      body: (m.body ?? "").slice(0, BODY_LIMIT),
      occurredAt: m.occurredAt,
      classification: m.classification,
    })),
  };
}
