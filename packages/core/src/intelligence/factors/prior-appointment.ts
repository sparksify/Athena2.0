import type { ScoringFactor } from "../types";

/** Ever got as far as a scheduled meeting with a consultant. Max 8. */
export const priorAppointment: ScoringFactor = (ctx) => {
  const meetings = ctx.interactions.filter((i) => i.type === "meeting").length;
  if (meetings > 0) {
    return { factor: "prior_appointment", points: 8, reason: `${meetings} prior appointment(s)` };
  }
  return { factor: "prior_appointment", points: 0, reason: "no prior appointments" };
};
