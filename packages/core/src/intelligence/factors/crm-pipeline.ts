import type { ScoringFactor } from "../types";

const ADVANCED = /cq received|talking to zors|d-day|contract|discovery|territory|application|presented/i;
const EARLY = /lead in|contact made|cq sent|new|qualif/i;

/**
 * Where the CRM already has them in the pipeline. Someone mid-funnel who
 * went quiet is worth more than a cold name; a lost or abandoned deal is
 * worth a little less than nothing known; a won deal already owns a
 * franchise and is not a reactivation target. Max 10.
 */
export const crmPipeline: ScoringFactor = (ctx) => {
  const status = String(ctx.attributes.crm_opportunity_status ?? "").toLowerCase();
  const stage = String(ctx.attributes.crm_stage ?? "");
  if (!status && !stage && ctx.attributes.crm_contact_id == null) {
    return { factor: "crm_pipeline", points: 0, reason: "not in the CRM" };
  }
  if (status === "won") return { factor: "crm_pipeline", points: -10, reason: "closed/funded in the CRM — already a franchisee" };
  if (status === "lost" || status === "abandoned") return { factor: "crm_pipeline", points: -3, reason: `${status} opportunity in the CRM${stage ? ` (${stage})` : ""}` };
  if (status === "open" && ADVANCED.test(stage)) return { factor: "crm_pipeline", points: 10, reason: `open opportunity at ${stage}` };
  if (status === "open" && EARLY.test(stage)) return { factor: "crm_pipeline", points: 5, reason: `open opportunity at ${stage}` };
  if (status === "open") return { factor: "crm_pipeline", points: 5, reason: `open opportunity${stage ? ` at ${stage}` : ""}` };
  return { factor: "crm_pipeline", points: 2, reason: "known CRM contact, no opportunity" };
};
