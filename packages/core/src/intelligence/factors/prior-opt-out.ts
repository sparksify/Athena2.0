import type { ScoringFactor } from "../types";

/** A suppressed identifier floors the score: never worth contacting. */
export const priorOptOut: ScoringFactor = (ctx) => {
  if (ctx.suppressed) {
    return { factor: "prior_opt_out", points: -100, reason: "identifier on the suppression list — do not contact" };
  }
  return { factor: "prior_opt_out", points: 0, reason: "no opt-out on record" };
};
