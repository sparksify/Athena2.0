# Athena 2.0

Franchise candidate intelligence, reactivation, outreach, conversation, routing, and revenue-attribution platform. Architecture and rules: [`CLAUDE.md`](./CLAUDE.md).

**Phase 0 (infrastructure) is built.** Later phases land one at a time, each behind a proof step.

## Stack

pnpm + Turborepo monorepo · Next.js (App Router) · Supabase Postgres + Auth + RLS · Drizzle ORM · Trigger.dev · Anthropic SDK · Langfuse · Sentry · Vitest.

```
apps/web/            operator UI (login, /ops/jobs), Supabase Auth
apps/worker/         Trigger.dev tasks (system.ping)
packages/db/         Drizzle schema, SQL migrations, RLS policies, seed
packages/contracts/  all vendor adapter interfaces
packages/core/       emit() transactional events+outbox, LLM gateway, logger
packages/adapters/   llm-anthropic (only implementation in Phase 0)
docs/adr/            ADRs 0001–0006
```

## Getting started

```bash
pnpm install
pnpm run setup        # creates .env from .env.example (note: "run" required — pnpm has a builtin `setup`)
# fill .env — see below
pnpm dev              # web on :3000, worker via `trigger dev` once TRIGGER_* is set
```

Required in `.env`:

| Var | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | already set: project `baaddaravxmnevmovpad` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard → Settings → API Keys (publishable) |
| `DATABASE_URL` | Supabase dashboard → Connect → Transaction pooler (needed by worker + migrate script) |
| `TRIGGER_PROJECT_REF`, `TRIGGER_SECRET_KEY` | Trigger.dev dashboard (needed for durable jobs only) |
| `ANTHROPIC_API_KEY`, `LANGFUSE_*`, `SENTRY_DSN` | optional until later phases; everything no-ops without them |

## Database

Migrations are plain SQL in `packages/db/migrations/` and `packages/db/policies/`, applied in filename order. They are already applied to the live Supabase project. To apply elsewhere: `DATABASE_URL=... pnpm db:migrate`. Every table has org-isolation RLS; `anon` has no table access at all.

Signing up through the login page auto-creates a `user` row in the default org via an `auth.users` trigger (`packages/db/seed/0002_seed.sql`).

## Phase 0 proof

1. `pnpm dev` → open http://localhost:3000 (or the deployed URL)
2. Create an account / sign in
3. Click **Trigger ping** on `/ops/jobs`
4. A succeeded `system.ping` job, a `system.ping.completed` event, and a $0 cost record appear — all org-scoped through RLS.

The ping runs as a transactional Postgres function (`system_ping()`) so the proof works with only the publishable key. The durable-job path (`apps/worker` → Trigger.dev `system.ping` task) activates once `TRIGGER_*` and `DATABASE_URL` are configured: `pnpm --filter @athena/worker dev`.

## Tests

```bash
pnpm test   # migration dry-run (PGlite), transactional emit(), LLM gateway cost recording
```

## CI

GitHub Actions: lint, typecheck, migration dry-run, tests, build. Supabase preview branches per PR require the Supabase GitHub integration — enable it in the Supabase dashboard when ready.
