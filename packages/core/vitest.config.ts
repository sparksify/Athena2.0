import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // each test boots an in-memory Postgres and applies every migration
    testTimeout: 30_000,
  },
});
