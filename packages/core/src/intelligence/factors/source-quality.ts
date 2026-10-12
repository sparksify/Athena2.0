import { SOURCE_QUALITY } from "../../ingest/source-types";
import type { ScoringFactor } from "../types";

const QUALITY: Record<string, number> = { ...SOURCE_QUALITY, website: 5, facebook: 4 };

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
