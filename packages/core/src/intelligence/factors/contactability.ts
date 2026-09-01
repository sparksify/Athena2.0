import type { ScoringFactor } from "../types";

/** Can we actually reach them? Max 10. Reads verification results, never guesses. */
export const contactability: ScoringFactor = (ctx) => {
  if (ctx.emailVerification === "valid") {
    return { factor: "contactability", points: 10, reason: "verified valid email" };
  }
  if (ctx.emailVerification === "risky") {
    return { factor: "contactability", points: 4, reason: "risky email (catch-all/disposable)" };
  }
  if (ctx.emailVerification === "invalid") {
    return ctx.hasPhone
      ? { factor: "contactability", points: 5, reason: "email invalid; phone on record" }
      : { factor: "contactability", points: 0, reason: "email invalid, no phone" };
  }
  if (ctx.hasEmail) {
    return { factor: "contactability", points: 2, reason: "email unverified" };
  }
  return ctx.hasPhone
    ? { factor: "contactability", points: 5, reason: "phone only" }
    : { factor: "contactability", points: 0, reason: "no usable contact info" };
};
