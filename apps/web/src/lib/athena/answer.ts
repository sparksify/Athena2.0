/**
 * Athena Voice — answer engine.
 *
 * One snapshot of the operation is read (RLS-scoped), then:
 *  - if the existing Anthropic integration is configured, Claude phrases a
 *    short executive answer CONSTRAINED to the snapshot's numbers;
 *  - otherwise (or on any LLM failure) a deterministic composer answers
 *    from the same snapshot, so the demo never depends on the model.
 * Numbers never come from the model. Read-only by construction.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LlmRequest, LlmResponse } from "@athena/contracts";
import { LlmGateway } from "@athena/core";
import { getDb } from "@athena/db";
import { AnthropicProvider } from "@athena/llm-anthropic";
import { getOperationsSnapshot, type OperationsSnapshot } from "./snapshot";

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface MetricItem {
  label: string;
  value: string | number;
}

export interface AthenaAnswer {
  answer: string;
  data: Record<string, unknown>;
  sources: string[];
  suggestions: string[];
  display?: { type: "metrics"; items: MetricItem[] };
  mode: "llm" | "deterministic";
}

export const ATHENA_MODEL = process.env.ATHENA_VOICE_MODEL ?? "claude-sonnet-5";

type Intent =
  | "today" | "appointments" | "leads" | "top" | "attention" | "outreach" | "activity"
  | "consultants" | "revenue" | "actions" | "unknown";

const n = (v: number) => v.toLocaleString("en-US");
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;

export function detectIntent(message: string): Intent {
  const m = message.toLowerCase();
  const has = (...words: string[]) => words.some((w) => m.includes(w));
  if (has("put those", "reassign", "send ", "launch", "pause", "delete", "follow-up", "follow up", "remove ", "assign ")) return "actions";
  if (has("revenue", "money", "dollar", "closed deal", "funded", "commission")) return "revenue";
  if (has("consultant", "who booked", "who is doing", "who's doing", "performing best", "performing", "rob ", "petka")) return "consultants";
  if (has("appointment", "meeting", "booked", "consult", "showed", "show rate")) return "appointments";
  if (has("attention", "needs my", "urgent", "review", "queue", "approve", "blocked", "failed", "worried", "problem")) return "attention";
  if (has("outreach", "campaign", "email", "draft", "send", "mailbox", "suppress")) return "outreach";
  if (has("working on", "update on", "been doing", "nick", "pete", "what have you", "what did you", "activity", "recent")) return "activity";
  if (has("best", "top", "hottest", "strongest", "highest", "who are")) return "top";
  if (has("lead", "candidate", "pipeline", "score", "prospect", "verified", "contact data", "import")) return "leads";
  if (has("today", "how are we", "how we doing", "how's it going", "status", "summary", "overview", "doing")) return "today";
  return "unknown";
}

/** Metric cards per intent — computed server-side from the snapshot. */
function displayFor(intent: Intent, s: OperationsSnapshot): AthenaAnswer["display"] | undefined {
  const items: MetricItem[] = (() => {
    switch (intent) {
      case "today":
        return [
          { label: "Candidates", value: s.leads.candidates },
          { label: "Hot (80+)", value: s.leads.bands.hot },
          { label: "Replies", value: s.engagement.replies },
          { label: "Meetings", value: s.engagement.meetings },
        ];
      case "appointments":
        return [
          { label: "Meetings", value: s.engagement.meetings },
          { label: "Showed", value: s.engagement.showed },
          { label: "Today", value: s.today.meetings },
          { label: "Replies", value: s.engagement.replies },
        ];
      case "leads":
      case "top":
        return [
          { label: "Candidates", value: s.leads.candidates },
          { label: "Hot", value: s.leads.bands.hot },
          { label: "Warm", value: s.leads.bands.warm },
          { label: "Verified", value: `${s.contactHealth.validPct}%` },
        ];
      case "attention":
        return [
          { label: "Drafts to approve", value: s.attention.draftsAwaitingApproval },
          { label: "Merges to review", value: s.attention.identityMergesToReview },
          { label: "Blocked sends", value: s.attention.blockedSends },
          { label: "Failed jobs", value: s.attention.failedAgentJobs },
        ];
      case "outreach":
        return [
          { label: "Emails sent", value: s.engagement.emailsSent },
          { label: "Awaiting approval", value: s.outreach.drafts.draft ?? 0 },
          { label: "Active mailboxes", value: s.outreach.activeMailboxes },
          { label: "Suppressed", value: s.outreach.suppressed },
        ];
      default:
        return [];
    }
  })();
  return items.length ? { type: "metrics", items } : undefined;
}

