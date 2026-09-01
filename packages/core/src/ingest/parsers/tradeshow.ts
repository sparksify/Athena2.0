import { normalizeEmail, normalizeName, normalizePhone, normalizeState } from "../normalize.js";
import type { SourceParser } from "../types.js";

/**
 * Trade-show badge scans / attendee lists. Typical columns: Attendee,
 * Email Address, Cell, City, State, Show, Booth Notes.
 */
export const parseTradeshow: SourceParser = (row) => {
  const s = (k: string) => {
    const v = row[k] ?? row[k.toLowerCase()];
    return typeof v === "string" ? v : v == null ? null : String(v);
  };
  return {
    sourceType: "tradeshow",
    fullName: normalizeName(s("Attendee") ?? s("Name") ?? s("Full Name")),
    email: normalizeEmail(s("Email Address") ?? s("Email")),
    phone: normalizePhone(s("Cell") ?? s("Phone")),
    city: normalizeName(s("City")),
    state: normalizeState(s("State")),
    raw: row,
  };
};
