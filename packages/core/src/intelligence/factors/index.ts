import type { ScoringFactor } from "../types.js";
import { contactability } from "./contactability.js";
import { cqCompletion } from "./cq-completion.js";
import { financialBand } from "./financial-band.js";
import { geography } from "./geography.js";
import { interestKnown } from "./interest-known.js";
import { priorAppointment } from "./prior-appointment.js";
import { priorEngagement } from "./prior-engagement.js";
import { priorOptOut } from "./prior-opt-out.js";
import { recency } from "./recency.js";
import { showNoShow } from "./show-no-show.js";
import { sourceQuality } from "./source-quality.js";

/** Evaluation order is presentation order in the explanation table. */
export const FACTORS: ScoringFactor[] = [
  recency,
  priorEngagement,
  cqCompletion,
  financialBand,
  priorAppointment,
  showNoShow,
  interestKnown,
  geography,
  contactability,
  priorOptOut,
  sourceQuality,
];
