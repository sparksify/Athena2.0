// DEMO FIXTURES for the Phase 7 preview. Every name and number in this file
// is fictional (consultant names come from Steve's approved UI mockup).
// When Phase 7 lands (consultant/assignment/opportunity tables), this file
// is deleted and the page reads live queries instead.

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
  city: string;
  contacted: number;
  acceptRate: number; // %
  firstTouch: string; // median
  showRate: number; // %
  introToClose: number; // %
  revenue: number; // $
  load: [number, number]; // active / capacity
  sla: SlaState;
};

export const CONSULTANTS: DemoConsultant[] = [
  { name: "Maria Alvarez", city: "Miami, FL", contacted: 31, acceptRate: 97, firstTouch: "2h 10m", showRate: 78, introToClose: 12.5, revenue: 105_000, load: [14, 18], sla: "on_track" },
  { name: "James Okafor", city: "Irvine, CA", contacted: 26, acceptRate: 90, firstTouch: "4h 35m", showRate: 71, introToClose: 9.6, revenue: 62_500, load: [11, 18], sla: "on_track" },
  { name: "Sona Patil", city: "Plano, TX", contacted: 22, acceptRate: 91, firstTouch: "3h 02m", showRate: 81, introToClose: 16.4, revenue: 80_000, load: [9, 15], sla: "on_track" },
  { name: "Dana Brennan", city: "Austin, TX", contacted: 24, acceptRate: 79, firstTouch: "1d 3h", showRate: 58, introToClose: 6.2, revenue: 40_000, load: [19, 18], sla: "nudged" },
  { name: "Elena Cho", city: "Denver, CO", contacted: 17, acceptRate: 84, firstTouch: "6h 48m", showRate: 64, introToClose: 7.1, revenue: 35_000, load: [8, 15], sla: "escalated" },
  { name: "Rolf Lindqvist", city: "Scottsdale, AZ", contacted: 18, acceptRate: 65, firstTouch: "2d 6h", showRate: 50, introToClose: 0, revenue: 0, load: [5, 15], sla: "take_back" },
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
    consultant: "Maria Alvarez",
    leads: [
      { lead: "Alan Ashford", email: "alan.ashford@example.com", brand: "4EverCharge", agent: "Tim", stage: "Talking to Zors", daysInStage: 4, sla: "on_track" },
      { lead: "Naomi Tran", email: "naomi.tran@example.com", brand: "CRS", agent: "Sophie", stage: "CQ Received", daysInStage: 2, sla: "on_track" },
      { lead: "Joe Shearer", email: "joe.shearer@example.com", brand: "Subcontain", agent: "Tim", stage: "Contact Made", daysInStage: 1, sla: "on_track" },
      { lead: "Felice Vidal", email: "felice.vidal@example.com", brand: "Resting Rainbow", agent: "Claire", stage: "Lead In", daysInStage: 0, sla: "on_track" },
    ],
  },
  {
    consultant: "Dana Brennan",
    leads: [
      { lead: "Manuel Cerruti", email: "manuel.cerruti@example.com", brand: "Sung Athena", agent: "Tim", stage: "Lead In", daysInStage: 1, sla: "nudged" },
      { lead: "Mikhail Toro", email: "mikhail.toro@example.com", brand: "Subcontain", agent: "Sophie", stage: "Lead In", daysInStage: 1, sla: "nudged" },
      { lead: "Chris Mulvaney", email: "chris.mulvaney@example.com", brand: "4EverCharge", agent: "Rina", stage: "Contact Made", daysInStage: 6, sla: "on_track" },
    ],
  },
  {
    consultant: "Rolf Lindqvist",
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
  { lead: "Rashad Rahim", consultant: "Rolf Lindqvist", agent: "Claire", hoursSinceAssign: 49 },
  { lead: "Stefan Olsen", consultant: "Rolf Lindqvist", agent: "Rina", hoursSinceAssign: 47 },
  { lead: "Simar Bhagat", consultant: "Rolf Lindqvist", agent: "Tim", hoursSinceAssign: 41 },
  { lead: "Petra Novak", consultant: "Elena Cho", agent: "Sophie", hoursSinceAssign: 38 },
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
