import { createHash } from "node:crypto";

/** Lowercase, trim, strip mailto: and display-name wrappers. Returns null if not an email. */
export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  let v = input.trim().toLowerCase();
  const angle = v.match(/<([^>]+)>/);
  if (angle?.[1]) v = angle[1].trim();
  v = v.replace(/^mailto:/, "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return null;
  return v;
}

/** E.164-ish for US/CA numbers; returns null if fewer than 10 digits. */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 11) return `+${digits}`;
  return null;
}

/** Collapse whitespace, strip stray punctuation, title-case fully upper/lower names. */
export function normalizeName(input: string | null | undefined): string | null {
  if (!input) return null;
  let v = input.replace(/\s+/g, " ").replace(/^[\s,.-]+|[\s,.-]+$/g, "").trim();
  if (!v) return null;
  if (v === v.toUpperCase() || v === v.toLowerCase()) {
    v = v
      .toLowerCase()
      .split(" ")
      .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
      .join(" ");
  }
  return v;
}

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA",
  michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};

/** Two-letter state code, or null. Accepts full names and codes. */
export function normalizeState(input: string | null | undefined): string | null {
  if (!input) return null;
  const v = input.trim();
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return STATE_NAMES[v.toLowerCase()] ?? null;
}

/**
 * Deterministic content hash for source_record dedupe: sorted keys, trimmed
 * string values, prefixed with the source type so identical rows from two
 * sources stay distinct records.
 */
export function contentHash(sourceType: string, raw: Record<string, unknown>): string {
  const canonical = Object.keys(raw)
    .sort()
    .map((k) => {
      const v = raw[k];
      return `${k}=${typeof v === "string" ? v.trim() : JSON.stringify(v)}`;
    })
    .join("\n");
  return createHash("sha256").update(`${sourceType}\n${canonical}`).digest("hex");
}
