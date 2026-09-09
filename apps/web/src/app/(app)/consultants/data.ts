/* Consultant Command data source. Live tables when DATABASE_URL is set and
   the org has routing activity; otherwise the labeled demo fixtures so the
   screen stays reviewable before the first handoff. Shapes match
   demo-data.ts one-for-one so the page renders either without branching. */

import { getDb } from "@athena/db";
import { loadBoard, type Board, type SlaState } from "@athena/core";
import { resolveAvatar, type AgentName } from "@/components/agent-avatar";
import * as demo from "./demo-data";

export interface ConsultantData {
  sample: boolean;
  CONSULTANTS: demo.DemoConsultant[];
  CONSULT_FUNNEL: demo.FunnelStep[];
  UPCOMING_CONSULTS: demo.UpcomingConsult[];
  AGENTS: demo.DemoAgent[];
  OWNERSHIP: { consultant: string; leads: demo.DemoLead[] }[];
  TAKE_BACK_QUEUE: demo.TakeBackRow[];
  SLA_COUNTS: Record<SlaState, number>;
  STAGE_MIX: Record<demo.Stage, number>;
  KPIS: typeof demo.KPIS;
  OVERVIEW_KPIS: typeof demo.OVERVIEW_KPIS;
  consultantAvatar: (name: string) => string;
  board: Board | null;
}

export const hours = (h: number | null): string | null => {
  if (h == null) return null;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 24) return `${Math.floor(h)}h ${Math.round((h % 1) * 60).toString().padStart(2, "0")}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${Math.round(h % 24)}h`;
};
const AGENT_NAMES: AgentName[] = ["Tim", "Sophie", "Claire", "Rina"];
const agentName = (n: string | null): AgentName => (AGENT_NAMES.includes(n as AgentName) ? (n as AgentName) : "Tim");
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const when = (d: Date) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - today.getTime()) / 86_400_000);
  const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(" ", "");
  const day = diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : d.toLocaleDateString("en-US", { weekday: "short" });
  return `${day} ${t}`;
};

function fromDemo(): ConsultantData {
  return {
    sample: true, CONSULTANTS: demo.CONSULTANTS, CONSULT_FUNNEL: demo.CONSULT_FUNNEL, UPCOMING_CONSULTS: demo.UPCOMING_CONSULTS,
    AGENTS: demo.AGENTS, OWNERSHIP: demo.OWNERSHIP, TAKE_BACK_QUEUE: demo.TAKE_BACK_QUEUE, SLA_COUNTS: demo.SLA_COUNTS,
    STAGE_MIX: demo.STAGE_MIX, KPIS: demo.KPIS, OVERVIEW_KPIS: demo.OVERVIEW_KPIS, consultantAvatar: demo.consultantAvatar, board: null,
  };
}

function fromBoard(b: Board): ConsultantData {
  const pct = (num: number, den: number) => (den > 0 ? Math.round((100 * num) / den) : 0);
  const CONSULTANTS: demo.DemoConsultant[] = b.consultants.map((c) => ({
    name: c.name,
    avatar: resolveAvatar(c.avatarSlug ?? slug(c.name)),
    brands: c.brands.join(" · ") || "—",
    contacted: c.activeLoad,
    consultsThisWeek: c.stats.consultsThisWeek,
    speedToConsult: hours(c.stats.speedToConsultMedianHours),
    cqBeforeConsult: c.stats.cqBeforeConsultRate == null ? null : Math.round(c.stats.cqBeforeConsultRate * 100),
    acceptRate: pct(c.stats.accepted, c.stats.offered),
    firstTouch: hours(c.stats.firstTouchMedianHours) ?? "—",
    showRate: pct(c.stats.showed, c.stats.showed + c.stats.noShow),
    revenue: 0,
    load: [c.activeLoad, c.maxLoad],
    sla: c.sla,
  }));
  const stageLabel = (s: string) => (demo.STAGES as readonly string[]).find((l) => l.toLowerCase().replace(/[^a-z]/g, "") === s.replace(/_/g, "")) as demo.Stage | undefined;
  const STAGE_MIX = Object.fromEntries(demo.STAGES.map((s) => [s, 0])) as Record<demo.Stage, number>;
  for (const [k, n] of Object.entries(b.stageMix)) {
    const label = k === "closed_funded" ? "Closed / Funded" : stageLabel(k);
    if (label) STAGE_MIX[label] = n;
  }
  return {
    sample: false,
    CONSULTANTS,
    CONSULT_FUNNEL: b.funnel.map((f) => ({ label: f.label, count: f.count, median: hours(f.medianHours) })),
    UPCOMING_CONSULTS: b.upcoming.slice(0, 8).map((a) => ({ lead: a.lead, consultant: a.consultant, when: when(a.startsAt), cq: a.cq, agent: agentName(a.agent) })),
    AGENTS: b.agents.map((a) => ({ name: agentName(a.name), role: a.address ? a.address : "mailbox not configured", handoffs: a.handoffs, repliesHandled: 0, activeAssignments: a.activeAssignments })),
    OWNERSHIP: b.ownership.map((o) => ({
      consultant: o.consultant,
      leads: o.leads.map((l) => ({ lead: l.lead, email: l.email ?? "", brand: l.brand ?? "—", agent: agentName(l.agent), stage: (stageLabel(l.stage) ?? "Lead In") as demo.Stage, daysInStage: l.daysInStage, sla: l.sla })),
    })),
    TAKE_BACK_QUEUE: b.takeBackQueue.slice(0, 8).map((t) => ({ lead: t.lead, consultant: t.consultant, agent: agentName(t.agent), hoursSinceAssign: Math.round(t.hoursSinceAssign) })),
    SLA_COUNTS: b.slaCounts,
    STAGE_MIX,
    KPIS: {
      speedToConsult: hours(b.kpis.speedToConsultHours) ?? "—",
      consultsThisWeek: b.kpis.consultsThisWeek,
      consultTargetThisWeek: b.kpis.consultTargetThisWeek,
      cqBeforeConsultRate: b.kpis.cqBeforeConsultRate ?? 0,
      liveOpportunities: b.kpis.liveOpportunities,
      pipelineValue: b.kpis.pipelineValue,
      medianFirstTouch: hours(b.kpis.medianFirstTouchHours) ?? "—",
      showRate: b.kpis.showRate ?? 0,
      slaBreaches48h: b.kpis.slaBreaches48h,
      takeBacks30d: b.kpis.takeBacks30d,
    },
    OVERVIEW_KPIS: { openOpportunities: b.kpis.liveOpportunities, pipelineValue: b.kpis.pipelineValue, positiveReplies: b.kpis.positiveReplies, consultantHandoffs: b.kpis.handoffs },
    consultantAvatar: (name: string) => CONSULTANTS.find((c) => c.name === name)?.avatar ?? resolveAvatar(slug(name)),
    board: b,
  };
}

export async function loadConsultantData(orgId: string | null): Promise<ConsultantData> {
  if (!process.env.DATABASE_URL || !orgId) return fromDemo();
  try {
    const board = await loadBoard(getDb(), orgId);
    return board.hasData ? fromBoard(board) : { ...fromDemo(), board };
  } catch (err) {
    console.error("[consultants] live board failed, showing sample data", err);
    return fromDemo();
  }
}
