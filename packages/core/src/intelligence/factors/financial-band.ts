import type { ScoringFactor } from "../types";

/** Known liquidity band. Max 15. Unknown scores 0 with an honest reason. */
export const financialBand: ScoringFactor = (ctx) => {
  const l = ctx.liquidityUsd;
  if (l == null) return { factor: "financial_band", points: 0, reason: "liquidity unknown" };
  if (l >= 250_000) return { factor: "financial_band", points: 15, reason: `liquidity ~$${Math.round(l / 1000)}k (≥$250k)` };
  if (l >= 100_000) return { factor: "financial_band", points: 10, reason: `liquidity ~$${Math.round(l / 1000)}k (≥$100k)` };
  if (l >= 50_000) return { factor: "financial_band", points: 5, reason: `liquidity ~$${Math.round(l / 1000)}k (≥$50k)` };
  return { factor: "financial_band", points: 0, reason: `liquidity ~$${Math.round(l / 1000)}k (<$50k)` };
};
