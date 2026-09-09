import type { RoutingRule } from "../types";

/** Candidate interest/brand hints matched against the consultant's specialties. */
export const specialty: RoutingRule = (c, ctx) => {
  const specs = c.specialties.map((s) => s.toLowerCase());
  const hit = ctx.candidate.interests.find((i) => specs.some((s) => s === i || i.includes(s) || s.includes(i)));
  if (hit) return { rule: "specialty", points: 25, reason: `specialty match: ${hit}` };
  return { rule: "specialty", points: 0, reason: specs.length ? "no specialty match" : "generalist" };
};
