/**
 * Demo seed: runs 20 clearly-fake records (all @example.com, 555-01xx phones)
 * through the REAL pipeline — importFile, deterministic identity, service-path
 * enrichment facts, scoreCandidates — on an in-memory Postgres, then dumps the
 * resulting rows as idempotent INSERT ... ON CONFLICT DO NOTHING statements
 * for replay into the live database.
 *
 *   pnpm exec tsx scripts/demo/seed-demo.ts > /tmp/demo-seed.sql
 *
 * Removal: every row traces to import batches whose filenames start with
 * 'demo-'; candidates are the ones whose primary_email ends in @example.com.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { schema } from "@athena/db";
import { importFile, scoreCandidates } from "@athena/core";
import { eq } from "drizzle-orm";

const ORG = "00000000-0000-0000-0000-000000000001"; // live default org

const resumeRows = [
  { Name: "MARCUS WEBB", Email: "marcus.webb@example.com", Phone: "(214) 555-0101", City: "Plano", State: "Texas" },
  { Name: "Dana Kowalski", Email: "dana.kowalski@example.com", Phone: "214-555-0102", City: "Dallas", State: "TX" },
  { Name: "Felix Arroyo", Email: "felix.arroyo@example.com", Phone: "1-469-555-0103", City: "Frisco", State: "TX" },
  { Name: "Ingrid Halvorsen", Email: "ingrid.halvorsen@example.com", Phone: "", City: "Tulsa", State: "OK" },
  { Name: "Terrence Boyd", Email: "terrence.boyd@example.com", Phone: "918-555-0105", City: "Tulsa", State: "Oklahoma" },
  { Name: "Yuki Tanaka-Reyes", Email: "yuki.tr@example.com", Phone: "305-555-0106", City: "Miami", State: "FL" },
  { Name: "Colin Fitzgerald", Email: "colin.fitz@example.com", Phone: "", City: "Tampa", State: "FL" },
  { Name: "Priya Raman", Email: "priya.raman@example.com", Phone: "480-555-0108", City: "Phoenix", State: "AZ" },
];

const tradeshowRows = [
  // same human as resume row 1 (exact email) — shows deterministic matching
  { Attendee: "Marc Webb", "Email Address": "MARCUS.WEBB@EXAMPLE.COM", Cell: "", City: "Plano", State: "TX", Show: "IFA 2026" },
  { Attendee: "Sofia Delgado", "Email Address": "sofia.delgado@example.com", Cell: "702-555-0110", City: "Las Vegas", State: "NV", Show: "IFA 2026" },
  { Attendee: "Hank Okafor", "Email Address": "hank.okafor@example.com", Cell: "404-555-0111", City: "Atlanta", State: "GA", Show: "IFA 2026" },
  { Attendee: "Beatrice Lindqvist", "Email Address": "bea.lindqvist@example.com", Cell: "", City: "Scottsdale", State: "AZ", Show: "MBE" },
  { Attendee: "Omar Haddad", "Email Address": "omar.haddad@example.com", Cell: "313-555-0113", City: "Detroit", State: "MI", Show: "MBE" },
  { Attendee: "Ruthie Calloway", "Email Address": "ruthie.calloway@example.com", Cell: "615-555-0114", City: "Nashville", State: "TN", Show: "IFA 2026" },
  { Attendee: "Gustav Meier", "Email Address": "gustav.meier@example.com", Cell: "512-555-0115", City: "Austin", State: "TX", Show: "IFA 2026" },
];

const purchasedRows = [
  // same human as resume row 5 (exact phone, no email) — phone matching
  { first_name: "Terry", last_name: "Boyd", email: "", phone: "9185550105", city: "Tulsa", state: "OK" },
  { first_name: "Alma", last_name: "Quintero", email: "alma.quintero@example.com", phone: "5055550117", city: "Albuquerque", state: "NM" },
  { first_name: "Desmond", last_name: "Pike", email: "desmond.pike@example.com", phone: "", city: "Denver", state: "CO" },
  { first_name: "Lucia", last_name: "Ferrante", email: "lucia.ferrante@example.com", phone: "7205550119", city: "Boulder", state: "CO" },
  { first_name: "Walt", last_name: "Iverson", email: "walt.iverson@example.com", phone: "9525550120", city: "Minneapolis", state: "MN" },
  { first_name: "Nadia", last_name: "Cheng", email: "nadia.cheng@example.com", phone: "2065550121", city: "Seattle", state: "WA" },
  { first_name: "Roscoe", last_name: "Vann", email: "roscoe.vann@example.com", phone: "", city: "Memphis", state: "TN" },
];

function lit(v: unknown): string {
  if (v == null) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function main() {
  const client = new PGlite();
  await client.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable as 'select null::uuid';
    create role authenticated; create role service_role;
  `);
  const dbPkg = resolve(import.meta.dirname, "../../packages/db");
  const files = ["migrations", "policies"]
    .flatMap((dir) =>
      readdirSync(resolve(dbPkg, dir))
        .filter((f) => f.endsWith(".sql"))
        .map((f) => ({ name: f, path: resolve(dbPkg, dir, f) })),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const f of files) await client.exec(readFileSync(f.path, "utf8"));

  const db = drizzle(client, { schema });
  await db.insert(schema.org).values({ id: ORG, name: "FranChoice" });

  // 1. The real import pipeline, three source files
  await importFile(db, { orgId: ORG, sourceType: "resume", filename: "demo-resumes.csv", rows: resumeRows });
  await importFile(db, { orgId: ORG, sourceType: "tradeshow", filename: "demo-tradeshow.csv", rows: tradeshowRows });
  await importFile(db, { orgId: ORG, sourceType: "purchased", filename: "demo-purchased.csv", rows: purchasedRows });

  const byEmail = async (email: string) => {
    const [c] = await db.select().from(schema.candidate).where(eq(schema.candidate.primaryEmail, email));
    if (!c) throw new Error(`no candidate ${email}`);
    return c;
  };
  const linkOf = async (candidateId: string) => {
    const [l] = await db
      .select()
      .from(schema.candidateSourceLink)
      .where(eq(schema.candidateSourceLink.candidateId, candidateId));
    return l!.sourceRecordId;
  };
  const identOf = async (candidateId: string, type: "email" | "phone") => {
    const rows = await db.select().from(schema.identifier).where(eq(schema.identifier.candidateId, candidateId));
    return rows.find((r) => r.type === type)!;
  };

  // 2. Service-path history facts for a spread of scores (varied dates/outcomes)
  const marcus = await byEmail("marcus.webb@example.com");
  const dana = await byEmail("dana.kowalski@example.com");
  const sofia = await byEmail("sofia.delgado@example.com");
  const hank = await byEmail("hank.okafor@example.com");
  const priya = await byEmail("priya.raman@example.com");
  const omar = await byEmail("omar.haddad@example.com");
  const walt = await byEmail("walt.iverson@example.com");
  const lucia = await byEmail("lucia.ferrante@example.com");

  const day = 86_400_000;
  const ago = (d: number) => new Date(Date.now() - d * day);

  // Marcus: the 90+ candidate — CQ, money, showed meeting, known interest, recent
  await db.insert(schema.questionnaire).values([
    { orgId: ORG, candidateId: marcus.id, kind: "cq_complete", completedAt: ago(120), sourceRecordId: await linkOf(marcus.id) },
    { orgId: ORG, candidateId: sofia.id, kind: "cq_complete", completedAt: ago(400), sourceRecordId: await linkOf(sofia.id) },
    { orgId: ORG, candidateId: dana.id, kind: "cq_partial", completedAt: null, sourceRecordId: await linkOf(dana.id) },
  ]);
  await db.insert(schema.financialProfile).values([
    { orgId: ORG, candidateId: marcus.id, liquidityUsd: "280000", netWorthUsd: "900000", sourceRecordId: await linkOf(marcus.id) },
    { orgId: ORG, candidateId: sofia.id, liquidityUsd: "150000", netWorthUsd: "520000", sourceRecordId: await linkOf(sofia.id) },
    { orgId: ORG, candidateId: hank.id, liquidityUsd: "60000", netWorthUsd: "310000", sourceRecordId: await linkOf(hank.id) },
    { orgId: ORG, candidateId: priya.id, liquidityUsd: "320000", netWorthUsd: "1200000", sourceRecordId: await linkOf(priya.id) },
  ]);
  await db.insert(schema.interaction).values([
    { orgId: ORG, candidateId: marcus.id, type: "email_sent", direction: "outbound", occurredAt: ago(130), sourceRecordId: await linkOf(marcus.id) },
    { orgId: ORG, candidateId: marcus.id, type: "email_reply", direction: "inbound", occurredAt: ago(125), sourceRecordId: await linkOf(marcus.id) },
    { orgId: ORG, candidateId: marcus.id, type: "meeting", direction: "inbound", occurredAt: ago(110), payload: { outcome: "showed" }, sourceRecordId: await linkOf(marcus.id) },
    { orgId: ORG, candidateId: sofia.id, type: "meeting", direction: "inbound", occurredAt: ago(420), payload: { outcome: "no_show" }, sourceRecordId: await linkOf(sofia.id) },
    { orgId: ORG, candidateId: dana.id, type: "email_sent", direction: "outbound", occurredAt: ago(300), sourceRecordId: await linkOf(dana.id) },
    { orgId: ORG, candidateId: hank.id, type: "call", direction: "inbound", occurredAt: ago(700), sourceRecordId: await linkOf(hank.id) },
    { orgId: ORG, candidateId: priya.id, type: "email_reply", direction: "inbound", occurredAt: ago(90), sourceRecordId: await linkOf(priya.id) },
  ]);
  await db.insert(schema.candidateAttribute).values([
    { orgId: ORG, candidateId: marcus.id, key: "franchise_interest", value: "home services", sourceRecordId: await linkOf(marcus.id) },
    { orgId: ORG, candidateId: priya.id, key: "franchise_interest", value: "health & wellness", sourceRecordId: await linkOf(priya.id) },
    { orgId: ORG, candidateId: sofia.id, key: "industries_considered", value: ["food", "fitness"], sourceRecordId: await linkOf(sofia.id) },
  ]);
  // demo verification results (provider 'demo-seed' — clearly not MillionVerifier)
  const verified: [string, "valid" | "risky" | "invalid"][] = [
    [marcus.id, "valid"], [dana.id, "valid"], [sofia.id, "valid"], [hank.id, "valid"],
    [priya.id, "valid"], [omar.id, "risky"], [walt.id, "invalid"],
  ];
  for (const [cid, result] of verified) {
    const ident = await identOf(cid, "email");
    await db.insert(schema.emailVerification).values({
      orgId: ORG, identifierId: ident.id, provider: "demo-seed", result, raw: { demo: true },
    });
  }
  // one opted-out candidate to demo the suppression floor
  await db.insert(schema.suppression).values({
    orgId: ORG, channel: "email", identifier: "lucia.ferrante@example.com",
    reason: "unsubscribed (demo)", source: "demo-seed",
  });
  void lucia;

  // 3. Real scoring
  await scoreCandidates(db, ORG);

  // 4. Dump everything (FK order), skipping org (exists live) and agent_job
  //    (queued verify jobs would sit stale without a runner)
  const tables = [
    "import_batch", "source_record", "candidate", "identifier",
    "candidate_source_link", "questionnaire", "financial_profile",
    "interaction", "candidate_attribute", "email_verification",
    "suppression", "score_snapshot", "event",
  ];
  const out: string[] = ["begin;"];
  for (const t of tables) {
    const res = await client.query<Record<string, unknown>>(`select * from "${t}" where org_id = '${ORG}'`);
    if (res.rows.length === 0) continue;
    const cols = Object.keys(res.rows[0]!);
    for (const row of res.rows) {
      out.push(
        `insert into "${t}" (${cols.map((c) => `"${c}"`).join(",")}) values (${cols
          .map((c) => lit(row[c]))
          .join(",")}) on conflict do nothing;`,
      );
    }
  }
  out.push("commit;");
  console.log(out.join("\n"));
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
