# Athena 2.0 — Architecture Review (Accepted)

Response to `BRIEF.md` §21 sections A–G. This is the accepted architecture; where it
conflicts with `BRIEF.md`, this document wins; where `CLAUDE.md` conflicts with this
document, `CLAUDE.md` wins. Decisions here are recorded as ADRs 0001–0006 in `docs/adr/`.
Section C is normative: phases implement exactly this schema, adding tables only in the
phase that needs them.

---

## A. Architecture review — the proposed stack, challenged

### Supabase / Postgres — KEEP (the only load-bearing dependency)

Postgres is the canonical store, the event log, the job outbox, the suppression list, and
the audit trail. Supabase adds managed auth, RLS, storage, pgvector, and read replicas
without owning any state Postgres doesn't. Everything else in the system must be
removable; this must not be. Vector search, realtime, and file storage are used only
where a phase concretely needs them — none are Phase 0 requirements.

### Twenty CRM — REMOVE

Twenty was evaluated as the operator UI foundation and rejected. Athena's operator
surface is not a CRM: its core screens are a candidate-intelligence 360 (provenance,
identity graph, score explanations, agent activity), a human-review queue, and a
command-center dashboard — none of which Twenty provides. What Twenty does provide
(people/company objects, pipelines, views) presumes Twenty's schema as the source of
truth, which violates the prime directive: forking it means inheriting a large codebase
whose data model fights ours, and syncing to it means two sources of truth. Building the
operator UI on Next.js + shadcn/ui + TanStack Table is less code than adapting Twenty,
and every pixel reads the canonical database directly. (ADR 0002.)

### Paperclip — REMOVE

The "agent workforce control plane" is, concretely: a registry of job types, durable
execution with retries, budgets, and monitoring. Athena already owns the first and last
as tables (`agent_job`, `cost_record` — they must be canonical for attribution and cost
control regardless of runtime), and Trigger.dev provides durable execution, scheduling,
retries, and a run UI as a thin, replaceable layer. Adopting a second agent platform
would duplicate the canonical tables or, worse, become their home. No component may own
agent state except Postgres.

### OpenClaw — REMOVE (no adapter)

Athena 1.0 is never integrated. It is retired at Phase 5 by a one-time import: its
contacted list becomes `suppression` rows (the single most valuable thing it owns — who
has already been touched), and its history becomes `source_record`/`interaction` rows.
Keeping a live adapter would mean two systems sending email to one audience with no
shared suppression — the duplicate-outreach risk in §G with no compensating benefit.

### Dedicated outbound email — KEEP, split in two

Cold reactivation volume goes through a Smartlead mailbox pool (warmup, rotation,
per-mailbox caps) behind an `EmailProvider` contract, with Instantly as the tested
fallback if Smartlead's per-message webhooks disappoint. Warm sends — intros, nudges,
operator notifications — go from a named coordinator persona on its own warmed Google
Workspace domain via the Gmail API, behind the same contract. No transactional senders
(Resend/Postmark-style) anywhere: every email must look like it came from a person.
(ADR 0005.) Compliance note: the suppression gate and verification gate are deterministic
code in the send path, never a rule an agent is asked to follow.

### Direct LLM APIs — KEEP, behind an internal gateway

Anthropic SDK, called only through Athena's own gateway (`packages/core/llm`), which
writes a `cost_record` per call, enforces budget checks before expensive jobs, uses the
Batch API for non-urgent bulk work, prompt-caches candidate-context prefixes, and traces
to Langfuse. No LangChain/LangGraph/CrewAI/Dify: an LLM call with structured output and
a database is sufficient for every AI task in the brief, and orchestration frameworks
would put a second stateful runtime between Athena and its model calls.

### Additions (each solving a concrete problem)

