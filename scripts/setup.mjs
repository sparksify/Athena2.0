#!/usr/bin/env node
// One-time local setup: creates .env from the example and verifies required values.
import { existsSync, copyFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env");

if (!existsSync(envPath)) {
  copyFileSync(resolve(root, ".env.example"), envPath);
  console.log("Created .env from .env.example — fill in the empty values.");
} else {
  console.log(".env already exists.");
}

const env = readFileSync(envPath, "utf8");
const missing = ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "DATABASE_URL"].filter((k) =>
  new RegExp(`^${k}=\\s*$`, "m").test(env)
);
if (missing.length) {
  console.log(`Still empty in .env: ${missing.join(", ")}`);
  console.log("Get them from the Supabase dashboard (project baaddaravxmnevmovpad).");
} else {
  console.log("Required env values present. Run: pnpm dev");
}
