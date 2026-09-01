import type { ScoringFactor } from "../types.js";

const QUALITY: Record<string, number> = {
  referral: 7,
  cq: 7,
  website: 5,
  tradeshow: 5,
  facebook: 4,
  resume: 4,
  purchased: 2,
};

/** Where the record came from predicts its quality. Max 7; best source wins. */
export const sourceQuality: ScoringFactor = (ctx) => {
  if (ctx.sourceTypes.length === 0) {
    return { factor: "source_quality", points: 0, reason: "no source records" };
  }
  const best = ctx.sourceTypes.reduce(
    (acc, t) => ((QUALITY[t] ?? 3) > acc.points ? { type: t, points: QUALITY[t] ?? 3 } : acc),
    { type: ctx.sourceTypes[0]!, points: QUALITY[ctx.sourceTypes[0]!] ?? 3 },
  );
  return { factor: "source_quality", points: best.points, reason: `best source: ${best.type}` };
};