| Dependency | Problem it solves | Replaceable via |
|---|---|---|
| Trigger.dev | durable async jobs, retries, schedules, run UI | `JobRunner` contract; Graphile Worker is the named fallback (ADR 0003) |
| DuckDB | fast local normalization of large messy files before anything touches Postgres | scripts only, no runtime dependency |
| Splink | probabilistic identity resolution with confidence output at 1M-record scale | `IdentityResolver` contract (ADR 0006) |
| MillionVerifier | email verification before any send | `EmailVerifier` contract |
| FullEnrich | waterfall enrichment, gated by score | `EnrichmentProvider` contract |
| Apollo/Crustdata | job-change signals for score ≥ 85 only | `SignalProvider` contract |
| GHL | SMS delivery + CRM hand-off mirror (LeadOS integration point) | `SmsProvider`, `CrmSyncAdapter` (ADR 0004: Athena owns dispositions) |
| Calendly + Google Calendar | appointment webhooks | `CalendarProvider` |
| Meta Custom Audiences | ad-audience export of active cohorts | `AudienceSync` |
| Langfuse | LLM traces, prompt versions, evals | observability only; `agent_job`/`cost_record` stay canonical |
| Metabase | KPI catalog on a read replica | reads a replica; owns nothing |
| Sentry | errors | observability only |

### Verdict summary

**KEEP:** Supabase/Postgres, dedicated outbound email (Smartlead + Gmail persona),
direct LLM APIs. **REMOVE:** Twenty, Paperclip, OpenClaw (one-time import instead).
**REPLACE:** nothing proposed needed replacing beyond the removals. **BUILD OURSELVES:**
the candidate graph, scoring, suppression/verification gates, outreach drafting +
approval, conversation engine, routing + accountability, attribution, and the operator
UI — the parts that *are* Athena.

---

## B. System architecture

Modular monolith. Two deployables plus one internal service, all reading one database:

```
                    ┌──────────────────────────────────────────────┐
                    │                 SUPABASE POSTGRES             │
                    │  canonical state · event log · outbox ·       │
                    │  suppression · costs · RLS org isolation      │
                    └──────┬───────────────────────┬───────────────┘
        reads/writes via   │                       │ read replica
  ┌───────────────┐   ┌────┴────────┐        ┌─────┴─────┐
  │  apps/web     │   │ apps/worker │        │  Metabase │
  │  Next.js      │   │ Trigger.dev │        │  (KPIs)   │
  │  operator UI, │   │ tasks; thin,│        └───────────┘
  │  webhooks,    │   │ calls core  │
  │  auth         │   └────┬────────┘
  └──────┬────────┘        │
         └────────┬────────┘
             packages/core   ← all business logic; deterministic + AI callsites
                  │
             packages/contracts   ← every vendor interface
                  │
             packages/adapters/*  ← smartlead · gmail · ghl · millionverifier ·
                                    fullenrich · apollo · calendly · crm-ghl ·
                                    llm-anthropic · meta
             packages/identity-splink  ← Python HTTP service behind IdentityResolver
```

**Boundaries (enforced, not aspirational):**

- *Data boundary*: Postgres is the only canonical store. Every state change writes the
  state row and an `event` row in one transaction; jobs are enqueued in that same
  transaction (`agent_job` as transactional outbox). External systems only ever hold
  copies.
- *Dependency boundary*: `packages/core` imports `packages/contracts`, never
  `packages/adapters`. Adapters are injected at the edges (worker tasks, API routes).
- *Deterministic boundary*: webhooks, status updates, scheduling, suppression,
  verification, routing rules, timers, cost caps — plain code. AI only for: research,
  interpreting messy records, identity tie-breaks, composition, reply classification,
  match reasoning, next-action recommendation.
- *Agent boundary*: every AI action is an `agent_job` row with inputs, outputs, model,
  prompt version, confidence, cost, and latency — inspectable in the UI, traced in
  Langfuse. No autonomous action without a job row.

## C. Data model (normative)

Conventions: `uuid` PKs (`gen_random_uuid()`), `org_id uuid not null references org`
on every table, `created_at timestamptz not null default now()`, UTC everywhere,
RLS org isolation on every table, `snake_case` singular table names. Provenance rule:
every derived fact carries `source_record_id` and/or `agent_job_id`. Tables are created
in the phase that needs them (noted per group).

### C.1 Core & operations — Phase 0 (built)

