/**
 * Athena Voice — read-only tool layer.
 *
 * Every function reads through the caller's Supabase session (RLS-scoped),
 * so Athena can only see what the signed-in user can see. The metric
 * definitions mirror the Overview page's queries one-for-one so the voice
 * answer and the dashboard never disagree.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient;
const DAY = 86_400_000;

const c = (q: PromiseLike<{ count: number | null }>) => q.then((r) => r.count ?? 0);
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

export interface TodaySummary {
  candidatesImported: number;
  candidatesScored: number;
  emailsSent: number;
  replies: number;
  meetings: number;
  draftsAwaitingApproval: number;
}

export async function getTodaySummary(db: Db): Promise<TodaySummary> {
  const today = startOfToday();
  const [imported, scored, emailsSent, replies, meetings, draftsAwaitingApproval] = await Promise.all([
    c(db.from("event").select("id", { count: "exact", head: true }).eq("type", "candidate.imported").gte("created_at", today)),
    c(db.from("event").select("id", { count: "exact", head: true }).eq("type", "candidate.scored").gte("created_at", today)),
    c(db.from("interaction").select("id", { count: "exact", head: true }).eq("type", "email_sent").gte("occurred_at", today)),
    c(db.from("interaction").select("id", { count: "exact", head: true }).eq("type", "email_reply").gte("occurred_at", today)),
    c(db.from("interaction").select("id", { count: "exact", head: true }).eq("type", "meeting").gte("occurred_at", today)),
    c(db.from("outreach_draft").select("id", { count: "exact", head: true }).eq("status", "draft")),
  ]);
  return { candidatesImported: imported, candidatesScored: scored, emailsSent, replies, meetings, draftsAwaitingApproval };
}

export interface LeadStats {
  candidates: number; // unmerged people
  evaluated: number; // with a score (Overview "Evaluated")
  bands: { hot: number; warm: number; engaged: number; cold: number; doNotContact: number };
  duplicatesMerged: number;
  sources: { sourceType: string; batches: number }[];
  lastImport: { filename: string; sourceType: string; at: string; accepted: number | null } | null;
}

export async function getLeadStats(db: Db): Promise<LeadStats> {
  const cand = () => db.from("candidate").select("id", { count: "exact", head: true }).is("merged_into_id", null);
  const [candidates, evaluated, hot, warm, engaged, cold, dnc, all, links, batches] = await Promise.all([
    c(cand()),
    c(cand().not("current_score", "is", null)),
    c(cand().gte("current_score", 80)),
    c(cand().gte("current_score", 50).lt("current_score", 80)),
    c(cand().gte("current_score", 20).lt("current_score", 50)),
    c(cand().gt("current_score", 0).lt("current_score", 20)),
    c(cand().eq("current_score", 0)),
    c(db.from("candidate").select("id", { count: "exact", head: true })),
    c(db.from("candidate_source_link").select("id", { count: "exact", head: true })),
    db.from("import_batch").select("filename, source_type, started_at, report").order("started_at", { ascending: false }).limit(50),
  ]);
  const bySource = new Map<string, number>();
  for (const b of batches.data ?? []) bySource.set(b.source_type, (bySource.get(b.source_type) ?? 0) + 1);
  const last = batches.data?.[0];
  return {
    candidates,
    evaluated,
    bands: { hot, warm, engaged, cold, doNotContact: dnc },
    duplicatesMerged: Math.max(0, links - all),
    sources: [...bySource].map(([sourceType, n]) => ({ sourceType, batches: n })),
    lastImport: last
      ? {
          filename: last.filename,
          sourceType: last.source_type,
          at: last.started_at,
          accepted: (last.report as { acceptedRows?: number } | null)?.acceptedRows ?? null,
        }
      : null,
  };
}

export interface TopCandidate {
  name: string;
  location: string | null;
  score: number;
  reasons: string[]; // top positive factor reasons from the latest score snapshot
}

export async function getTopCandidates(db: Db, limit = 5): Promise<TopCandidate[]> {
  const { data: cands } = await db
    .from("candidate")
    .select("id, full_name, city, state, current_score")
    .is("merged_into_id", null)
    .not("current_score", "is", null)
    .order("current_score", { ascending: false })
    .limit(limit);
  if (!cands?.length) return [];
  const { data: snaps } = await db
    .from("score_snapshot")
    .select("candidate_id, factors, created_at")
    .in("candidate_id", cands.map((x) => x.id))
    .order("created_at", { ascending: false })
    .limit(limit * 5);
  const latest = new Map<string, { factor: string; points: number; reason: string }[]>();
  for (const s of snaps ?? []) {
    if (!latest.has(s.candidate_id)) latest.set(s.candidate_id, (s.factors as { factor: string; points: number; reason: string }[]) ?? []);
  }
  return cands.map((x) => ({
    name: x.full_name ?? "Unknown",
    location: [x.city, x.state].filter(Boolean).join(", ") || null,
    score: x.current_score as number,
    reasons: (latest.get(x.id) ?? [])
      .filter((f) => f.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, 3)
      .map((f) => f.reason),
  }));
}

export interface EngagementStats {
  emailsSent: number;
  replies: number;
  meetings: number;
  showed: number;
  positive: number; // candidate.status = interested
  qualified: number; // completed questionnaires
}

export async function getEngagementStats(db: Db): Promise<EngagementStats> {
  const cand = () => db.from("candidate").select("id", { count: "exact", head: true }).is("merged_into_id", null);
  const [emailsSent, replies, meetings, showed, positive, qualified] = await Promise.all([
    c(db.from("interaction").select("id", { count: "exact", head: true }).eq("type", "email_sent")),
    c(db.from("interaction").select("id", { count: "exact", head: true }).eq("type", "email_reply")),
    c(db.from("interaction").select("id", { count: "exact", head: true }).eq("type", "meeting")),
    c(db.from("interaction").select("id", { count: "exact", head: true }).eq("type", "meeting").contains("payload", { outcome: "showed" })),
    c(cand().eq("status", "interested")),
    c(db.from("questionnaire").select("id", { count: "exact", head: true }).eq("kind", "cq_complete")),
  ]);
  return { emailsSent, replies, meetings, showed, positive, qualified };
}

export interface ContactHealth {
  emailAddresses: number;
  valid: number;
  risky: number;
  invalid: number;
  unverified: number;
  validPct: number;
}

export async function getContactHealth(db: Db): Promise<ContactHealth> {
  const [emailAddresses, valid, risky, invalid] = await Promise.all([
    c(db.from("identifier").select("id", { count: "exact", head: true }).eq("type", "email")),
    c(db.from("email_verification").select("id", { count: "exact", head: true }).eq("result", "valid")),
    c(db.from("email_verification").select("id", { count: "exact", head: true }).eq("result", "risky")),
    c(db.from("email_verification").select("id", { count: "exact", head: true }).eq("result", "invalid")),
  ]);
  const unverified = Math.max(0, emailAddresses - valid - risky - invalid);
  return { emailAddresses, valid, risky, invalid, unverified, validPct: emailAddresses ? Math.round((valid / emailAddresses) * 100) : 0 };
}

export interface AttentionItems {
  draftsAwaitingApproval: number;
  identityMergesToReview: number;
  blockedSends: number;
  failedAgentJobs: number;
  invalidOrRiskyEmails: number;
  suppressedContacts: number;
}

export async function getAttentionItems(db: Db): Promise<AttentionItems> {
  const [drafts, merges, blocked, failed, invalid, risky, suppressed] = await Promise.all([
    c(db.from("outreach_draft").select("id", { count: "exact", head: true }).eq("status", "draft")),
    c(db.from("identity_review").select("id", { count: "exact", head: true }).eq("status", "pending")),
    c(db.from("outreach_draft").select("id", { count: "exact", head: true }).eq("status", "blocked")),
    c(db.from("agent_job").select("id", { count: "exact", head: true }).eq("status", "failed")),
    c(db.from("email_verification").select("id", { count: "exact", head: true }).eq("result", "invalid")),
    c(db.from("email_verification").select("id", { count: "exact", head: true }).eq("result", "risky")),
    c(db.from("suppression").select("id", { count: "exact", head: true })),
  ]);
  return {
    draftsAwaitingApproval: drafts,
    identityMergesToReview: merges,
    blockedSends: blocked,
    failedAgentJobs: failed,
    invalidOrRiskyEmails: invalid + risky,
    suppressedContacts: suppressed,
  };
}

export interface OutreachStatus {
  drafts: Record<string, number>; // by status
  campaigns: { name: string; status: string }[];
  activeMailboxes: number;
  suppressed: number;
}

export async function getOutreachStatus(db: Db): Promise<OutreachStatus> {
  const [{ data: drafts }, { data: campaigns }, activeMailboxes, suppressed] = await Promise.all([
    db.from("outreach_draft").select("status"),
    db.from("campaign").select("name, status").order("created_at", { ascending: false }).limit(10),
    c(db.from("mailbox").select("id", { count: "exact", head: true }).eq("status", "active")),
    c(db.from("suppression").select("id", { count: "exact", head: true })),
  ]);
  const byStatus: Record<string, number> = {};
  for (const d of drafts ?? []) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
  return { drafts: byStatus, campaigns: campaigns ?? [], activeMailboxes, suppressed };
}

export interface RecentActivity {
  last24h: Record<string, number>; // event type → count
  last7d: Record<string, number>;
  latest: { type: string; at: string }[];
  spend: { llmUsd: number; verificationUsd: number; totalUsd: number };
}

export async function getRecentActivity(db: Db): Promise<RecentActivity> {
  const since7 = new Date(Date.now() - 7 * DAY).toISOString();
  const since1 = new Date(Date.now() - DAY).toISOString();
  const [{ data: events }, { data: costs }] = await Promise.all([
    db.from("event").select("type, created_at").gte("created_at", since7).order("created_at", { ascending: false }).limit(5000),
    db.from("cost_record").select("category, amount_usd").limit(5000),
  ]);
  const last24h: Record<string, number> = {};
  const last7d: Record<string, number> = {};
  for (const e of events ?? []) {
    last7d[e.type] = (last7d[e.type] ?? 0) + 1;
    if (e.created_at >= since1) last24h[e.type] = (last24h[e.type] ?? 0) + 1;
  }
  const sum = (cat?: string) =>
    (costs ?? [])
      .filter((r) => !cat || r.category === cat)
      .reduce((a, r) => a + parseFloat(r.amount_usd ?? "0"), 0);
  return {
    last24h,
    last7d,
    latest: (events ?? []).slice(0, 10).map((e) => ({ type: e.type, at: e.created_at })),
    spend: { llmUsd: sum("llm"), verificationUsd: sum("verification"), totalUsd: sum() },
  };
}

/** Everything Athena is allowed to know, in one read. */
export interface OperationsSnapshot {
  generatedAt: string;
  today: TodaySummary;
  leads: LeadStats;
  topCandidates: TopCandidate[];
  engagement: EngagementStats;
  contactHealth: ContactHealth;
  attention: AttentionItems;
  outreach: OutreachStatus;
  activity: RecentActivity;
  /** Things the data does NOT support — Athena must say so rather than guess. */
  notAvailable: string[];
}

export async function getOperationsSnapshot(db: Db): Promise<OperationsSnapshot> {
  const [today, leads, topCandidates, engagement, contactHealth, attention, outreach, activity] = await Promise.all([
    getTodaySummary(db),
    getLeadStats(db),
    getTopCandidates(db),
    getEngagementStats(db),
    getContactHealth(db),
    getAttentionItems(db),
    getOutreachStatus(db),
    getRecentActivity(db),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    today,
    leads,
    topCandidates,
    engagement,
    contactHealth,
    attention,
    outreach,
    activity,
    notAvailable: [
      "revenue, closed deals, and pipeline dollar value (attribution arrives in Phase 9)",
      "per-consultant performance, appointments by consultant, and consultant response times (routing + accountability arrives in Phase 7; the Consultant Command screen currently shows preview data, not live numbers)",
      "campaign-level attribution of replies or appointments",
      "CRM stage counts (Lead In, Talking to Zors, etc.) — those sync from GHL in Phase 7",
    ],
  };
}
