import type { RoutingRule } from "../types";

/** Tie-breaker: the consultant who waited longest since their last lead. */
export const roundRobin: RoutingRule = (c, ctx) => {
  if (!c.lastAssignedAt) return { rule: "round_robin", points: 5, reason: "never assigned" };
  const hours = (ctx.now.getTime() - c.lastAssignedAt.getTime()) / 3_600_000;
  const points = Math.min(5, Math.round((hours / 24) * 10) / 10);
  return { rule: "round_robin", points, reason: `${Math.round(hours)}h since last lead` };
};
