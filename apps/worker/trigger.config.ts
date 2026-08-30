import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_athena",
  dirs: ["./src/tasks"],
  maxDuration: 300,
});
