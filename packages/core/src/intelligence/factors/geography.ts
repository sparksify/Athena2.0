import type { ScoringFactor } from "../types";

/** A locatable candidate is routable and matchable. Max 5.
 *  (Territory availability joins this factor in Phase 8.) */
export const geography: ScoringFactor = (ctx) => {
  const { city, state } = ctx.candidate;
  if (city && state) return { factor: "geography", points: 5, reason: `${city}, ${state}` };
  if (state) return { factor: "geography", points: 3, reason: `state known (${state})` };
  return { factor: "geography", points: 0, reason: "no location on record" };
};
