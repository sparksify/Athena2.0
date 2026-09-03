/** The 13 reply classes from the brief, plus `ambiguous` as the safe fallback. */
export const REPLY_CLASSES = [
  "positive",
  "interested",
  "maybe_later",
  "needs_info",
  "asks_what_this_is",
  "asks_about_brand",
  "asks_about_investment",
  "wrong_person",
  "not_interested",
  "unsubscribe",
  "hostile",
  "already_owns_franchise",
  "already_with_consultant",
] as const;
export type ReplyClass = (typeof REPLY_CLASSES)[number];
export type Classification = ReplyClass | "ambiguous";
export const ALL_CLASSIFICATIONS: readonly Classification[] = [...REPLY_CLASSES, "ambiguous"];

export const CLASS_DESCRIPTIONS: Record<Classification, string> = {
  positive: "clearly wants to move forward, book a call, or talk to someone",
  interested: "curious and open; asking to learn more without committing",
  maybe_later: "not now — timing, life circumstances, revisit in the future",
  needs_info: "asks a factual question we can answer from our facts (process, next steps, what we do)",
  asks_what_this_is: "confused about who we are or why they were contacted",
  asks_about_brand: "asks about a specific franchise brand or concept",
  asks_about_investment: "asks about cost, investment level, financing, or returns",
  wrong_person: "says we have the wrong person or wrong contact details",
  not_interested: "polite or plain decline; no future interest signalled",
  unsubscribe: "asks to be removed, stop emailing, opt out",
  hostile: "angry, threatening, or abusive",
  already_owns_franchise: "already owns a franchise or business",
  already_with_consultant: "already working with another consultant or broker",
  ambiguous: "cannot be placed confidently in any class",
};

/** The only classes Athena may answer without a human, and only at or above the threshold. */
export const AUTO_REPLY_CLASSES: readonly Classification[] = ["asks_what_this_is", "needs_info"];
export const AUTO_REPLY_THRESHOLD = 0.9;

/** Classes that close the conversation automatically when confident. */
export const AUTO_CLOSE_CLASSES: readonly Classification[] = ["not_interested", "unsubscribe"];

/** Classes that need a human but are not urgent (queue, unflagged). */
export const LOW_URGENCY_CLASSES: readonly Classification[] = ["maybe_later", "already_owns_franchise"];

export function isAutoReplyEligible(classification: string | null, confidence: number | null): boolean {
  return (
    classification !== null &&
    confidence !== null &&
    AUTO_REPLY_CLASSES.includes(classification as Classification) &&
    confidence >= AUTO_REPLY_THRESHOLD
  );
}
