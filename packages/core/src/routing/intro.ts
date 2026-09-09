import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { EmailProvider } from "@athena/contracts";
import { assignment, candidate, consultant as consultantTable, interaction, message, personaMailbox } from "@athena/db/schema";
import { emit, type EmitTx } from "../events/emit";
import type { LlmGateway } from "../llm/gateway";
import { isSuppressed } from "../outreach/suppress";
import { buildConversationContext } from "../conversation/context";
import { rows } from "../db-rows";

export const INTRO_MODEL = process.env.INTRO_MODEL ?? "claude-sonnet-5";

export type IntroRefuseReason =
  | "not_found" | "not_offered" | "no_candidate_email" | "suppressed" | "no_consultant_email"
  | "persona_unconfigured" | "already_sent" | "bad_llm_output" | "provider_error";

export interface IntroOutcome {
  sent: boolean;
  reason?: IntroRefuseReason;
  candidateMessageId?: string;
  consultantMessageId?: string;
}

const INTRO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidateSubject", "candidateBody", "consultantSubject", "consultantBody"],
  properties: {
    candidateSubject: { type: "string" },
    candidateBody: { type: "string" },
    consultantSubject: { type: "string" },
    consultantBody: { type: "string" },
  },
} as const;

/**
 * The warm intro (ARCHITECTURE F: within 5 minutes of a positive reply).
 * The assigned named agent writes two personal emails from the persona
 * mailbox: one to the candidate introducing the consultant, one to the
 * consultant with the full context (provenance-backed facts, research
 * note, the last few messages) and the accept link. Suppression is a hard
 * gate; the persona must have a real address; never sent twice.
 */
