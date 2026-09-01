import { normalizeEmail, normalizeName, normalizePhone, normalizeState } from "../normalize.js";
import type { SourceParser } from "../types.js";

/**
 * Resume / job-board exports. Typical columns: Name or First/Last, Email,
 * Phone, City, State, Current Title, Company.
 */
export const parseResume: SourceParser = (row) => {
  const s = (k: string) => {
    const v = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()];
    return typeof v === "string" ? v : v == null ? null : String(v);
  };
  const name =
    s("Name") ??
    [s("First Name") ?? s("first_name"), s("Last Name") ?? s("last_name")]
      .filter(Boolean)
      .join(" ") ??
    null;
  return {
    sourceType: "resume",
    fullName: normalizeName(name),
    email: normalizeEmail(s("Email") ?? s("email_address")),
    phone: normalizePhone(s("Phone") ?? s("phone_number") ?? s("Mobile")),
    city: normalizeName(s("City")),
    state: normalizeState(s("State")),
    raw: row,
  };
};
