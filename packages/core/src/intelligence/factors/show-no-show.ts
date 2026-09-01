import type { ScoringFactor } from "../types.js";

/** Did they show for appointments they booked? ±5. Reads meeting payload.outcome. */
export const showNoShow: ScoringFactor = (ctx) => {
  const outcomes = ctx.interactions
    .filter((i) => i.type === "meeting")
    .map((i) => String(i.payload["outcome"] ?? ""));
  const showed = outcomes.filter((o) => o === "showed").length;
  const noShow = outcomes.filter((o) => o === "no_show").length;
  if (showed > 0 && noShow === 0) return { factor: "show_no_show", points: 5, reason: `showed for ${showed} appointment(s)` };
  if (noShow > 0 && showed === 0) return { factor: "show_no_show", points: -5, reason: `no-showed ${noShow} appointment(s)` };
  if (showed > 0 && noShow > 0) return { factor: "show_no_show", points: 0, reason: `mixed record: ${showed} showed, ${noShow} no-show` };
  return { factor: "show_no_show", points: 0, reason: "no appointment outcomes on record" };
};
