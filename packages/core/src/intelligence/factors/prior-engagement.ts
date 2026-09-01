import type { ScoringFactor } from "../types.js";

const INBOUND = new Set(["email_reply", "call", "meeting"]);

/** Did they ever engage back, or were they only ever contacted? Max 12. */
export const priorEngagement: ScoringFactor = (ctx) => {
  const inbound = ctx.interactions.filter(
    (i) => i.direction === "inbound" && INBOUND.has(i.type),
  ).length;
  if (inbound > 0) {
    return { factor: "prior_engagement", points: 12, reason: `${inbound} inbound interaction(s) (reply/call/meeting)` };
  }
  if (ctx.interactions.some((i) => i.direction === "outbound")) {
    return { factor: "prior_engagement", points: 4, reason: "contacted before, never engaged back" };
  }
  return { factor: "prior_engagement", points: 0, reason: "no interaction history" };
};
