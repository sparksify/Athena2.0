import { normalizeEmail, normalizeName, normalizePhone, normalizeState } from "../normalize";
import type { SourceParser } from "../types";

/**
 * Purchased list vendors. Typical columns: first_name, last_name, email,
 * phone, city, state, plus arbitrary vendor fields kept in raw.
 */
export const parsePurchased: SourceParser = (row) => {
  const s = (k: string) => {
    const v = row[k] ?? row[k.toUpperCase()];
    return typeof v === "string" ? v : v == null ? null : String(v);
  };
  const name =
    s("full_name") ??
    [s("first_name"), s("last_name")].filter(Boolean).join(" ") ??
    null;
  return {
    sourceType: "purchased",
    fullName: normalizeName(name),
    email: normalizeEmail(s("email")),
    phone: normalizePhone(s("phone")),
    city: normalizeName(s("city")),
    state: normalizeState(s("state")),
    raw: row,
  };
};
