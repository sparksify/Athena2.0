// Phase 7 preview fixtures. The consultant roster and their live-opportunity
// counts come from the Athena 1.0 command center; every performance metric
// (accept rate, first touch, show rate, revenue, SLA state) is PLACEHOLDER
// DEMO DATA until Phase 7 wires live queries. Lead names are fictional on
// purpose — real lead PII stays out of the repo. Avatars are generated
// placeholder art in /public/avatars; real photos upload via admin later.

import type { AgentName } from "@/components/agent-avatar";

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

export type DemoConsultant = {
  name: string;
  avatar: string;
  brands: string; // short brand mix line (from the 1.0 ownership panel)
  contacted: number; // live opportunities owned (1.0 counts)
  acceptRate: number; // % — demo
  firstTouch: string; // median — demo
  showRate: number; // % — demo
  introToClose: number; // % — demo
  revenue: number; // $ — demo
  load: [number, number]; // active / capacity — active from 1.0, capacity demo
  sla: SlaState; // demo
};

const av = (f: string) => `/avatars/${f}.svg`;

export const CONSULTANTS: DemoConsultant[] = [
  { name: "Rob Petka", avatar: av("rob-petka"), brands: "4EverCharge · CRS · Subcontain", contacted: 31, acceptRate: 97, firstTouch: "2h 10m", showRate: 78, introToClose: 12.5, revenue: 105_000, load: [31, 32], sla: "on_track" },
  { name: "Adam Gruen", avatar: av("adam-gruen"), brands: "Subcontain · 4EverCharge · CRS", contacted: 19, acceptRate: 92, firstTouch: "3h 40m", showRate: 74, introToClose: 10.2, revenue: 71_000, load: [19, 24], sla: "on_track" },
  { name: "Paulette Callender", avatar: av("paulette-callender"), brands: "Complete Mobile Drug Testing · CRS", contacted: 16, acceptRate: 94, firstTouch: "2h 55m", showRate: 81, introToClose: 14.1, revenue: 88_000, load: [16, 20], sla: "on_track" },
  { name: "Michael Stavrinakis", avatar: av("michael-stavrinakis"), brands: "4EverCharge · FMB Re-engagement", contacted: 16, acceptRate: 88, firstTouch: "5h 05m", showRate: 69, introToClose: 8.4, revenue: 54_000, load: [16, 20], sla: "on_track" },
  { name: "Lane Klastow", avatar: av("lane-klastow"), brands: "CRS · 4EverCharge · Sung Athena", contacted: 15, acceptRate: 90, firstTouch: "4h 20m", showRate: 72, introToClose: 9.0, revenue: 49_000, load: [15, 20], sla: "on_track" },
  { name: "Dave Sullivan", avatar: av("dave-sullivan"), brands: "Resting Rainbow · 4EverCharge", contacted: 14, acceptRate: 86, firstTouch: "6h 10m", showRate: 66, introToClose: 7.3, revenue: 42_000, load: [14, 18], sla: "on_track" },
  { name: "Mariel Miller", avatar: av("mariel-miller"), brands: "CRS · Content Recovery Specialists", contacted: 13, acceptRate: 89, firstTouch: "4h 45m", showRate: 70, introToClose: 8.8, revenue: 46_000, load: [13, 18], sla: "on_track" },
  { name: "Stephen Rotay", avatar: av("stephen-rotay"), brands: "Sung Athena · Subcontain · 4EverCharge", contacted: 11, acceptRate: 81, firstTouch: "11h 30m", showRate: 61, introToClose: 5.2, revenue: 28_000, load: [11, 16], sla: "nudged" },
  { name: "Chris Davenport", avatar: av("chris-davenport"), brands: "4EverCharge · CRS", contacted: 9, acceptRate: 77, firstTouch: "1d 2h", showRate: 55, introToClose: 4.0, revenue: 18_000, load: [9, 16], sla: "escalated" },
  { name: "Aaron Bakken", avatar: av("aaron-bakken"), brands: "Cleanup tracked", contacted: 9, acceptRate: 63, firstTouch: "2d 4h", showRate: 48, introToClose: 0, revenue: 0, load: [9, 16], sla: "take_back" },
];

export const consultantAvatar = (name: string) =>
  CONSULTANTS.find((c) => c.name === name)?.avatar ?? av("rob-petka");

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
  liveOpportunities: 116,
  pipelineValue: 749_000,
  medianFirstTouch: "3h 12m",
  showRate: 71,
  slaBreaches48h: 2,
  takeBacks30d: 5,
};
