/**
 * Every kind of file an operator can upload. One row here = one parser file
 * in ./parsers and one weight in the source_quality factor. Add a type by
 * adding a row and a parser; nothing else changes.
 */
export const SOURCE_TYPES = [
  { value: "cq", label: "CQ completers (questionnaire)", quality: 7, hint: "People who filled out the confidential questionnaire" },
  { value: "referral", label: "Referral", quality: 7, hint: "Referred by a client, franchisor, or partner" },
  { value: "web_inquiry", label: "Fresh lead / web inquiry", quality: 6, hint: "Recent inbound inquiries from the site, ads, or forms" },
  { value: "consultant_handback", label: "Consultant hand-back", quality: 5, hint: "Leads a consultant worked and handed back; put the consultant's name in the label" },
  { value: "tradeshow", label: "Trade show", quality: 5, hint: "Badge scans and attendee lists; put the show and city in the label" },
  { value: "resume", label: "Resume / job board", quality: 4, hint: "Job-board and resume exports" },
  { value: "athena1", label: "Athena 1.0 export", quality: 3, hint: "History from the old system (use the retirement import for the contacted list)" },
  { value: "purchased", label: "Purchased list", quality: 2, hint: "Bought data; lowest trust" },
  { value: "bulk", label: "Bulk / other", quality: 3, hint: "Anything else; say what it is in the label" },
] as const;

export type SourceTypeValue = (typeof SOURCE_TYPES)[number]["value"];

export const SOURCE_QUALITY: Record<string, number> = Object.fromEntries(SOURCE_TYPES.map((s) => [s.value, s.quality]));

export function sourceTypeLabel(value: string): string {
  return SOURCE_TYPES.find((s) => s.value === value)?.label ?? value;
}