/** Deterministic composer — always available, never invents a number. */
export function composeDeterministic(intent: Intent, s: OperationsSnapshot): string {
  const { today, leads, engagement, attention, outreach, contactHealth, topCandidates } = s;
  const top = topCandidates[0];
  switch (intent) {
    case "today": {
      const fresh =
        today.candidatesImported || today.candidatesScored || today.replies || today.meetings
          ? `So far today: ${plural(today.candidatesImported, "candidate")} imported, ${n(today.candidatesScored)} scored, ${plural(today.replies, "reply", "replies")} and ${plural(today.meetings, "meeting")}.`
          : "Nothing new has landed today yet.";
      return `${fresh} Overall we're working ${plural(leads.candidates, "candidate")}, ${n(leads.bands.hot)} of them hot at 80 or above${top ? ` — ${top.name} leads at ${top.score}` : ""}. Lifetime engagement is ${plural(engagement.emailsSent, "email")} sent, ${plural(engagement.replies, "reply", "replies")}, and ${plural(engagement.meetings, "meeting")}. ${attention.draftsAwaitingApproval ? `${plural(attention.draftsAwaitingApproval, "draft")} awaiting your approval.` : "Nothing is waiting on your approval."}`;
    }
    case "appointments":
      return `We have ${plural(engagement.meetings, "meeting")} on record, ${n(engagement.showed)} of which showed${today.meetings ? `, including ${n(today.meetings)} today` : ", none booked today yet"}. That came from ${plural(engagement.replies, "reply", "replies")} across ${plural(engagement.emailsSent, "email")} sent. Appointments by consultant aren't live yet — that arrives with routing and accountability in Phase 7.`;
    case "leads": {
      const src = leads.sources.map((x) => `${x.batches} ${x.sourceType}`).join(", ");
      return `We have ${plural(leads.candidates, "candidate")} in the system, ${n(leads.evaluated)} scored: ${n(leads.bands.hot)} hot, ${n(leads.bands.warm)} warm, ${n(leads.bands.engaged)} engaged, ${n(leads.bands.cold)} cold, and ${n(leads.bands.doNotContact)} do-not-contact. Contact data is ${contactHealth.validPct}% verified valid across ${plural(contactHealth.emailAddresses, "email address", "email addresses")}${leads.duplicatesMerged ? `, and ${plural(leads.duplicatesMerged, "cross-source duplicate")} were merged automatically` : ""}. Imports so far: ${src || "none"}.`;
    }
    case "top": {
      if (!topCandidates.length) return "No candidates have been scored yet.";
      const list = topCandidates.slice(0, 3).map((t) => `${t.name} at ${t.score}${t.reasons[0] ? ` (${t.reasons[0]})` : ""}`).join("; ");
      return `Our strongest candidates right now: ${list}. Scores are deterministic and every one is explainable on the candidate page.`;
    }
    case "attention": {
      const items = [
        attention.draftsAwaitingApproval ? `${plural(attention.draftsAwaitingApproval, "outreach draft")} awaiting approval` : null,
        attention.identityMergesToReview ? `${plural(attention.identityMergesToReview, "identity merge")} to review` : null,
        attention.blockedSends ? `${plural(attention.blockedSends, "blocked send")}` : null,
        attention.failedAgentJobs ? `${plural(attention.failedAgentJobs, "failed agent job")}` : null,
        attention.invalidOrRiskyEmails ? `${plural(attention.invalidOrRiskyEmails, "invalid or risky email")}` : null,
      ].filter(Boolean);
      return items.length
        ? `Here's what needs a human: ${items.join(", ")}. ${plural(attention.suppressedContacts, "contact")} ${attention.suppressedContacts === 1 ? "is" : "are"} on the suppression list and will never be emailed.`
        : `Nothing is waiting on you right now — no drafts to approve, no merges to review, no failed jobs. ${plural(attention.suppressedContacts, "contact")} ${attention.suppressedContacts === 1 ? "is" : "are"} suppressed and protected.`;
    }
    case "outreach": {
      const d = outreach.drafts;
      const camps = outreach.campaigns.length ? `${outreach.campaigns.length} campaign${outreach.campaigns.length === 1 ? "" : "s"} (${outreach.campaigns.map((x) => `${x.name}: ${x.status}`).join(", ")})` : "no campaigns yet";
      return `Outreach status: ${camps}, ${plural(outreach.activeMailboxes, "active mailbox", "active mailboxes")}, ${n(d.draft ?? 0)} drafts awaiting approval, ${n(d.approved ?? 0)} approved, ${n(d.sent ?? 0)} sent, ${n(d.blocked ?? 0)} blocked by a gate. Lifetime, ${plural(engagement.emailsSent, "email")} went out and ${plural(engagement.replies, "reply", "replies")} came back. ${plural(outreach.suppressed, "contact")} ${outreach.suppressed === 1 ? "is" : "are"} suppressed.`;
    }
    case "activity": {
      const a = s.activity.last7d;
      const bits = [
        a["candidate.imported"] ? `imported ${plural(a["candidate.imported"], "candidate")}` : null,
        a["candidate.scored"] ? `scored ${n(a["candidate.scored"])}` : null,
        a["identity.matched"] ? `auto-merged ${plural(a["identity.matched"], "duplicate")}` : null,
        a["outreach.drafted"] ? `drafted ${plural(a["outreach.drafted"], "email")}` : null,
        a["outreach.sent"] ? `sent ${n(a["outreach.sent"])}` : null,
        a["suppression.added"] ? `added ${plural(a["suppression.added"], "suppression")}` : null,
      ].filter(Boolean);
      return `Over the last seven days I've ${bits.length ? bits.join(", ") : "been idle — no pipeline activity recorded"}. The pipeline holds ${plural(leads.candidates, "candidate")} with ${n(leads.bands.hot)} hot, contact data is ${contactHealth.validPct}% verified, and total AI plus verification spend is $${s.activity.spend.totalUsd.toFixed(2)}.`;
    }
    case "consultants":
      return "Consultant performance isn't live in my data yet — appointments by consultant, response times, and take-backs arrive with routing and accountability in Phase 7. The Consultant Command screen currently shows preview figures, not measured ones. I can tell you about leads, scores, engagement, and outreach right now.";
    case "revenue":
      return "I can see lead volume, scores, replies, and meetings, but revenue and pipeline dollar value aren't in the Athena data I have access to yet — attribution arrives in Phase 9.";
    case "actions":
      return "I can identify those records, but operational commands aren't enabled in Voice yet — I'm read-only today. Ask me anything about leads, scores, engagement, outreach, or what needs attention.";
    default:
      return `I don't have enough information to answer that from Athena's data yet. I can cover leads and scores (${plural(leads.candidates, "candidate")}, ${n(leads.bands.hot)} hot), engagement (${plural(engagement.replies, "reply", "replies")}, ${plural(engagement.meetings, "meeting")}), outreach, and what needs your attention.`;
  }
}

