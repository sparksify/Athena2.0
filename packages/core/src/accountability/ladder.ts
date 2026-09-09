import type { NudgeKind } from "@athena/db/schema";

const H = 3_600_000;

/** Steve, 2026-09-01: nudge +1h → +4h → manager +24h → take-back at 48h. */
export const NUDGE_LADDER: { kind: NudgeKind; afterMs: number; toManager: boolean }[] = [
  { kind: "plus_1h", afterMs: 1 * H, toManager: false },
  { kind: "plus_4h", afterMs: 4 * H, toManager: false },
  { kind: "plus_24h_manager", afterMs: 24 * H, toManager: true },
];
export const TAKE_BACK_AFTER_MS = 48 * H;

export type NudgeSubject = "first_touch" | "disposition";

export function nudgeText(kind: NudgeKind, subject: NudgeSubject, p: { consultantFirst: string; candidateName: string; hours: number }): string {
  const who = p.candidateName;
  if (subject === "first_touch") {
    if (kind === "plus_24h_manager") return `Heads up: ${p.consultantFirst} has not contacted ${who} ${p.hours}h after assignment. Take-back at 48h.`;
    return `${p.consultantFirst}, ${who} was assigned to you ${p.hours}h ago and has no first contact logged. Reply 1 once you've reached out.`;
  }
  if (kind === "plus_24h_manager") return `Heads up: no disposition from ${p.consultantFirst} ${p.hours}h after the ${who} consult.`;
  return `${p.consultantFirst}, how did the ${who} consult go? Reply 1 showed & advancing, 2 showed but not a fit, 3 no-show, 4 rescheduled.`;
}
