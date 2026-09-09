/** Everything a routing rule may read. Assembled once per routing decision; rules are pure. */
export interface RoutingCandidate {
  id: string;
  score: number | null;
  state: string | null;
  /** Lower-cased interest/brand/industry hints from provenance-backed attributes. */
  interests: string[];
  /** Consultants this candidate has interacted with before (interaction.consultant_id). */
  priorConsultantIds: string[];
}

export interface ConsultantStats {
  /** Assignments offered in the last 90 days. */
  offered: number;
  accepted: number;
  declined: number;
  takeBacks30d: number;
  /** Median hours from offer to first touch; null when no touches yet. */
  firstTouchMedianHours: number | null;
  showed: number;
  noShow: number;
  /** Completed consultations (showed + disposition) this week. */
  consultsThisWeek: number;
  /** Median hours from assignment to a completed consultation. */
  speedToConsultMedianHours: number | null;
  /** Share of completed consults with a completed CQ on file before the meeting. */
  cqBeforeConsultRate: number | null;
}

export interface RoutingConsultant {
  id: string;
  name: string;
  userId: string | null;
  status: "active" | "paused";
  maxLoad: number;
  /** Live assignments (offered + accepted). */
  activeLoad: number;
  specialties: string[];
  territories: string[];
  lastAssignedAt: Date | null;
  stats: ConsultantStats;
}

export interface RoutingContext {
  candidate: RoutingCandidate;
  now: Date;
}

export interface RuleResult {
  rule: string;
  points: number;
  reason: string;
  /** A hard constraint failed; the consultant is dropped regardless of points. */
  exclude?: boolean;
}

/** One rule per file (CLAUDE.md §3). Pure and deterministic. */
export type RoutingRule = (consultant: RoutingConsultant, ctx: RoutingContext) => RuleResult;

export const EMPTY_STATS: ConsultantStats = {
  offered: 0, accepted: 0, declined: 0, takeBacks30d: 0, firstTouchMedianHours: null,
  showed: 0, noShow: 0, consultsThisWeek: 0, speedToConsultMedianHours: null, cqBeforeConsultRate: null,
};