export const SUGGESTIONS = [
  "How are we doing today?",
  "What's happening with our leads?",
  "Who are our strongest candidates?",
  "How many meetings have we booked?",
  "What needs my attention?",
  "How is outreach going?",
];

function nextSuggestions(intent: Intent): string[] {
  const order: Record<string, string[]> = {
    today: ["Who are our strongest candidates?", "What needs my attention?", "How is outreach going?"],
    leads: ["Who are our strongest candidates?", "How verified is our contact data?", "How are we doing today?"],
    top: ["What's happening with our leads?", "What needs my attention?", "How many meetings have we booked?"],
    appointments: ["Who are our strongest candidates?", "How is outreach going?", "What needs my attention?"],
    attention: ["How is outreach going?", "How are we doing today?", "What's happening with our leads?"],
    outreach: ["What needs my attention?", "How many meetings have we booked?", "How are we doing today?"],
  };
  return order[intent] ?? SUGGESTIONS.slice(0, 3);
}

const SYSTEM_PROMPT = `You are Athena, the AI Chief of Staff for a franchise-candidate reactivation operation. You answer operational questions for executives using ONLY the JSON snapshot provided. Rules:
- Every number you say must appear in the snapshot. Never estimate, extrapolate, or invent a figure. Never state a comparison the snapshot doesn't directly support.
- If the snapshot lists something under notAvailable, or the question needs data not present, say plainly that it isn't in your data yet (one sentence), then offer what you can see.
- Voice-first: 1-4 sentences, concise, confident, conversational, executive-friendly. No tables, no bullet lists, no markdown, no headings. Summarize; don't read rows aloud.
- Use recent conversation history to resolve follow-ups ("who is doing the best" after a leads question means top candidates).
- You are read-only today. If asked to take an action (send, reassign, pause, delete), say you can identify the records but operational commands aren't enabled in Voice yet.
- If today's counts are zero, say nothing new has landed today and pivot to the overall picture.
- "Meetings" in the data are appointments. "Hot" means score 80 or above.
- Round nothing; say numbers exactly.`;

