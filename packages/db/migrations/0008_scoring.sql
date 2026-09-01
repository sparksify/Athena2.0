-- Phase 3: deterministic scoring, plus the read-side tables its factors score
-- against (candidate_attribute, questionnaire, financial_profile, interaction —
-- populated by history imports and later phases; created here because scoring
-- is the first reader).

create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public."user" where id = auth.uid()
$$;

-- Derived facts with provenance. Never updated: corrections supersede.
create table "candidate_attribute" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "candidate_id" uuid not null references "candidate"("id"),
  "key" text not null,
  "value" jsonb not null,
  "confidence" numeric,
  "source_record_id" uuid references "source_record"("id"),
  "agent_job_id" uuid references "agent_job"("id"),
  "superseded_by_id" uuid references "candidate_attribute"("id"),
  "created_at" timestamptz not null default now(),
  check ("source_record_id" is not null or "agent_job_id" is not null)  -- provenance rule
);
create index "candidate_attribute_candidate_key_idx"
  on "candidate_attribute" ("candidate_id", "key");

create table "questionnaire" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "candidate_id" uuid not null references "candidate"("id"),
  "source_record_id" uuid references "source_record"("id"),
  "kind" text not null check ("kind" in ('cq_complete','cq_partial')),
  "answers" jsonb not null default '{}',
  "completed_at" timestamptz,
  "created_at" timestamptz not null default now()
);
create index "questionnaire_candidate_idx" on "questionnaire" ("candidate_id");

-- Financial data isolated in its own table so access control is a table
-- policy (BRIEF §18: sensitive financial information requires access control).
create table "financial_profile" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "candidate_id" uuid not null unique references "candidate"("id"),
  "liquidity_usd" numeric,
  "net_worth_usd" numeric,
  "investable_usd" numeric,
  "source_record_id" uuid references "source_record"("id"),
  "agent_job_id" uuid references "agent_job"("id"),
  "updated_at" timestamptz not null default now(),
  "created_at" timestamptz not null default now()
);

-- One timeline: historical interactions from imports and live activity later.
create table "interaction" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "candidate_id" uuid not null references "candidate"("id"),
  "type" text not null check ("type" in
    ('email_sent','email_reply','sms','call','meeting','presentation','territory_check','import_history')),
  "direction" text not null check ("direction" in ('inbound','outbound')),
  "occurred_at" timestamptz not null,
  "consultant_id" uuid,
  "campaign_id" uuid,
  "payload" jsonb not null default '{}',
  "source_record_id" uuid references "source_record"("id"),
  "provider_ref" text,
  "created_at" timestamptz not null default now()
);
create index "interaction_candidate_time_idx" on "interaction" ("candidate_id", "occurred_at");

create table "score_snapshot" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "candidate_id" uuid not null references "candidate"("id"),
  "score" integer not null,
  "version" integer not null,
  "factors" jsonb not null,   -- [{factor, points, reason}] — the explanation
  "created_at" timestamptz not null default now()
);
create index "score_snapshot_candidate_idx" on "score_snapshot" ("candidate_id", "created_at");

alter table "candidate" add column "current_score" integer;

-- RLS: org isolation; financial_profile additionally requires a finance-capable role to read.
alter table "candidate_attribute" enable row level security;
create policy candidate_attribute_isolation on "candidate_attribute"
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

alter table "questionnaire" enable row level security;
create policy questionnaire_isolation on "questionnaire"
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

alter table "financial_profile" enable row level security;
create policy financial_profile_read on "financial_profile" for select
  using (org_id = public.current_org_id()
         and public.current_user_role() in ('super_admin','fcc_admin','manager','analyst'));
create policy financial_profile_write on "financial_profile" for all
  using (org_id = public.current_org_id()
         and public.current_user_role() in ('super_admin','fcc_admin','manager'))
  with check (org_id = public.current_org_id()
         and public.current_user_role() in ('super_admin','fcc_admin','manager'));

alter table "interaction" enable row level security;
create policy interaction_isolation on "interaction"
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

alter table "score_snapshot" enable row level security;
create policy score_snapshot_isolation on "score_snapshot"
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
