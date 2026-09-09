import type { RoutingRule } from "../types";

/** Lighter books rank higher: up to 15 points as load approaches zero. */
export const load: RoutingRule = (c) => {
  const free = c.maxLoad > 0 ? 1 - c.activeLoad / c.maxLoad : 0;
  const points = Math.round(15 * Math.max(0, free));
  return { rule: "load", points, reason: `${c.activeLoad}/${c.maxLoad} active` };
};