export async function sendWarmIntro(
  db: EmitTx,
  llm: LlmGateway,
  email: EmailProvider,
  args: { assignmentId: string; appUrl: string; agentJobId?: string; now?: Date },
): Promise<IntroOutcome> {
  const now = args.now ?? new Date();
  const [a] = await db.select().from(assignment).where(eq(assignment.id, args.assignmentId)).limit(1);
  if (!a) return { sent: false, reason: "not_found" };
  if (a.status !== "offered" && a.status !== "accepted") return { sent: false, reason: "not_offered" };

  const [cand] = await db.select().from(candidate).where(eq(candidate.id, a.candidateId)).limit(1);
  const to = cand?.primaryEmail?.trim().toLowerCase();
  if (!cand || !to) return { sent: false, reason: "no_candidate_email" };
  if (await isSuppressed(db, a.orgId, "email", to)) {
    await emit(db, { orgId: a.orgId, type: "assignment.intro_refused", entityType: "assignment", entityId: a.id, payload: { reason: "suppressed" } });
    return { sent: false, reason: "suppressed" };
  }
  const [cons] = await db.select().from(consultantTable).where(eq(consultantTable.id, a.consultantId)).limit(1);
  if (!cons?.email) return { sent: false, reason: "no_consultant_email" };

  const [persona] = a.personaMailboxId
    ? await db.select().from(personaMailbox).where(eq(personaMailbox.id, a.personaMailboxId)).limit(1)
    : await db.select().from(personaMailbox).where(and(eq(personaMailbox.orgId, a.orgId), eq(personaMailbox.active, true), isNotNull(personaMailbox.address))).limit(1);
  if (!persona?.address) return { sent: false, reason: "persona_unconfigured" };

  const already = await db.select({ id: message.id }).from(message)
    .where(and(eq(message.candidateId, a.candidateId), eq(message.personaMailboxId, persona.id), gte(message.occurredAt, a.offeredAt))).limit(1);
  if (already[0]) return { sent: false, reason: "already_sent" };

  const context = await buildConversationContext(db, { orgId: a.orgId, candidateId: a.candidateId, lastN: 4 });
  const factLines = context.facts.map((f) => `- ${f.key}: ${JSON.stringify(f.value)}`).join("\n") || "- (none on file)";
  const thread = context.messages.map((m) => `[${m.direction}] ${m.body.slice(0, 400)}`).join("\n---\n") || "(no thread)";
  const acceptUrl = `${args.appUrl.replace(/\/$/, "")}/consultants/queue?assignment=${a.id}`;
  const firstName = (cand.fullName ?? "").split(" ")[0] || "there";
  const consultantFirst = cons.name.split(" ")[0] ?? cons.name;

  let out: { candidateSubject?: string; candidateBody?: string; consultantSubject?: string; consultantBody?: string } | undefined;
  try {
    const res = await llm.complete(
      {
        model: INTRO_MODEL,
        system: [
          `You are ${persona.name}, the coordinator at a franchise consulting firm. You write short, warm, plain-text emails that read like one person writing to another. No templates, no marketing language, no bullet lists in the candidate email, no links except the accept link in the consultant email.`,
          "Email 1 goes to the candidate: thank them for replying, introduce the consultant by name as the person who will help them next, mention at most two facts from the list that show you remember them, and say the consultant will reach out shortly. 70-120 words. Sign with your first name only.",
          `Email 2 goes to the consultant ${cons.name}: a handoff brief. Who the candidate is, why they're worth a call (facts + research note), what they said in the thread, and the ask: reach out within the hour and click the accept link: ${acceptUrl}. Plain text, 120-200 words, can use short lines.`,
          "Use ONLY the facts, research note and thread provided. Never invent details.",
        ].join("\n"),
        messages: [{
          role: "user",
          content: [
            `Candidate: ${cand.fullName ?? "unknown"} (${to})${context.candidate.location ? `, ${context.candidate.location}` : ""}${context.candidate.score != null ? `, score ${context.candidate.score}` : ""}`,
            `Consultant: ${cons.name}`,
            "Facts:", factLines,
            `Research note: ${context.researchNote ?? "(none)"}`,
            "Recent thread (oldest first):", thread,
            "Write both emails.",
          ].join("\n"),
        }],
        maxTokens: 1200,
        jsonSchema: INTRO_SCHEMA as unknown as Record<string, unknown>,
      },
      { orgId: a.orgId, agentJobId: args.agentJobId, traceName: "routing.intro" },
    );
    out = res.json as typeof out;
  } catch {
    out = undefined;
  }
  if (!out?.candidateSubject || !out.candidateBody || !out.consultantSubject || !out.consultantBody) {
    await emit(db, { orgId: a.orgId, type: "assignment.intro_refused", entityType: "assignment", entityId: a.id, payload: { reason: "bad_llm_output" } });
    return { sent: false, reason: "bad_llm_output" };
  }
  const signature = persona.signatureHtml ? `\n\n${persona.signatureHtml.replace(/<[^>]+>/g, "")}` : "";

  let candidateRef: string;
  let consultantRef: string;
  try {
    candidateRef = (await email.sendEmail({ to, subject: out.candidateSubject, bodyText: out.candidateBody + signature, mailboxRef: persona.address })).providerMessageId;
    consultantRef = (await email.sendEmail({ to: cons.email, subject: out.consultantSubject, bodyText: out.consultantBody + signature, mailboxRef: persona.address })).providerMessageId;
  } catch (err) {
    await emit(db, { orgId: a.orgId, type: "assignment.intro_refused", entityType: "assignment", entityId: a.id, payload: { reason: "provider_error", error: String(err) } });
    return { sent: false, reason: "provider_error" };
  }

  return db.transaction(async (tx) => {
    const [m1] = await tx.insert(message).values({
      orgId: a.orgId, candidateId: a.candidateId, direction: "outbound", provider: email.name, providerMessageId: candidateRef,
      personaMailboxId: persona.id, conversationId: a.conversationId, subject: out.candidateSubject, bodyText: out.candidateBody, agentJobId: args.agentJobId, occurredAt: now,
    }).returning({ id: message.id });
    const [m2] = await tx.insert(message).values({
      orgId: a.orgId, candidateId: a.candidateId, direction: "outbound", provider: email.name, providerMessageId: consultantRef,
      personaMailboxId: persona.id, subject: out.consultantSubject, bodyText: out.consultantBody, agentJobId: args.agentJobId, occurredAt: now,
    }).returning({ id: message.id });
    await tx.insert(interaction).values({
      orgId: a.orgId, candidateId: a.candidateId, type: "email_sent", direction: "outbound", occurredAt: now, consultantId: a.consultantId,
      payload: { kind: "warm_intro", persona: persona.name, assignmentId: a.id }, providerRef: candidateRef,
    });
    await tx.update(candidate).set({ status: "introduced", updatedAt: now }).where(eq(candidate.id, a.candidateId));
    await emit(tx, {
      orgId: a.orgId, type: "assignment.intro_sent", entityType: "assignment", entityId: a.id, actorType: "agent", actorId: persona.id,
      correlationId: args.agentJobId,
      payload: { candidateId: a.candidateId, consultantId: a.consultantId, persona: persona.name, minutesSinceOffer: (now.getTime() - a.offeredAt.getTime()) / 60_000, consultantFirst, firstName },
    });
    return { sent: true, candidateMessageId: m1!.id, consultantMessageId: m2!.id };
  });
}

/** Persona rows the UI and routing can pick from. */
export async function listPersonas(db: EmitTx, orgId: string) {
  return rows<{ id: string; name: string; address: string | null; avatar_slug: string | null; active: boolean }>(
    await db.execute(sql`select id, name, address, avatar_slug, active from persona_mailbox where org_id = ${orgId} order by name`),
  );
}