const ANSWER_SCHEMA = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
} as const;

async function complete(req: LlmRequest): Promise<LlmResponse> {
  const provider = new AnthropicProvider();
  if (process.env.DATABASE_URL) {
    // Existing gateway: writes a cost_record per call (rule 8).
    return new LlmGateway(provider, getDb()).complete(req, {
      orgId: process.env.ATHENA_ORG_ID ?? "00000000-0000-0000-0000-000000000001",
      traceName: "athena.voice",
    });
  }
  console.warn("[athena-voice] DATABASE_URL unset — LLM call not cost-recorded");
  return provider.complete(req);
}

export async function answerQuestion(
  db: SupabaseClient,
  message: string,
  history: HistoryTurn[] = [],
): Promise<AthenaAnswer> {
  const snapshot = await getOperationsSnapshot(db);
  let intent = detectIntent(message);
  if (intent === "unknown") {
    const lastUser = [...history].reverse().find((h) => h.role === "user");
    if (lastUser) {
      const prev = detectIntent(lastUser.content);
      if (prev !== "unknown") intent = prev; // follow-up: reuse the thread's subject
    }
  }
  const base: Omit<AthenaAnswer, "answer" | "mode"> = {
    data: {
      today: snapshot.today,
      leads: snapshot.leads,
      engagement: snapshot.engagement,
      attention: snapshot.attention,
      contactHealth: snapshot.contactHealth,
    },
    sources: ["candidate", "score_snapshot", "interaction", "outreach_draft", "identity_review", "agent_job", "email_verification", "suppression", "event"],
    suggestions: nextSuggestions(intent),
    display: displayFor(intent, snapshot),
  };

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const recent = history.slice(-8).map((h) => ({ role: h.role, content: h.content }));
      const res = await complete({
        model: ATHENA_MODEL,
        system: `${SYSTEM_PROMPT}\n\nSNAPSHOT (authoritative):\n${JSON.stringify(snapshot)}`,
        messages: [...recent, { role: "user", content: message }],
        maxTokens: 400,
        jsonSchema: ANSWER_SCHEMA as unknown as Record<string, unknown>,
      });
      const answer = (res.json as { answer?: string } | undefined)?.answer?.trim() || res.text?.trim();
      if (answer) return { ...base, answer, mode: "llm" };
    } catch (err) {
      console.error("[athena-voice] LLM failed, using deterministic answer", err);
    }
  }
  return { ...base, answer: composeDeterministic(intent, snapshot), mode: "deterministic" };
}
