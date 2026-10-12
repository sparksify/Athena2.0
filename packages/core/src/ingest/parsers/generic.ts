import { normalizeEmail, normalizeName, normalizePhone, normalizeState } from "../normalize";
import type { ParsedRecord, SourceParser } from "../types";

const pick = (row: Record<string, unknown>, keys: string[]): string | null => {
  const lower = new Map(Object.keys(row).map((k) => [k.toLowerCase().replace(/[\s_-]+/g, ""), k]));
  for (const k of keys) {
    const real = lower.get(k.toLowerCase().replace(/[\s_-]+/g, ""));
    const v = real == null ? undefined : row[real];
    if (v != null && String(v).trim() !== "") return String(v);
  }
  return null;
};

/**
 * Column-tolerant parser shared by the simpler source types: finds the
 * name, email, phone, city and state under the usual headings and keeps
 * everything else in raw. Each source type still gets its own file so a
 * type can grow its own rules without touching the others.
 */
export function genericParser(sourceType: string): SourceParser {
  return (row): ParsedRecord => {
    const first = pick(row, ["first name", "firstname", "first"]);
    const last = pick(row, ["last name", "lastname", "last"]);
    const name = pick(row, ["name", "full name", "fullname", "contact", "contact name", "attendee", "lead name"]) ?? [first, last].filter(Boolean).join(" ") ?? null;
    return {
      sourceType,
      fullName: normalizeName(name || null),
      email: normalizeEmail(pick(row, ["email", "email address", "e-mail", "emailaddress", "primary email"])),
      phone: normalizePhone(pick(row, ["phone", "mobile", "cell", "phone number", "mobile phone", "primary phone", "telephone"])),
      city: normalizeName(pick(row, ["city", "town"])),
      state: normalizeState(pick(row, ["state", "st", "region", "province"])),
      raw: row,
    };
  };
}
