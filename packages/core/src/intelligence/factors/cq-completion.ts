import type { ScoringFactor } from "../types.js";

/** A completed franchise questionnaire is the strongest historical intent signal. Max 15. */
export const cqCompletion: ScoringFactor = (ctx) => {
  if (ctx.hasCqComplete) return { factor: "cq_completion", points: 15, reason: "completed a franchise questionnaire" };
  if (ctx.hasCqPartial) return { factor: "cq_completion", points: 7, reason: "started but did not finish a questionnaire" };
  return { factor: "cq_completion", points: 0, reason: "no questionnaire on record" };
};
