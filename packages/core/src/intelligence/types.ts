/** Everything a scoring factor may read. Assembled once per batch; factors are pure. */
export interface ScoringContext {
  candidate: {
    id: string;
    fullName: string | null;
    city: string | null;
    state: string | null;
  };
  /** Most recent dated activity (interactions); null for cold records with no history. */
  latestActivityAt: Date | null;
  sourceTypes: string[];
  interactions: { type: string; direction: string; occurredAt: Date; payload: Record<string, unknown> }[];
  hasCqComplete: boolean;
  hasCqPartial: boolean;
  liquidityUsd: number | null;
  /** Latest non-superseded attribute values by key. */
  attributes: Record<string, unknown>;
  /** Best verification result across the candidate's email identifiers. */
  emailVerification: "valid" | "invalid" | "risky" | "unknown" | null;
  hasEmail: boolean;
  hasPhone: boolean;
  suppressed: boolean;
  now: Date;
}

export interface FactorResult {
  factor: string;
  points: number;
  reason: string;
}

/** One factor per file (CLAUDE.md §3). Pure and deterministic. */
export type ScoringFactor = (ctx: ScoringContext) => FactorResult;
