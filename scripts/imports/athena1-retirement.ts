// One-time Athena 1.0 retirement import (Phase 5). Never an integration:
// 1.0 is retired by loading its history, then turning it off.
//
//   pnpm --dir scripts exec tsx imports/athena1-retirement.ts <contacted.csv> [--dry-run]
//
// Expected columns (case-insensitive, extras preserved in raw payload):
//   email (required) · name/full_name · phone · first_contacted_at ·
//   last_contacted_at · emails_sent
//
// Effects, all idempotent (safe to re-run):
//   - suppression: every contacted email, channel=email, source=athena1
//     → Athena 2.0 can NEVER cold-email anyone 1.0 already contacted
//   - source_record: one per row (content-hash deduped), source_type=athena1
//   - interaction: import_history rows carrying the contact dates
// Requires DATABASE_URL.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@athena/db";
import { identifier, interaction, sourceRecord } from "@athena/db/schema";
import { addSuppression, normalizeEmail, parseCsv } from "@athena/core";

const DEFAULT_ORG = "00000000-0000-0000-0000-000000000001";

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  if (!file) {
    console.error("usage: tsx imports/athena1-retirement.ts <contacted.csv> [--dry-run]");
    process.exit(1);
  }
  const orgId = process.env.ATHENA_ORG_ID ?? DEFAULT_ORG;
  const rows = parseCsv(readFileSync(file, "utf8"));
  console.log(`${rows.length} rows in ${file}`);

  const get = (row: Record<string, string>, ...keys: string[]) => {
    for (const k of keys) {
      const hit = Object.keys(row).find((c) => c.toLowerCase() === k);
      if (hit && row[hit]) return row[hit]!;
    }
    return undefined;
  };

  let suppressed = 0;
  let alreadySuppressed = 0;
  let records = 0;
  let duplicates = 0;
  let noEmail = 0;

  const db = getDb();
  for (const row of rows) {
    const email = normalizeEmail(get(row, "email", "email_address") ?? "");
    if (!email) {
      noEmail++;
      continue;
    }
    if (dryRun) {
      suppressed++;
      continue;
    }
    const contentHash = createHash("sha256").update(`athena1:${JSON.stringify(row)}`).digest("hex");

    await db.transaction(async (tx) => {
      const supId = await addSuppression(tx, {
        orgId,
        channel: "email",
        identifier: email,
        reason: "contacted by Athena 1.0",
        source: "athena1",
      });
      if (supId) suppressed++;
      else alreadySuppressed++;

      const inserted = await tx
        .insert(sourceRecord)
        .values({ orgId, sourceType: "athena1", contentHash, payload: row })
        .onConflictDoNothing()
        .returning({ id: sourceRecord.id });
      const src = inserted[0];
      if (!src) {
        duplicates++;
        return;
      }
      records++;

      // History onto an existing candidate's timeline when we know them.
      const [ident] = await tx
        .select({ candidateId: identifier.candidateId })
        .from(identifier)
        .where(
          and(
            eq(identifier.orgId, orgId),
            eq(identifier.type, "email"),
            eq(identifier.valueNormalized, email),
          ),
        )
        .limit(1);
      const last = get(row, "last_contacted_at", "last_contacted", "last_email_at");
      if (ident?.candidateId && last && !Number.isNaN(Date.parse(last))) {
        await tx.insert(interaction).values({
          orgId,
          candidateId: ident.candidateId,
          type: "import_history",
          direction: "outbound",
          occurredAt: new Date(last),
          payload: { source: "athena1", emailsSent: get(row, "emails_sent") },
          sourceRecordId: src.id,
        });
      }
    });
  }

  console.log(
    JSON.stringify(
      { dryRun, suppressed, alreadySuppressed, sourceRecords: records, duplicates, noEmail },
      null,
      2,
    ),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
