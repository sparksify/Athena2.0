import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // boots an in-memory Postgres and applies every migration; slow under
    // parallel turbo runs
    testTimeout: 30_000,
    hookTimeout: 60_000, // rls.test applies all migrations in beforeAll
  },
});
