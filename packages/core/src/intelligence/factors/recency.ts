import type { ScoringFactor } from "../types";

const DAY = 86_400_000;

/** How recently this person last did anything we know the date of. Max 20. */
export const recency: ScoringFactor = (ctx) => {
  if (!ctx.latestActivityAt) {
    return { factor: "recency", points: 5, reason: "no dated activity history (cold record)" };
  }
  const days = Math.floor((ctx.now.getTime() - ctx.latestActivityAt.getTime()) / DAY);
  if (days <= 180) return { factor: "recency", points: 20, reason: `active ${days}d ago (≤6mo)` };
  if (days <= 365) return { factor: "recency", points: 15, reason: `active ${days}d ago (≤1y)` };
  if (days <= 730) return { factor: "recency", points: 10, reason: `active ${days}d ago (≤2y)` };
  if (days <= 1825) return { factor: "recency", points: 5, reason: `active ${days}d ago (≤5y)` };
  return { factor: "recency", points: 0, reason: `last activity ${days}d ago (>5y)` };
};
