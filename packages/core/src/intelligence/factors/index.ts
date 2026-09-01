import type { ScoringFactor } from "../types";
import { contactability } from "./contactability";
import { cqCompletion } from "./cq-completion";
import { financialBand } from "./financial-band";
import { geography } from "./geography";
import { interestKnown } from "./interest-known";
import { priorAppointment } from "./prior-appointment";
import { priorEngagement } from "./prior-engagement";
import { priorOptOut } from "./prior-opt-out";
import { recency } from "./recency";
import { showNoShow } from "./show-no-show";
import { sourceQuality } from "./source-quality";

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
