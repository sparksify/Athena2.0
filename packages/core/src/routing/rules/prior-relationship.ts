import type { RoutingRule } from "../types";

/** A consultant who has already talked to this person keeps them. */
export const priorRelationship: RoutingRule = (c, ctx) => {
  if (ctx.candidate.priorConsultantIds.includes(c.id)) {
    return { rule: "prior_relationship", points: 50, reason: "has worked with this candidate before" };
  }
  return { rule: "prior_relationship", points: 0, reason: "no prior relationship" };
};
