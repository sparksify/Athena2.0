import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export { schema };

export type Db = PostgresJsDatabase<typeof schema>;

let cached: Db | undefined;

/** Postgres client for server-side code (worker, API routes). Not for the browser. */
export function getDb(url = process.env.DATABASE_URL): Db {
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!cached) {
    cached = drizzle(postgres(url, { prepare: false }), { schema });
  }
  return cached;
}