```
org               (id, name, created_at)
user              (id = auth.users.id, org_id, email, full_name,
                   role ∈ super_admin|fcc_admin|manager|consultant|analyst|read_only,
                   created_at)
candidate         (id, org_id, full_name, primary_email, primary_phone,
                   status text default 'new', created_at, updated_at)
source_record     (id, org_id, source_type, source_batch_id, content_hash,
                   payload jsonb, imported_at, UNIQUE(org_id, content_hash))
event             (id, org_id, type, entity_type, entity_id,
                   actor_type ∈ system|user|agent, actor_id, payload jsonb,
                   correlation_id, created_at)          -- append-only
agent_job         (id, org_id, type, status ∈ queued|running|succeeded|failed,
                   payload jsonb, result jsonb, error, correlation_id,
                   created_at, started_at, finished_at)  -- doubles as outbox
cost_record       (id, org_id, agent_job_id, category ∈ llm|enrichment|verification|message|other,
                   provider, amount_usd numeric(12,6), detail jsonb, created_at)
suppression       (id, org_id, channel ∈ email|sms, identifier, reason, source,
                   created_at, UNIQUE(org_id, channel, identifier))
prompt_version    (id, org_id, name, version int, content, model, active bool,
                   created_at, UNIQUE(org_id, name, version))
```

`candidate.status` lifecycle: `new → scored → selected → contacted → replied →
interested → introduced → in_opportunity → closed_won | closed_lost | suppressed`.
Status is derived from events; it never moves except through code paths that emit.

### C.2 Ingestion & verification — Phase 1

```
identifier         (id, org_id, candidate_id nullable, type ∈ email|phone|linkedin|postal,
                    value_normalized, value_raw, first_source_record_id,
                    UNIQUE(org_id, type, value_normalized))
email_verification (id, org_id, identifier_id, provider,
                    result ∈ valid|invalid|risky|unknown, checked_at, raw jsonb)
```

Contactability is recorded as `candidate_attribute` rows once Phase 2 exists; in
Phase 1 it lives on the identifier via `email_verification`.

### C.3 Identity graph — Phase 2

```
candidate_source_link (id, org_id, candidate_id, source_record_id, confidence numeric,
                       method ∈ exact|splink|manual|agent, agent_job_id,
                       created_at, UNIQUE(candidate_id, source_record_id))
identity_review       (id, org_id, candidate_a_id, candidate_b_id, score numeric,
                       status ∈ pending|merged|rejected|split, evidence jsonb,
                       reviewed_by, reviewed_at, created_at)
candidate_attribute   (id, org_id, candidate_id, key, value jsonb, confidence numeric,
                       source_record_id, agent_job_id, superseded_by_id nullable,
                       created_at)
                       -- never updated: a corrected fact supersedes, preserving history.
                       -- research notes are attributes (key='research_note').
questionnaire         (id, org_id, candidate_id, source_record_id,
                       kind ∈ cq_complete|cq_partial, answers jsonb, completed_at)
financial_profile     (id, org_id, candidate_id UNIQUE, liquidity_usd numeric,
                       net_worth_usd numeric, investable_usd numeric,
                       source_record_id, agent_job_id, updated_at)
                       -- separate table so financial RLS is a table policy, not row logic
```

Merges are non-destructive: merging B into A repoints B's `candidate_source_link` and
`identifier` rows at A, marks B `status='merged_into:A'`, and emits events. Split
reverses via the preserved links. Raw `source_record.payload` is never modified.

### C.4 Intelligence — Phase 3 (+ signals Phase 8)

```
score_snapshot (id, org_id, candidate_id, score int, version,
                factors jsonb,   -- [{factor, points, reason}] — the explanation
                created_at)
signal         (id, org_id, candidate_id, type ∈ job_change|company_event|…,
                observed_at, payload jsonb, provider, agent_job_id)
```

Scoring is deterministic (one factor per file); `factors` answers "why is Robert a 91".
Re-scoring writes a new snapshot; `candidate` caches the latest score for list queries.

### C.5 Interactions & conversation — Phases 1/5/6

```
interaction  (id, org_id, candidate_id, type ∈ email_sent|email_reply|sms|call|meeting|
              presentation|territory_check|import_history, direction ∈ inbound|outbound,
              occurred_at, consultant_id nullable, campaign_id nullable,
              payload jsonb, source_record_id nullable, provider_ref)
              -- historical interactions from imports AND live rollups: one timeline
conversation (id, org_id, candidate_id, channel ∈ email|sms,
              state ∈ open|awaiting_candidate|awaiting_human|closed,
              flagged bool default false, assigned_user_id nullable,
              opened_at, last_message_at)
message      (id, org_id, conversation_id, direction ∈ inbound|outbound,
              provider, provider_message_id, mailbox_id nullable,
              persona_mailbox_id nullable, subject, body_text,
              classification nullable,      -- 13 classes + ambiguous
              classification_confidence numeric nullable, agent_job_id nullable,
              occurred_at, UNIQUE(provider, provider_message_id))  -- idempotent webhooks
```

