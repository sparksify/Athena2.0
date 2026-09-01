-- Phase 1 guardrails (Steve, 2026-09-01): deterministic-only identity in
-- ingestion — exact normalized email/phone, content-hash dedupe. Candidates
-- are created/matched deterministically; fuzzy matching waits for Phase 2.
-- Import reports are stored structurally on import_batch for the UI.

alter table "candidate" add column "city" text;
alter table "candidate" add column "state" text;

create table "import_batch" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "source_type" text not null,
  "filename" text not null,
  "status" text not null default 'running' check ("status" in ('running','completed','failed')),
  "report" jsonb,
  "started_at" timestamptz not null default now(),
  "finished_at" timestamptz,
  "created_at" timestamptz not null default now()
);

-- source_batch_id becomes a real FK to import_batch (column empty pre-pilot)
alter table "source_record"
  alter column "source_batch_id" type uuid using "source_batch_id"::uuid;
alter table "source_record"
  add constraint "source_record_batch_fk"
  foreign key ("source_batch_id") references "import_batch"("id");
-- normalized output of the parser, kept beside the raw payload for traceability
alter table "source_record" add column "normalized" jsonb;

create table "candidate_source_link" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "candidate_id" uuid not null references "candidate"("id"),
  "source_record_id" uuid not null references "source_record"("id"),
  "confidence" numeric not null default 1.0,
  "method" text not null check ("method" in ('exact','splink','manual','agent')),
  "agent_job_id" uuid references "agent_job"("id"),
  "created_at" timestamptz not null default now()
);
create unique index "candidate_source_link_pair_idx"
  on "candidate_source_link" ("candidate_id", "source_record_id");
create index "candidate_source_link_source_idx"
  on "candidate_source_link" ("source_record_id");

alter table "import_batch" enable row level security;
create policy import_batch_isolation on "import_batch"
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

alter table "candidate_source_link" enable row level security;
create policy candidate_source_link_isolation on "candidate_source_link"
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
