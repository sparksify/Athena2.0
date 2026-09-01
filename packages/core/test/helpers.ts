import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { schema } from "@athena/db";

const dbPkgRoot = resolve(import.meta.dirname, "../../db");

/** In-memory Postgres with the real migrations applied. */
export async function testDb() {
  const client = new PGlite();
  await client.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid
      language sql stable as 'select null::uuid';
    create role authenticated;
    create role service_role;
  `);
  const files = ["migrations", "policies"]
    .flatMap((dir) =>
      readdirSync(resolve(dbPkgRoot, dir))
        .filter((x) => x.endsWith(".sql"))
        .map((f) => ({ name: f, path: resolve(dbPkgRoot, dir, f) })),
    )
    .sort((a, b) => a.name.localeCompare(b.name)); // global order across dirs
  for (const f of files) {
    await client.exec(readFileSync(f.path, "utf8"));
  }
  const db = drizzle(client, { schema });
  return { db, client };
}