### C.6 Outreach — Phase 5

```
mailbox             (id, org_id, provider ∈ smartlead|gmail, address, domain,
                     daily_cap int, status ∈ warming|active|paused, external_ref)
persona_mailbox     (id, org_id, name, address, signature_html, domain, daily_cap int)
angle               (id, org_id, name, description, prompt_version_id, active bool)
campaign            (id, org_id, name, status ∈ draft|active|paused|done,
                     cohort_definition jsonb, send_window jsonb, created_at)
campaign_membership (id, org_id, campaign_id, candidate_id,
                     status ∈ pending|drafted|sent|replied|excluded,
                     UNIQUE(campaign_id, candidate_id))
outreach_draft      (id, org_id, campaign_id, candidate_id, angle_id, mailbox_id nullable,
                     subject, body_text, cited_attribute_ids uuid[],   -- provenance gate
                     status ∈ draft|approved|rejected|scheduled|sent|blocked,
                     blocked_reason nullable, approved_by nullable, agent_job_id,
                     sent_message_id nullable, created_at)
audience_export     (id, org_id, campaign_id, platform, external_ref,
                     member_count int, synced_at)
```

Send path (deterministic, in order): draft `approved` → verification gate (identifier
must have `email_verification.result='valid'`) → suppression gate → mailbox cap/window
check → send via adapter → `message` + `interaction` + events. A draft may only cite
attributes that exist with provenance (`cited_attribute_ids` is validated, not trusted).

### C.7 Routing & accountability — Phase 7

```
consultant       (id, org_id, user_id nullable, name, email, phone, timezone,
                  specialties jsonb, territories jsonb,
                  status ∈ active|paused, max_load int, ghl_ref)
assignment       (id, org_id, candidate_id, consultant_id, conversation_id nullable,
                  reason jsonb,    -- routing factors snapshot
                  status ∈ offered|accepted|declined|reassigned,
                  offered_at, responded_at)
opportunity      (id, org_id, candidate_id, consultant_id,
                  stage ∈ introduced|accepted|first_contact|appointment_scheduled|
                          showed|cq|brands_presented|territory_check|application|
                          discovery|awarded|closed_won|closed_lost,
                  lost_reason nullable, value_usd nullable, ghl_ref,
                  stage_updated_at, created_at)
                  -- stage changes emit events; the event stream is the funnel history
appointment      (id, org_id, candidate_id, consultant_id, opportunity_id,
                  provider ∈ calendly|gcal, external_ref, starts_at, ends_at,
                  status ∈ scheduled|showed|no_show|canceled, created_at)
disposition      (id, org_id, appointment_id, consultant_id, code, notes,
                  recorded_via ∈ sms|ui, recorded_at)
consultant_nudge (id, org_id, appointment_id, consultant_id,
                  kind ∈ plus_1h|plus_4h|plus_24h_manager,
                  due_at, sent_at nullable, response nullable, provider_ref)
```

### C.8 Matching — Phase 8

```
franchise                 (id, org_id, name, category, investment_min_usd,
                           investment_max_usd, liquidity_min_usd, net_worth_min_usd,
                           model ∈ owner_operator|semi_absentee, attributes jsonb,
                           active bool)
franchise_territory       (id, org_id, franchise_id, region jsonb,
                           status ∈ available|reserved|sold)
candidate_franchise_match (id, org_id, candidate_id, franchise_id, rank int,
                           hard_constraints_passed bool, reasons jsonb,
                           agent_job_id, created_at)
```

Brief-name mapping: `Identity` → `identifier` + `candidate_source_link` +
`identity_review`; `Outcome` → `opportunity.stage/lost_reason` + the event stream
(no separate table — an outcome is a stage transition with history).

## D. Repository structure

As specified in `CLAUDE.md` §3 and already scaffolded: pnpm + Turborepo;
`apps/web` (operator UI, webhooks, auth), `apps/worker` (Trigger.dev tasks, thin),
`packages/db` (Drizzle schema, SQL migrations, RLS policies, seed),
`packages/contracts` (every adapter interface), `packages/core` (all business logic,
one module per domain), `packages/adapters/*` (one package per vendor),
`packages/identity-splink` (Python HTTP service), `docs/` (ADRs, design, runbooks,
LESSONS), `scripts/` (imports, backfills). Rules that keep it AI-agent-friendly: one
scoring factor per file, one source parser per file, one reply classification per test
case — a coding agent adds one without touching anything else.

