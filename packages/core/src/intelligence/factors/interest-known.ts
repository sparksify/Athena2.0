import type { ScoringFactor } from "../types";

const INTEREST_KEYS = ["franchise_interest", "industries_considered", "brands_presented"];

/** Do we know what they were actually interested in? Max 8. */
export const interestKnown: ScoringFactor = (ctx) => {
  const known = INTEREST_KEYS.filter((k) => ctx.attributes[k] != null);
  if (known.length > 0) {
    return { factor: "interest_known", points: 8, reason: `interest on record: ${known.join(", ")}` };
  }
  return { factor: "interest_known", points: 0, reason: "no recorded franchise interest" };
};
