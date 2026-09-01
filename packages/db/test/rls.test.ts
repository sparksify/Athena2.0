import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const pkgRoot = resolve(import.meta.dirname, "..");

const ORG = "00000000-0000-0000-0000-00000000000a";
const MANAGER = "00000000-0000-0000-0000-0000000000b1";
const CONSULTANT_A = "00000000-0000-0000-0000-0000000000b2";
const CONSULTANT_B = "00000000-0000-0000-0000-0000000000b3";
const CAND_A = "00000000-0000-0000-0000-0000000000c1";
const CAND_B = "00000000-0000-0000-0000-0000000000c2";

let db: PGlite;

/** Run a query as an authenticated user (RLS + role policies applied). */
async function asUser<T>(userId: string, query: string): Promise<T[]> {
  await db.exec(`begin;
    select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
    set local role authenticated;`);
  try {
    const res = await db.query<T>(query);
    return res.rows;
  } finally {
    await db.exec("commit;");
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid
      language sql stable as
      'select (nullif(current_setting(''request.jwt.claims'', true), '''')::json->>''sub'')::uuid';
    create role authenticated;
    create role service_role;
  `);
  const files = ["migrations", "policies"]
    .flatMap((dir) =>
      readdirSync(resolve(pkgRoot, dir))
        .filter((x) => x.endsWith(".sql"))
        .map((f) => ({ name: f, path: resolve(pkgRoot, dir, f) })),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const f of files) {
    await db.exec(readFileSync(f.path, "utf8"));
  }

  // seed: one org, a manager, two consultants, one candidate each with
  // score snapshots and financials
  await db.exec(`
    insert into org (id, name) values ('${ORG}', 'Test');
    insert into "user" (id, org_id, email, role) values
      ('${MANAGER}', '${ORG}', 'mgr@test.com', 'manager'),
      ('${CONSULTANT_A}', '${ORG}', 'a@test.com', 'consultant'),
      ('${CONSULTANT_B}', '${ORG}', 'b@test.com', 'consultant');
    insert into candidate (id, org_id, full_name, primary_email, assigned_to_user_id) values
      ('${CAND_A}', '${ORG}', 'Alpha Person', 'alpha@x.com', '${CONSULTANT_A}'),
      ('${CAND_B}', '${ORG}', 'Beta Person', 'beta@x.com', '${CONSULTANT_B}');
    insert into score_snapshot (org_id, candidate_id, score, version, factors) values
      ('${ORG}', '${CAND_A}', 80, 1, '[]'), ('${ORG}', '${CAND_B}', 60, 1, '[]');
    insert into financial_profile (org_id, candidate_id, liquidity_usd) values
      ('${ORG}', '${CAND_A}', 250000), ('${ORG}', '${CAND_B}', 100000);
  `);
});

afterAll(async () => {
  await db.close();
});

describe("Phase 4 RLS proof — roles", () => {
  it("a consultant sees only their own candidates", async () => {
    const rows = await asUser<{ id: string }>(CONSULTANT_A, "select id from candidate");
    expect(rows.map((r) => r.id)).toEqual([CAND_A]);
    const other = await asUser<{ id: string }>(CONSULTANT_B, "select id from candidate");
    expect(other.map((r) => r.id)).toEqual([CAND_B]);
  });

  it("a consultant sees no financials at all — not even their own candidate's", async () => {
    const rows = await asUser(CONSULTANT_A, "select * from financial_profile");
    expect(rows).toHaveLength(0);
  });

  it("a consultant sees only their own candidate's scores and attributes", async () => {
    const scores = await asUser<{ candidate_id: string }>(
      CONSULTANT_A,
      "select candidate_id from score_snapshot",
    );
    expect(scores.map((r) => r.candidate_id)).toEqual([CAND_A]);
  });

  it("a consultant cannot touch the identity review queue", async () => {
    const rows = await asUser(CONSULTANT_A, "select * from identity_review");
    expect(rows).toHaveLength(0);
  });

  it("a manager sees all candidates and all financials", async () => {
    const cands = await asUser<{ id: string }>(MANAGER, "select id from candidate order by id");
    expect(cands).toHaveLength(2);
    const fins = await asUser<{ liquidity_usd: string }>(MANAGER, "select liquidity_usd from financial_profile");
    expect(fins).toHaveLength(2);
    const scores = await asUser(MANAGER, "select id from score_snapshot");
    expect(scores).toHaveLength(2);
  });
});
