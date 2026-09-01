// Import a source file into Athena.
//
//   pnpm run import scripts/imports/inbox/pilot.csv --source resume
//
// Reads the CSV with DuckDB (fast, tolerant of large files), runs the source
// parser, and writes source records / candidates / identifiers through
// @athena/core importFile. Requires DATABASE_URL. Prints the stored batch
// report. If MILLIONVERIFIER_API_KEY is set, drains queued verification jobs
// afterwards.
import { DuckDBInstance } from "@duckdb/node-api";
import { getDb } from "@athena/db";
import {
  batchReport,
  importFile,
  pendingVerificationJobs,
  PARSERS,
} from "@athena/core";
import { runVerificationJob } from "@athena/core";
import { MillionVerifierProvider } from "@athena/verify-millionverifier";

const DEFAULT_ORG = "00000000-0000-0000-0000-000000000001";

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const source = args[args.indexOf("--source") + 1];
  const orgId = args.includes("--org") ? args[args.indexOf("--org") + 1]! : DEFAULT_ORG;
  if (!file || !source || !PARSERS[source]) {
    console.error(`usage: pnpm run import <file.csv> --source <${Object.keys(PARSERS).join("|")}> [--org <uuid>]`);
    process.exit(1);
  }

  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  const reader = await conn.runAndReadAll(
    `select * from read_csv_auto('${file.replace(/'/g, "''")}', all_varchar=true)`,
  );
  const rows = reader.getRowObjects() as Record<string, unknown>[];
  console.log(`read ${rows.length} rows from ${file}`);

  if (args.includes("--dry-run")) {
    const parser = PARSERS[source]!;
    let emails = 0, phones = 0, missing = 0, errors = 0;
    for (const row of rows) {
      try {
        const p = parser(row);
        if (p.email) emails += 1;
        if (p.phone) phones += 1;
        if (!p.email && !p.phone) missing += 1;
      } catch {
        errors += 1;
      }
    }
    console.log(JSON.stringify({ dryRun: true, rows: rows.length, emails, phones, missingCriticalFields: missing, parserErrors: errors }, null, 2));
    process.exit(0);
  }

  const db = getDb();
  const { batchId } = await importFile(db, {
    orgId,
    sourceType: source,
    filename: file.split("/").pop()!,
    rows,
  });

  if (process.env.MILLIONVERIFIER_API_KEY) {
    const verifier = new MillionVerifierProvider();
    const jobs = await pendingVerificationJobs(db, orgId);
    console.log(`verifying ${jobs.length} new addresses…`);
    for (const job of jobs) {
      const p = job.payload as { identifierId: string; email: string };
      await runVerificationJob(db, verifier, {
        id: job.id, orgId, identifierId: p.identifierId, email: p.email,
      });
    }
  } else {
    console.log("MILLIONVERIFIER_API_KEY not set — verification jobs left queued");
  }

  console.log(JSON.stringify(await batchReport(db, orgId, batchId), null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
