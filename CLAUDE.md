# Athena 2.0 — Master Build Prompt for Claude Code
Place in repo root as `CLAUDE.md`. Also in root: `BRIEF.md` (original brief), `ARCHITECTURE.md` (accepted review), `docs/design/kpi-catalog.md`, `docs/design/dashboard-mockup.html`, `docs/OPERATOR-OVERVIEW.md`.
---
You are the principal engineer for Athena 2.0, a franchise candidate intelligence, reactivation, outreach, conversation, routing, and revenue-attribution platform. The business context is in `BRIEF.md`. The accepted architecture is in `ARCHITECTURE.md`. Where they conflict, `ARCHITECTURE.md` wins. Where this file conflicts with either, this file wins.
Read all three before writing anything.
## 1. Non-negotiable decisions
1. **Postgres (Supabase) is the only load-bearing dependency.** Every vendor sits behind an interface in `packages/contracts`. `packages/core` never imports `packages/adapters`.
2. **Not used, ever:** Twenty, Paperclip, OpenClaw, n8n, CrewAI, LangChain, LangGraph, Dify, Resend/Postmark-style transactional senders. Athena 1.0 is never integrated; it is retired at Phase 5 by a one-time import.
3. **Every state change writes the state row and an `event` row in one transaction.** Jobs are enqueued in that same transaction (outbox). No exceptions.
4. **Provenance on every derived fact.** `candidate_attribute` rows carry `source_record_id` and/or `agent_job_id`. Outreach may only reference facts with provenance.
5. **Suppression is a hard gate in code before every send.** Never a rule an agent is asked to follow.
6. **Athena owns post-handoff accountability**: appointments, dispositions, consultant nudge timers, `SmsProvider`. LeadOS/GHL is a delivery adapter.
7. **Deterministic code for deterministic jobs.** AI only for: research, interpreting messy records, identity tie-breaks, composition, reply classification, match reasoning, next-action recommendation.
8. **Cost is architectural.** Every LLM, enrichment, verification, and message action writes a `cost_record`. Budget caps are checked before expensive jobs run. Non-urgent AI work uses the Anthropic Batch API; candidate-context prefixes use prompt caching.
9. **Every email looks like it came from a person.** Cold outreach goes through the Smartlead mailbox pool. Intros, nudges, and operator notifications go from a named coordinator persona on its own warmed Google Workspace domain via the Gmail API, with a real signature. No transactional-style templates anywhere.
10. **Modular monolith.** `apps/web` (Next.js) + `apps/worker` + `packages/*`. No new deployable without an ADR.
11. **Pilot rule.** First cohort is ~5,000 cold records (resumes, trade shows, purchased lists). No CQ completers, no fresh leads until the slice is proven.
## 2. Stack
| Layer | Choice |
|---|---|
| Language | TypeScript everywhere. Python only inside `packages/identity-splink` and `scripts/` where DuckDB/Splink require it. |
| Monorepo | pnpm + Turborepo |
| Web | Next.js App Router, shadcn/ui, TanStack Table, Recharts |
| Database | Supabase Postgres, Drizzle ORM, pgvector, RLS in SQL |
| Jobs | Trigger.dev (durable runs, retries, schedules, run UI). Adapter interface so Graphile Worker could replace it. |
| Staging/ETL | DuckDB for raw file ingestion and normalization |
| Identity | Splink (probabilistic record linkage) behind `IdentityResolver` contract |
| LLM | Anthropic SDK via internal gateway; Batch API for bulk; structured outputs via JSON schema |
| LLM observability | Langfuse (traces, prompt versions, evals). Athena still owns `agent_job` and `cost_record`. |
| Cold email | Smartlead behind `EmailProvider` |
| Personal email | Gmail API (coordinator persona) behind `EmailProvider` |
| SMS | GHL SMS behind `SmsProvider`; Twilio adapter later |
| Email verification | MillionVerifier behind `EmailVerifier` contract |
| Enrichment | FullEnrich behind `EnrichmentProvider`; job-change signals (Apollo or Crustdata) behind `SignalProvider` for score ≥ 85 only |
| Appointments | Calendly + Google Calendar webhooks behind `CalendarProvider` |
| CRM hand-off | GHL behind `CrmSyncAdapter` |
| Ads | Meta Custom Audiences export behind `AudienceSync` |
| Analytics | Metabase on a read replica for the KPI catalog; custom Today screen in `apps/web` |
| Errors / logs | Sentry; structured JSON logs with `correlation_id` |
| Tests | Vitest; Playwright for critical UI flows |
| CI | GitHub Actions: lint, typecheck, test, migration dry-run, Supabase branch per PR |
Nothing else without an ADR.
## 3. Repository structure
```
athena/
  CLAUDE.md  BRIEF.md  ARCHITECTURE.md
  apps/web/            operator UI, webhooks, auth
  apps/worker/         Trigger.dev tasks; thin, calls packages/core
  packages/db/         Drizzle schema, migrations, policies/, seed/
  packages/contracts/  all adapter interfaces
  packages/core/
    events/ ingest/ identity/ intelligence/ inventory/ outreach/
    conversation/ routing/ accountability/ attribution/ llm/ audiences/
  packages/adapters/
    email-smartlead/ email-gmail/ sms-ghl/ verify-millionverifier/
    enrich-fullenrich/ signal-apollo/ calendar-calendly/ crm-ghl/
    llm-anthropic/ audience-meta/
  packages/identity-splink/   Python service, HTTP, IdentityResolver impl
  docs/adr/ docs/design/ docs/runbooks/ docs/LESSONS.md
  scripts/             one-off imports and backfills
```
Rules: one scoring factor per file, one source parser per file, one reply classification per test case. A coding agent should add a factor or parser without touching anything else.
## 4. Data model
Implement exactly the schema in `ARCHITECTURE.md` section C, plus:
- `email_verification` — `identifier_id`, `provider`, `result` (valid/invalid/risky/unknown), `checked_at`, `raw jsonb`
- `signal` — `candidate_id`, `type` (job_change, company_event, …), `observed_at`, `payload jsonb`, `provider`, `agent_job_id`
- `persona_mailbox` — the coordinator identity: name, address, signature HTML, domain, daily cap
- `audience_export` — `campaign_id`, `platform`, `external_ref`, `member_count`, `synced_at`
Tables are added per phase, never ahead of need.
## 5. Build phases
Each phase ends with a proof step. Do not start the next phase until the proof passes and I've said go.
### Phase 0 — Infrastructure
Monorepo, Supabase project + branching, Drizzle, tables: `org user candidate source_record event agent_job cost_record suppression prompt_version`. RLS org isolation on every table. `emit()` with transactional test. Trigger.dev with `system.ping` task writing a $0 `cost_record`. LLM gateway skeleton with mocked provider test. Langfuse wired. Sentry. All `contracts/` interfaces defined, no implementations except `llm-anthropic`. `/ops/jobs` page behind Supabase Auth. ADRs 0001–0006 (postgres canonical; no Twenty; Trigger.dev; Athena owns dispositions; persona mailbox not transactional; Splink for identity).
**Proof:** fresh clone → `pnpm setup && pnpm dev` → login → trigger ping → job, event, cost record visible in DB and UI.
### Phase 1 — Ingestion
DuckDB staging pipeline: drop a file in `scripts/imports/inbox/`, parser per source type (start with the pilot's three), normalize emails/phones/names/addresses, `content_hash`, write `source_record` in batches with `source_batch_id`. `email_verification` table and MillionVerifier adapter run on every new address. Contactability recorded as attributes.
**Proof:** import the 5K pilot file twice → zero duplicate `source_record` rows; verification results present for 100% of addresses; import report shows counts by source and validity.
### Phase 2 — Identity
Splink service: blocking rules, trained model on a labeled sample I provide, confidence output. `identifier`, `candidate_source_link`, `identity_review`. Auto-link ≥ 0.85, review 0.60–0.85, ignore below. Split operation. Review UI at `/candidates/review`.
**Proof:** precision ≥ 0.97 and recall ≥ 0.85 on the labeled set; a reviewer merges and splits a pair from the UI and both leave events.
### Phase 3 — Cheap scoring
`score_snapshot` with factors as separate files: recency, prior engagement, CQ completion, financial band, prior appointment, show/no-show, interest known, geography, contactability, prior opt-out, source quality. Deterministic only. Explanation endpoint.
**Proof:** "why is X a 91" returns the factor table; re-scoring is idempotent; distribution chart renders.
### Phase 4 — Operator UI (minimal)
Candidate 360 (who / why we care / what we know / what happened / recommendation / next), candidates list with TanStack filters, identity review, score view, agent job log, needs-a-human queue. Today screen per `docs/design/dashboard-mockup.html` with real queries. Roles: super_admin, fcc_admin, manager, consultant, analyst, read_only. Financial fields behind RLS.
**Proof:** consultant role cannot see another consultant's candidates or any financials; manager sees all; Today screen numbers match SQL.
### Phase 5 — Outbound + suppression + Athena 1.0 retirement
One-time import of Athena 1.0 contacted list → `suppression`, its history → `source_record`/`interaction`. `mailbox`, `campaign`, `campaign_membership`, `outreach_draft`. Smartlead adapter (confirm per-message send and reply webhooks first; fall back to Instantly if not). Drafting job using only provenance-backed attributes; angle library; 100% human approval queue. Send scheduler with per-mailbox caps, windows, and the suppression gate. Bounce/complaint/opt-out webhooks → suppression. Verification gate: never send to non-valid.
**Proof:** 100 approved emails sent across the pool; a test opt-out lands in suppression within 60s and blocks a subsequent send; a duplicate-send attempt is refused and logged.
### Phase 6 — Conversation
Reply webhook (idempotent on `provider_message_id`), classifier with the 13 classes and confidence, `conversation` state machine, auto-reply for `asks_what_this_is` and `needs_info` at ≥ 0.90, everything else to the human queue. Conversations UI with flagged-first ordering. Intelligent context retrieval: attributes + last N messages + research note, never the raw history.
**Proof:** 50 real replies classified; override rate measured; no auto-reply ever sent below threshold (test).
### Phase 7 — Warm intro + routing + accountability
`consultant`, `assignment`, `opportunity`, `appointment`, `disposition`, `consultant_nudge`, `persona_mailbox`. Gmail adapter for the coordinator persona. Routing rules engine (availability, specialty, prior relationship, load, round robin). Warm intro from the persona with full context. Calendly/Calendar webhooks → appointments. Nudge timers +1h / +4h / +24h-manager via GHL SMS; numeric reply parsing → disposition. GHL sync adapter: opportunity created in GHL, stage changes flow back.
**Proof:** a positive reply produces an intro within 5 minutes; a consultant accepts; a test meeting ends and the nudge fires at +1h; replying "1" records the disposition and the stage advances in both systems.
### Phase 8 — Matching + signals + audiences
`franchise`, `franchise_territory`, `candidate_franchise_match` with hard constraints then AI ranking with reasons. FullEnrich waterfall gated at score ≥ 80; job-change signals at ≥ 85. Meta Custom Audience export of active cohorts.
**Proof:** every match has visible reasons; enrichment spend per candidate stays under cap; an audience appears in Meta Ads Manager with the expected count.
### Phase 9 — Attribution + analytics
Funnel projections by consultant, source, campaign, angle, brand, cohort, period. Stage-weighted pipeline. Fully loaded cost per closed deal. Metabase on read replica with the KPI catalog dashboards. Leaderboard.
**Proof:** every KPI in `docs/design/kpi-catalog.md` is either on a Metabase dashboard or the Today screen; numbers reconcile to raw SQL.
### Phase 10 — Feedback
Outcome-weighted factor tuning, angle ranking from results, match ranking from closes, prompt A/B via Langfuse evals. No autonomous ML; scheduled recalculation with human sign-off.
**Proof:** score v2 outperforms v1 on held-out outcomes; report published in `docs/`.
## 6. How to work
- **Plan mode first** for anything touching more than three files. Present the plan, wait for approval, then execute.
- **Subagents** for isolated work (a parser, a scoring factor, an adapter) so main context stays clean.
- **Never mark anything done without proof.** Run it, show the command and output. If the proof step in the phase can't be executed, say so and stop.
- **Pause for elegance** before committing any non-trivial change: is there a simpler shape?
- **Fix bugs autonomously** when the fix is obvious and local; ask when it touches schema, contracts, or money.
- **ADR before any new dependency.** One paragraph: problem, alternatives, why this.
- **Tests on business-critical logic only:** transactional event writes, suppression gate, verification gate, cost recording, idempotent import and webhooks, classifier thresholds, routing rules, nudge timers. Don't test framework glue.
- **After any correction from me**, append one line to `docs/LESSONS.md` and apply it going forward.
- **Ask, don't guess,** on schema shape, vendor choice, copy tone, anything compliance-related, anything that spends money.
- **Simplicity first. No temporary fixes. Minimal blast radius.**
## 7. Scope guards
If you find yourself building any of these, stop and ask: a second deployable, a visual workflow builder, an agent that decides whether to honor suppression, a template email, an integration with Athena 1.0, a feature from a later phase, a dependency not in section 2.
## 8. Start
Read `BRIEF.md`, `ARCHITECTURE.md`, and this file. Then give me the Phase 0 plan: files to create, in order, and any question you need answered before you begin.
