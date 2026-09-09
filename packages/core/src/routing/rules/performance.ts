import type { RoutingRule } from "../types";

/**
 * The reward loop (Steve, 2026-09-01): performance raises both the volume
 * and the quality of leads a consultant receives. Accept rate, first-touch
 * speed and show rate earn points; take-backs cost them; and candidates
 * scoring 85+ are reserved for consultants whose index is strong.
 */
export const TOP_LEAD_SCORE = 85;
export const TOP_LEAD_MIN_INDEX = 20;

export function performanceIndex(c: { stats: import("../types").ConsultantStats }): number {
  const s = c.stats;
  const acceptRate = s.offered > 0 ? s.accepted / s.offered : 0.75; // unknown = neutral
  const showRate = s.showed + s.noShow > 0 ? s.showed / (s.showed + s.noShow) : 0.7;
  const touch = s.firstTouchMedianHours;
  const touchPts = touch == null ? 5 : touch <= 4 ? 10 : touch <= 24 ? 5 : 0;
  const penalty = Math.min(20, 10 * s.takeBacks30d);
  return Math.round(20 * acceptRate + 10 * showRate + touchPts - penalty);
}

export const performance: RoutingRule = (c, ctx) => {
  const idx = performanceIndex(c);
  const score = ctx.candidate.score ?? 0;
  if (score >= TOP_LEAD_SCORE && idx < TOP_LEAD_MIN_INDEX) {
    return { rule: "performance", points: idx - 15, reason: `index ${idx}; top lead (${score}) reserved for stronger performers` };
  }
  return { rule: "performance", points: idx, reason: `index ${idx}` };
};
