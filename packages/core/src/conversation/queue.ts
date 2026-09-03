import { and, count, eq, sql } from "drizzle-orm";
import { event } from "@athena/db/schema";
import type { EmitTx } from "../events/emit";
import { rows as toRows } from "../db-rows";

export interface QueueRow {
  id: string;
  candidateId: string;
  candidateName: string | null;
  state: string;
  flagged: boolean;
  lastMessageAt: Date;
  lastClassification: string | null;
  lastConfidence: number | null;
  lastPreview: string | null;
  assignedUserId: string | null;
}

/** Flagged-first, then most recent. Closed conversations excluded by default. */
export async function listConversations(db: EmitTx, orgId: string, opts: { includeClosed?: boolean; limit?: number } = {}): Promise<QueueRow[]> {
  const rows = toRows<{
    id: string; candidate_id: string; full_name: string | null; state: string; flagged: boolean;
    last_message_at: string | Date; assigned_user_id: string | null; classification: string | null;
    classification_confidence: string | null; preview: string | null;
  }>(await db.execute(sql`
    select c."id", c."candidate_id", cand."full_name", c."state", c."flagged", c."last_message_at", c."assigned_user_id",
      lm."classification", lm."classification_confidence", left(lm."body_text", 140) as preview
    from "conversation" c
    join "candidate" cand on cand."id" = c."candidate_id"
    left join lateral (
      select "classification", "classification_confidence", "body_text" from "message"
      where "conversation_id" = c."id" and "direction" = 'inbound' order by "occurred_at" desc limit 1
    ) lm on true
    where c."org_id" = ${orgId} ${opts.includeClosed ? sql`` : sql`and c."state" <> 'closed'`}
    order by c."flagged" desc, c."last_message_at" desc
    limit ${opts.limit ?? 100}
  `));
  return rows.map((r) => ({
    id: r.id, candidateId: r.candidate_id, candidateName: r.full_name, state: r.state, flagged: r.flagged,
    lastMessageAt: new Date(r.last_message_at), lastClassification: r.classification,
    lastConfidence: r.classification_confidence == null ? null : Number(r.classification_confidence),
    lastPreview: r.preview, assignedUserId: r.assigned_user_id,
  }));
}

/** Override rate = human corrections / classified messages (from the event stream). */
export async function overrideRate(db: EmitTx, orgId: string): Promise<{ classified: number; overridden: number; rate: number }> {
  const [c] = await db.select({ n: count() }).from(event).where(and(eq(event.orgId, orgId), eq(event.type, "conversation.classified")));
  const [o] = await db.select({ n: count() }).from(event).where(and(eq(event.orgId, orgId), eq(event.type, "conversation.classification_overridden")));
  const classified = c?.n ?? 0;
  const overridden = o?.n ?? 0;
  return { classified, overridden, rate: classified ? overridden / classified : 0 };
}

export async function conversationThread(db: EmitTx, orgId: string, conversationId: string) {
  const rows = toRows<{
    id: string; direction: "inbound" | "outbound"; subject: string | null; body_text: string | null;
    occurred_at: string | Date; classification: string | null; classification_confidence: string | null; provider: string;
  }>(await db.execute(sql`
    select "id", "direction", "subject", "body_text", "occurred_at", "classification", "classification_confidence", "provider"
    from "message" where "org_id" = ${orgId} and "conversation_id" = ${conversationId}
    order by "occurred_at" asc
  `));
  return rows.map((r) => ({ ...r, occurred_at: new Date(r.occurred_at), confidence: r.classification_confidence == null ? null : Number(r.classification_confidence) }));
}

