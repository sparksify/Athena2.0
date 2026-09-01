// Phase 7 preview fixtures. The consultant roster and their live-opportunity
// counts come from the Athena 1.0 command center; every performance metric
// (consult counts, speed to consult, CQ rate, first touch, show rate, revenue,
// SLA state) is PLACEHOLDER DEMO DATA until Phase 7 wires live queries. Lead
// names are fictional on purpose — real lead PII stays out of the repo.
// Avatars are generated placeholder art in /public/avatars; real photos
// upload via admin later.
//
// Metric definitions (Steve, 2026-09-01, from Nick's 2026-08-30 email):
// - Speed to consultation: assignment → completed consult appointment.
// - Real consult: a completed consultation-type appointment with a logged
//   disposition. Target: 3 per consultant per week.
// - CQ before consult: tracked and chased now; booking hard-gate is the
//   Phase 7 rule.

import { resolveAvatar, type AgentName } from "@/components/agent-avatar";

export const STAGES = [
  "Lead In", "Contact Made", "CQ Sent", "CQ Received", "Talking to Zors",
  "D-Day Scheduled", "Contract Out", "Closed / Funded",
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_MIX: Record<Stage, number> = {
  "Lead In": 66, "Contact Made": 25, "CQ Sent": 9, "CQ Received": 4,
  "Talking to Zors": 11, "D-Day Scheduled": 0, "Contract Out": 1, "Closed / Funded": 0,
};

export type SlaState = "on_track" | "nudged" | "escalated" | "take_back";

export const SLA_LABEL: Record<SlaState, string> = {
  on_track: "On track",
  nudged: "Nudged",
  escalated: "Escalated",
  take_back: "Take-back",
};

export const WEEKLY_CONSULT_TARGET = 3;

export type DemoConsultant = {
  name: string;
  avatar: string;
  brands: string; // short brand mix line (from the 1.0 ownership panel)
  contacted: number; // live opportunities owned (1.0 counts)
  consultsThisWeek: number; // completed real consults, current week — demo
  speedToConsult: string | null; // median assignment → consult held — demo
  cqBeforeConsult: number | null; // % of consults with CQ in hand first — demo
  acceptRate: number; // % — demo
  firstTouch: string; // median — demo
  showRate: number; // % — demo
  revenue: number; // $ — demo
  load: [number, number]; // active / capacity — active from 1.0, capacity demo
  sla: SlaState; // demo
};

const av = resolveAvatar;

export const CONSULTANTS: DemoConsultant[] = [
  { name: "Rob Petka", avatar: av("rob-petka"), brands: "4EverCharge · CRS · Subcontain", contacted: 31, consultsThisWeek: 4, speedToConsult: "1d 18h", cqBeforeConsult: 100, acceptRate: 97, firstTouch: "2h 10m", showRate: 78, revenue: 105_000, load: [31, 32], sla: "on_track" },
  { name: "Adam Gruen", avatar: av("adam-gruen"), brands: "Subcontain · 4EverCharge · CRS", contacted: 19, consultsThisWeek: 3, speedToConsult: "2d 2h", cqBeforeConsult: 92, acceptRate: 92, firstTouch: "3h 40m", showRate: 74, revenue: 71_000, load: [19, 24], sla: "on_track" },
  { name: "Paulette Callender", avatar: av("paulette-callender"), brands: "Complete Mobile Drug Testing · CRS", contacted: 16, consultsThisWeek: 3, speedToConsult: "1d 22h", cqBeforeConsult: 100, acceptRate: 94, firstTouch: "2h 55m", showRate: 81, revenue: 88_000, load: [16, 20], sla: "on_track" },
  { name: "Michael Stavrinakis", avatar: av("michael-stavrinakis"), brands: "4EverCharge · FMB Re-engagement", contacted: 16, consultsThisWeek: 2, speedToConsult: "2d 20h", cqBeforeConsult: 88, acceptRate: 88, firstTouch: "5h 05m", showRate: 69, revenue: 54_000, load: [16, 20], sla: "on_track" },
  { name: "Lane Klastow", avatar: av("lane-klastow"), brands: "CRS · 4EverCharge · Sung Athena", contacted: 15, consultsThisWeek: 3, speedToConsult: "2d 8h", cqBeforeConsult: 90, acceptRate: 90, firstTouch: "4h 20m", showRate: 72, revenue: 49_000, load: [15, 20], sla: "on_track" },
  { name: "Dave Sullivan", avatar: av("dave-sullivan"), brands: "Resting Rainbow · 4EverCharge", contacted: 14, consultsThisWeek: 2, speedToConsult: "3d 1h", cqBeforeConsult: 83, acceptRate: 86, firstTouch: "6h 10m", showRate: 66, revenue: 42_000, load: [14, 18], sla: "on_track" },
  { name: "Mariel Miller", avatar: av("mariel-miller"), brands: "CRS · Content Recovery Specialists", contacted: 13, consultsThisWeek: 2, speedToConsult: "2d 12h", cqBeforeConsult: 89, acceptRate: 89, firstTouch: "4h 45m", showRate: 70, revenue: 46_000, load: [13, 18], sla: "on_track" },
  { name: "Stephen Rotay", avatar: av("stephen-rotay"), brands: "Sung Athena · Subcontain · 4EverCharge", contacted: 11, consultsThisWeek: 1, speedToConsult: "4d 6h", cqBeforeConsult: 75, acceptRate: 81, firstTouch: "11h 30m", showRate: 61, revenue: 28_000, load: [11, 16], sla: "nudged" },
  { name: "Chris Davenport", avatar: av("chris-davenport"), brands: "4EverCharge · CRS", contacted: 9, consultsThisWeek: 1, speedToConsult: "5d 2h", cqBeforeConsult: 60, acceptRate: 77, firstTouch: "1d 2h", showRate: 55, revenue: 18_000, load: [9, 16], sla: "escalated" },
  { name: "Aaron Bakken", avatar: av("aaron-bakken"), brands: "Cleanup tracked", contacted: 9, consultsThisWeek: 0, speedToConsult: null, cqBeforeConsult: null, acceptRate: 63, firstTouch: "2d 4h", showRate: 48, revenue: 0, load: [9, 16], sla: "take_back" },
];

export const consultantAvatar = (name: string) =>
  CONSULTANTS.find((c) => c.name === name)?.avatar ?? av("rob-petka");

// Assignment → consultation funnel over the visible scope. Medians are
// cumulative elapsed time from assignment to reaching that step.
export type FunnelStep = { label: string; count: number; median: string | null };

export const CONSULT_FUNNEL: FunnelStep[] = [
  { label: "Assigned", count: 116, median: null },
  { label: "First touch", count: 104, median: "3h 12m" },
  { label: "CQ received", count: 61, median: "1d 4h" },
  { label: "Real consult held", count: 31, median: "2d 6h" },
  { label: "Advancing after consult", count: 24, median: null },
];

export type CqStatus = "received" | "sent" | "missing";

export type UpcomingConsult = {
  lead: string;
  consultant: string;
  when: string;
  cq: CqStatus;
  agent: AgentName;
};

// Booked consults in the next 7 days, with CQ state. "Missing" rows are the
// chase list until the Phase 7 booking hard-gate ships.
export const UPCOMING_CONSULTS: UpcomingConsult[] = [
  { lead: "Naomi Tran", consultant: "Rob Petka", when: "Today 2:00p", cq: "received", agent: "Sophie" },
  { lead: "Alan Ashford", consultant: "Rob Petka", when: "Tomorrow 10:00a", cq: "received", agent: "Tim" },
  { lead: "Chris Mulvaney", consultant: "Stephen Rotay", when: "Tomorrow 3:30p", cq: "sent", agent: "Rina" },
  { lead: "Devon Price", consultant: "Lane Klastow", when: "Thu 11:00a", cq: "missing", agent: "Tim" },
  { lead: "Joe Shearer", consultant: "Rob Petka", when: "Fri 9:00a", cq: "missing", agent: "Tim" },
];

export type DemoAgent = {
  name: AgentName;
  role: string;
  handoffs: number;
  repliesHandled: number;
  activeAssignments: number;
};

export const AGENTS: DemoAgent[] = [
  { name: "Tim", role: "Outreach & follow-up", handoffs: 214, repliesHandled: 1_890, activeAssignments: 41 },
  { name: "Sophie", role: "Reply triage & qualification", handoffs: 133, repliesHandled: 1_245, activeAssignments: 28 },
  { name: "Claire", role: "Reactivation campaigns", handoffs: 52, repliesHandled: 610, activeAssignments: 15 },
  { name: "Rina", role: "Scheduling & nudges", handoffs: 28, repliesHandled: 402, activeAssignments: 9 },
];

export type DemoLead = {
  lead: string;
  email: string;
  brand: string;
  agent: AgentName;
  stage: Stage;
  daysInStage: number;
  sla: SlaState;
};

export const OWNERSHIP: { consultant: string; leads: DemoLead[] }[] = [
  {
    consultant: "Rob Petka",
    leads: [
      { lead: "Alan Ashford", email: "alan.ashford@example.com", brand: "4EverCharge", agent: "Tim", stage: "Talking to Zors", daysInStage: 4, sla: "on_track" },
      { lead: "Naomi Tran", email: "naomi.tran@example.com", brand: "CRS", agent: "Sophie", stage: "CQ Received", daysInStage: 2, sla: "on_track" },
      { lead: "Joe Shearer", email: "joe.shearer@example.com", brand: "Subcontain", agent: "Tim", stage: "Contact Made", daysInStage: 1, sla: "on_track" },
      { lead: "Felice Vidal", email: "felice.vidal@example.com", brand: "Resting Rainbow", agent: "Claire", stage: "Lead In", daysInStage: 0, sla: "on_track" },
    ],
  },
  {
    consultant: "Stephen Rotay",
    leads: [
      { lead: "Manuel Cerruti", email: "manuel.cerruti@example.com", brand: "Sung Athena", agent: "Tim", stage: "Lead In", daysInStage: 1, sla: "nudged" },
      { lead: "Mikhail Toro", email: "mikhail.toro@example.com", brand: "Subcontain", agent: "Sophie", stage: "Lead In", daysInStage: 1, sla: "nudged" },
      { lead: "Chris Mulvaney", email: "chris.mulvaney@example.com", brand: "4EverCharge", agent: "Rina", stage: "Contact Made", daysInStage: 6, sla: "on_track" },
    ],
  },
  {
    consultant: "Aaron Bakken",
    leads: [
      { lead: "Rashad Rahim", email: "rashad.rahim@example.com", brand: "Resting Rainbow", agent: "Claire", stage: "Lead In", daysInStage: 2, sla: "take_back" },
      { lead: "Stefan Olsen", email: "stefan.olsen@example.com", brand: "Sung Athena", agent: "Rina", stage: "Lead In", daysInStage: 2, sla: "take_back" },
      { lead: "Simar Bhagat", email: "simar.bhagat@example.com", brand: "FCC Franchise Development Consulting", agent: "Tim", stage: "Lead In", daysInStage: 1, sla: "escalated" },
    ],
  },
];

export type TakeBackRow = {
  lead: string;
  consultant: string;
  agent: AgentName;
  hoursSinceAssign: number;
};

// 48h no-touch rule: these assignments are approaching or past the wall.
export const TAKE_BACK_QUEUE: TakeBackRow[] = [
  { lead: "Rashad Rahim", consultant: "Aaron Bakken", agent: "Claire", hoursSinceAssign: 49 },
  { lead: "Stefan Olsen", consultant: "Aaron Bakken", agent: "Rina", hoursSinceAssign: 47 },
  { lead: "Simar Bhagat", consultant: "Aaron Bakken", agent: "Tim", hoursSinceAssign: 41 },
  { lead: "Petra Novak", consultant: "Chris Davenport", agent: "Sophie", hoursSinceAssign: 38 },
];

export const SLA_COUNTS: Record<SlaState, number> = {
  on_track: 47, nudged: 9, escalated: 4, take_back: 2,
};

export const KPIS = {
  speedToConsult: "2d 6h",
  consultsThisWeek: 21,
  consultTargetThisWeek: CONSULTANTS.length * WEEKLY_CONSULT_TARGET,
  cqBeforeConsultRate: 88,
  liveOpportunities: 116,
  pipelineValue: 749_000,
  medianFirstTouch: "3h 12m",
  showRate: 71,
  slaBreaches48h: 2,
  takeBacks30d: 5,
};
