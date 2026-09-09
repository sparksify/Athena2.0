import type { RoutingRule } from "../types";

/** Hard constraint: paused consultants and full books never receive leads. */
export const availability: RoutingRule = (c) => {
  if (c.status !== "active") return { rule: "availability", points: 0, reason: "paused", exclude: true };
  if (c.activeLoad >= c.maxLoad) {
    return { rule: "availability", points: 0, reason: `at capacity (${c.activeLoad}/${c.maxLoad})`, exclude: true };
  }
  return { rule: "availability", points: 0, reason: `available (${c.activeLoad}/${c.maxLoad})` };
};
