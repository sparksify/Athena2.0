import type { RoutingRule } from "../types";

/** Candidate state inside the consultant's territories; empty territories = national. */
export const territory: RoutingRule = (c, ctx) => {
  const state = ctx.candidate.state?.toUpperCase() ?? null;
  const terr = c.territories.map((t) => t.toUpperCase());
  if (!terr.length) return { rule: "territory", points: 5, reason: "national coverage" };
  if (state && terr.includes(state)) return { rule: "territory", points: 20, reason: `covers ${state}` };
  return { rule: "territory", points: 0, reason: state ? `outside territory (${state})` : "candidate state unknown" };
};
