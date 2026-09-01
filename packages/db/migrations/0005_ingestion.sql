-- Phase 1: identifiers extracted at import time (candidate_id stays null until
-- Phase 2 identity resolution) and email verification results.

create table "identifier" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "candidate_id" uuid references "candidate"("id"),
  "type" text not null check ("type" in ('email','phone','linkedin','postal')),
  "value_normalized" text not null,
  "value_raw" text not null,
  "first_source_record_id" uuid references "source_record"("id"),
  "created_at" timestamptz not null default now()
);
create unique index "identifier_org_type_value_idx"
  on "identifier" ("org_id", "type", "value_normalized");
create index "identifier_candidate_idx" on "identifier" ("candidate_id");

create table "email_verification" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "identifier_id" uuid not null references "identifier"("id"),
  "provider" text not null,
  "result" text not null check ("result" in ('valid','invalid','risky','unknown')),
  "checked_at" timestamptz not null default now(),
  "raw" jsonb not null default '{}'
);
create index "email_verification_identifier_idx" on "email_verification" ("identifier_id");

alter table "identifier" enable row level security;
create policy identifier_isolation on "identifier"
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

alter table "email_verification" enable row level security;
create policy email_verification_isolation on "email_verification"
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
