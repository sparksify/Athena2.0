import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const pkgRoot = resolve(import.meta.dirname, "..");

/**
 * Migration dry-run: every SQL file in migrations/ and policies/ must apply
 * cleanly, in order, to an empty Postgres. Stubs the Supabase auth.uid()
 * function that RLS policies reference.
 */
describe("migrations", () => {
  it("apply cleanly to an empty database", async () => {
    const db = new PGlite();
    await db.exec(`
      create schema if not exists auth;
      create or replace function auth.uid() returns uuid
        language sql stable as 'select null::uuid';
      create role authenticated;
      create role service_role;
    `);
    const files = ["migrations", "policies"]
      .flatMap((dir) =>
        readdirSync(resolve(pkgRoot, dir))
          .filter((f) => f.endsWith(".sql"))
          .map((f) => ({ name: f, path: resolve(pkgRoot, dir, f) })),
      )
      .sort((a, b) => a.name.localeCompare(b.name)); // global order across dirs
    for (const file of files) {
      await db.exec(readFileSync(file.path, "utf8"));
    }

    const { rows } = await db.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    expect(rows.map((r) => r.tablename)).toEqual([
      "agent_job",
      "angle",
      "campaign",
      "campaign_membership",
      "candidate",
      "candidate_attribute",
      "candidate_source_link",
      "conversation",
      "cost_record",
      "email_verification",
      "event",
      "financial_profile",
      "identifier",
      "identity_review",
      "import_batch",
      "interaction",
      "mailbox",
      "message",
      "org",
      "outreach_draft",
      "prompt_version",
      "questionnaire",
      "score_snapshot",
      "source_record",
      "suppression",
      "user",
    ]);

    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`,
    );
    for (const row of rls.rows) {
      expect(row.relrowsecurity, `${row.relname} must have RLS enabled`).toBe(true);
    }
    await db.close();
  });
});
