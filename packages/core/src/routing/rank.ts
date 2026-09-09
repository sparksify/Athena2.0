import { ROUTING_RULES } from "./rules/index";
import type { RoutingConsultant, RoutingContext, RuleResult } from "./types";

export interface RankedConsultant {
  consultantId: string;
  name: string;
  total: number;
  factors: RuleResult[];
}

/**
 * Deterministic ranking: every rule runs, hard constraints drop the
 * consultant, points sum, ties break on name so two runs never disagree.
 */
export function rankConsultants(
  consultants: RoutingConsultant[],
  ctx: RoutingContext,
  opts: { excludeIds?: string[] } = {},
): RankedConsultant[] {
  const excluded = new Set(opts.excludeIds ?? []);
  const ranked: RankedConsultant[] = [];
  for (const c of consultants) {
    if (excluded.has(c.id)) continue;
    const factors = ROUTING_RULES.map((rule) => rule(c, ctx));
    if (factors.some((f) => f.exclude)) continue;
    ranked.push({ consultantId: c.id, name: c.name, total: factors.reduce((a, f) => a + f.points, 0), factors });
  }
  return ranked.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}
