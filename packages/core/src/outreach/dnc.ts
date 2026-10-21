import type { EmitTx } from "../events/emit";
import { parseCsv } from "../ingest/csv";
import { normalizeEmail, normalizePhone } from "../ingest/normalize";
import { addSuppression } from "./suppress";

export interface DncImportSummary { rows: number; emails: number; phones: number; added: number; alreadySuppressed: number }

/**
 * A do-not-contact list: any CSV or plain text. Every cell is scanned for
 * an email address or a phone number, so the file needs no particular
 * columns and no header. Each address lands in suppression for its
 * channel (email → email, phone → sms) in one transaction, with an event
 * per row, and is refused by the send gate from the moment it commits.
 */
export function extractContacts(text: string): { emails: string[]; phones: string[] } {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const cells: string[] = [];
  const looksTabular = text.includes(",") || text.includes("\t");
  if (looksTabular) {
    for (const row of parseCsv(text)) for (const v of Object.values(row)) cells.push(v);
    for (const h of Object.keys(parseCsv(text)[0] ?? {})) cells.push(h); // a header-less file keeps its first row as "headers"
  } else {
    cells.push(...text.split(/\r?\n/));
  }
  for (const raw of cells) {
    const cell = raw.trim();
    if (!cell) continue;
    const e = normalizeEmail(cell) ?? normalizeEmail(cell.match(/[^\s,;<>"']+@[^\s,;<>"']+\.[a-z]{2,}/i)?.[0]);
    if (e) { emails.add(e); continue; }
    if ((cell.match(/\d/g) ?? []).length >= 10 && /^[\d\s()+.-]+$/.test(cell)) {
      const p = normalizePhone(cell);
      if (p) phones.add(p);
    }
  }
  return { emails: [...emails], phones: [...phones] };
}

export async function importDoNotContact(db: EmitTx, args: { orgId: string; text: string; reason: string; source?: string; correlationId?: string }): Promise<DncImportSummary> {
  const { emails, phones } = extractContacts(args.text);
  const rows = args.text.split(/\r?\n/).filter((l) => l.trim()).length;
  let added = 0;
  await db.transaction(async (tx) => {
    for (const identifier of emails) {
      if (await addSuppression(tx, { orgId: args.orgId, channel: "email", identifier, reason: args.reason, source: args.source ?? "dnc_upload", correlationId: args.correlationId })) added++;
    }
    for (const identifier of phones) {
      if (await addSuppression(tx, { orgId: args.orgId, channel: "sms", identifier, reason: args.reason, source: args.source ?? "dnc_upload", correlationId: args.correlationId })) added++;
    }
  });
  return { rows, emails: emails.length, phones: phones.length, added, alreadySuppressed: emails.length + phones.length - added };
}