## E. Build sequence

The brief's suggested order (§21.E) is accepted with two changes, both argued from the
pilot:

1. **Operator UI moves after scoring** (brief: Phase 3; accepted: Phase 4). A UI before
   identity + scoring exists would render empty tables; after Phase 3 it opens on real
   intelligence — candidates, scores, explanations, review queues — and every screen is
   testable against real data.
2. **Franchise matching moves after conversation** (brief: Phase 5; accepted: Phase 8).
   The pilot's reactivation outreach leans on *historical* interest and financials, not
   live inventory matching; conversations and consultant routing produce revenue sooner.
   Matching lands with enrichment + signals, which it needs anyway.

Accepted sequence (proof steps per phase in `CLAUDE.md` §5): **0** infrastructure ·
**1** ingestion + verification · **2** identity · **3** deterministic scoring ·
**4** operator UI · **5** outbound + suppression + Athena 1.0 retirement ·
**6** conversation · **7** warm intro + routing + accountability · **8** matching +
signals + audiences · **9** attribution + analytics · **10** feedback. No phase starts
until the previous phase's proof passes and Steve says go.

## F. First vertical slice

The pilot cohort: **~5,000 cold records** (resumes, trade shows, purchased lists — the
pilot's three source types). No CQ completers, no fresh leads until the slice is proven.
The slice runs the brief's §21.F flow end to end across Phases 1–7:

import 5K twice (zero duplicate source records) → verify every address → resolve
identities (precision ≥ 0.97 / recall ≥ 0.85 on a labeled set) → score with
explanations → select the top cohort → draft outreach citing only provenance-backed
facts → 100% human approval → send through the Smartlead pool behind suppression +
verification gates → classify replies (auto-answer only 2 classes at ≥ 0.90) → warm
intro from the coordinator persona within 5 minutes of a positive reply → consultant
accepts → appointment → nudge at +1h → disposition recorded by SMS reply → stage
advances in Athena and GHL.

Every arrow is a phase proof; the slice is done when a real closed outcome is traceable
back through every event to the original source file row.

## G. Risks

1. **Identity resolution errors** — a false merge poisons outreach with someone else's
   history. Mitigation: Splink confidence bands (auto ≥ 0.85, human review 0.60–0.85),
   non-destructive merges, split operation, precision target 0.97 before anything sends.
2. **Bad historical data** — 10 years of garbage in. Mitigation: raw payloads preserved
   verbatim; normalization is staged and re-runnable; per-source parsers fail loudly.
3. **Hallucinated candidate facts** — outreach may only cite attributes with provenance;
   the draft gate validates `cited_attribute_ids` in code. No provenance, no mention.
4. **Deliverability collapse** — dedicated warmed pool, per-mailbox caps and windows,
   verification gate (never send to non-valid), bounce/complaint webhooks → suppression,
   pilot volume ramp.
5. **Compliance/suppression failure** — suppression is a hard code gate before every
   send, plus the Athena 1.0 contacted-list import *before* the first campaign; opt-outs
   land in suppression within 60s (tested).
6. **Runaway AI/enrichment cost** — every call writes `cost_record`; budget caps checked
   before expensive jobs; Batch API + prompt caching; enrichment gated at score ≥ 80,
   signals at ≥ 85. At 1M records, per-record cost discipline is architecture (§7 of the
   brief).
7. **Framework capture** — one load-bearing dependency (Postgres); every vendor behind a
   contract; core never imports adapters; ADR required for any new dependency.
8. **Duplicate outreach** — single canonical send path with idempotent drafts, unique
   membership per campaign, suppression on contact, and the 1.0 retirement import; a
   duplicate-send attempt is refused and logged (tested in Phase 5).
9. **Autonomous-agent errors** — 100% human approval on outreach in the pilot;
   auto-replies limited to 2 classes at ≥ 0.90 confidence; everything else queues for a
   human; every agent action is an inspectable `agent_job`.
10. **Attribution failure** — if outcomes can't be traced, the thesis is unprovable.
    Mitigation: the event stream from day one (rule 3: no state change without an
    event), Athena-owned dispositions and stages (ADR 0004), GHL as a mirror not a
    master.
