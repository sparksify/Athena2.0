#!/usr/bin/env node
// Applies any unapplied SQL files from migrations/ and policies/ in numeric
// order, recording them in supabase_migrations.schema_migrations so this
// stays compatible with migrations applied through Supabase tooling.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const pkgRoot = resolve(import.meta.dirname, "..");
const files = ["migrations", "policies"]
  .flatMap((dir) =>
    readdirSync(resolve(pkgRoot, dir))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => ({ version: f.replace(/\.sql$/, ""), path: resolve(pkgRoot, dir, f) })),
  )
  .sort((a, b) => a.version.localeCompare(b.version));

const sql = postgres(url, { max: 1, prepare: false });
try {
  await sql`create schema if not exists supabase_migrations`;
  await sql`create table if not exists supabase_migrations.schema_migrations (
    version text primary key, statements text[], name text
  )`;
  const applied = new Set(
    (await sql`select version from supabase_migrations.schema_migrations`).map((r) => r.version),
  );
  for (const f of files) {
    if (applied.has(f.version)) continue;
    const body = readFileSync(f.path, "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into supabase_migrations.schema_migrations (version, name)
        values (${f.version}, ${f.version})`;
    });
    console.log(`applied ${f.version}`);
  }
  console.log("migrations up to date");
} finally {
  await sql.end();
}
