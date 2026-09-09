-- Phase 7: routing + accountability (ARCHITECTURE.md C.7, docs/design/
-- consultant-accountability.md). Athena owns assignments, appointments,
-- dispositions and nudge timers (ADR 0004); GHL is a mirror.
--
-- Deviations from C.7, all decided by Steve on 2026-09-01:
--   * opportunity.stage uses the FCC CRM vocabulary verbatim (8 stages) plus
--     closed_lost as the losing terminal state.
--   * persona_mailbox is plural — one row per named agent (Tim, Sophie,
--     Claire, Rina); address is nullable until the persona domain exists.
--   * consultant_nudge attaches to an assignment (first-touch ladder that
--     ends in the 48h take-back) OR an appointment (disposition ladder).

create table "persona_mailbox" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "name" text not null,
  "address" text,
  "domain" text,
  "signature_html" text not null default '',
  "daily_cap" integer not null default 50,
  "avatar_slug" text,
  "active" boolean not null default true,
  "created_at" timestamptz not null default now(),
  unique ("org_id", "name")
);

alter table "message" add column "persona_mailbox_id" uuid references "persona_mailbox"("id");

create table "consultant" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "user_id" uuid references "user"("id"),
  "name" text not null,
  "email" text,
  "phone" text,
  "timezone" text not null default 'America/New_York',
  "specialties" jsonb not null default '[]',
  "territories" jsonb not null default '[]',
  "status" text not null default 'active' check ("status" in ('active', 'paused')),
  "max_load" integer not null default 20,
  "ghl_ref" text,
  "avatar_slug" text,
  "created_at" timestamptz not null default now(),
  unique ("org_id", "name")
);
create index "consultant_org_status_idx" on "consultant" ("org_id", "status");
create index "consultant_user_idx" on "consultant" ("user_id");

create table "assignment" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "candidate_id" uuid not null references "candidate"("id"),
  "consultant_id" uuid not null references "consultant"("id"),
  "conversation_id" uuid references "conversation"("id"),
  "persona_mailbox_id" uuid references "persona_mailbox"("id"),
  "reason" jsonb not null default '{}',
  "status" text not null default 'offered'
    check ("status" in ('offered', 'accepted', 'declined', 'reassigned', 'taken_back')),
  "offered_at" timestamptz not null default now(),
  "responded_at" timestamptz,
  "first_touch_at" timestamptz,
  "ended_at" timestamptz,
  "created_at" timestamptz not null default now()
);
create index "assignment_org_consultant_idx" on "assignment" ("org_id", "consultant_id", "status");
create index "assignment_candidate_idx" on "assignment" ("candidate_id");
-- one live assignment per candidate
create unique index "assignment_live_candidate_idx" on "assignment" ("candidate_id")
  where "status" in ('offered', 'accepted');

create table "opportunity" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "candidate_id" uuid not null references "candidate"("id"),
  "consultant_id" uuid not null references "consultant"("id"),
  "assignment_id" uuid references "assignment"("id"),
  "stage" text not null default 'lead_in'
    check ("stage" in ('lead_in', 'contact_made', 'cq_sent', 'cq_received', 'talking_to_zors',
                       'd_day_scheduled', 'contract_out', 'closed_funded', 'closed_lost')),
  "lost_reason" text,
  "value_usd" numeric(12, 2),
  "ghl_ref" text,
  "stage_updated_at" timestamptz not null default now(),
  "created_at" timestamptz not null default now()
);
create index "opportunity_org_stage_idx" on "opportunity" ("org_id", "stage");
create index "opportunity_consultant_idx" on "opportunity" ("consultant_id");
-- one open opportunity per candidate
create unique index "opportunity_open_candidate_idx" on "opportunity" ("candidate_id")
  where "stage" not in ('closed_funded', 'closed_lost');

create table "appointment" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "candidate_id" uuid not null references "candidate"("id"),
  "consultant_id" uuid not null references "consultant"("id"),
  "opportunity_id" uuid references "opportunity"("id"),
  "provider" text not null check ("provider" in ('calendly', 'gcal', 'manual')),
  "external_ref" text not null,
  "kind" text not null default 'consultation' check ("kind" in ('consultation', 'intro', 'other')),
  "starts_at" timestamptz not null,
  "ends_at" timestamptz not null,
  "status" text not null default 'scheduled'
    check ("status" in ('scheduled', 'showed', 'no_show', 'canceled')),
  "created_at" timestamptz not null default now(),
  unique ("provider", "external_ref")
);
create index "appointment_org_time_idx" on "appointment" ("org_id", "starts_at");
create index "appointment_consultant_idx" on "appointment" ("consultant_id", "starts_at");
create index "appointment_candidate_idx" on "appointment" ("candidate_id");

create table "disposition" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "appointment_id" uuid not null references "appointment"("id"),
  "consultant_id" uuid not null references "consultant"("id"),
  "code" text not null,
  "notes" text,
  "recorded_via" text not null check ("recorded_via" in ('sms', 'ui')),
  "recorded_at" timestamptz not null default now(),
  unique ("appointment_id")
);

create table "consultant_nudge" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "consultant_id" uuid not null references "consultant"("id"),
  "assignment_id" uuid references "assignment"("id"),
  "appointment_id" uuid references "appointment"("id"),
  "kind" text not null check ("kind" in ('plus_1h', 'plus_4h', 'plus_24h_manager')),
  "due_at" timestamptz not null,
  "sent_at" timestamptz,
  "response" text,
  "provider_ref" text,
  "created_at" timestamptz not null default now(),
  check ("assignment_id" is not null or "appointment_id" is not null)
);
create unique index "nudge_assignment_kind_idx" on "consultant_nudge" ("assignment_id", "kind")
  where "assignment_id" is not null;
create unique index "nudge_appointment_kind_idx" on "consultant_nudge" ("appointment_id", "kind")
  where "appointment_id" is not null;
create index "nudge_org_due_idx" on "consultant_nudge" ("org_id", "due_at");

-- ---------------------------------------------------------------- RLS
-- Consultants see their own row and their own work; every other role sees
-- the org. Writes from the UI go through server actions on the service
-- connection; RLS here governs what the browser client can read.

create or replace function public.is_own_consultant(p_consultant_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from consultant c
    where c.id = p_consultant_id
      and c.org_id = public.current_org_id()
      and (public.current_user_role() <> 'consultant' or c.user_id = auth.uid())
  )
$$;

alter table "persona_mailbox" enable row level security;
create policy "persona_mailbox_org" on "persona_mailbox" for all
  using ("org_id" = current_org_id()) with check ("org_id" = current_org_id());

alter table "consultant" enable row level security;
create policy "consultant_select" on "consultant" for select
  using ("org_id" = current_org_id()
         and (public.current_user_role() <> 'consultant' or "user_id" = auth.uid()));
create policy "consultant_write" on "consultant" for all
  using ("org_id" = current_org_id() and public.current_user_role() in ('super_admin', 'fcc_admin', 'manager'))
  with check ("org_id" = current_org_id() and public.current_user_role() in ('super_admin', 'fcc_admin', 'manager'));

alter table "assignment" enable row level security;
create policy "assignment_select" on "assignment" for select
  using ("org_id" = current_org_id() and public.is_own_consultant("consultant_id"));

alter table "opportunity" enable row level security;
create policy "opportunity_select" on "opportunity" for select
  using ("org_id" = current_org_id() and public.is_own_consultant("consultant_id"));

alter table "appointment" enable row level security;
create policy "appointment_select" on "appointment" for select
  using ("org_id" = current_org_id() and public.is_own_consultant("consultant_id"));

alter table "disposition" enable row level security;
create policy "disposition_select" on "disposition" for select
  using ("org_id" = current_org_id() and public.is_own_consultant("consultant_id"));

alter table "consultant_nudge" enable row level security;
create policy "consultant_nudge_select" on "consultant_nudge" for select
  using ("org_id" = current_org_id() and public.is_own_consultant("consultant_id"));

grant select, insert, update on "persona_mailbox", "consultant", "assignment", "opportunity",
  "appointment", "disposition", "consultant_nudge" to authenticated;

-- ---------------------------------------------------------------- seeds
-- The four named agents and the active consultant roster (names from the
-- Athena 1.0 command center). Addresses/phones arrive with the roster.
insert into "persona_mailbox" ("org_id", "name", "avatar_slug", "signature_html")
select '00000000-0000-0000-0000-000000000001', n, s, ''
from (values
  ('Tim', 'agent-tim'), ('Sophie', 'agent-sophie'), ('Claire', 'agent-claire'), ('Rina', 'agent-rina')
) as p(n, s)
where exists (select 1 from "org" where "id" = '00000000-0000-0000-0000-000000000001');

insert into "consultant" ("org_id", "name", "avatar_slug", "max_load")
select '00000000-0000-0000-0000-000000000001', n, s, l
from (values
  ('Rob Petka', 'rob-petka', 32), ('Adam Gruen', 'adam-gruen', 24),
  ('Paulette Callender', 'paulette-callender', 20), ('Michael Stavrinakis', 'michael-stavrinakis', 20),
  ('Lane Klastow', 'lane-klastow', 20), ('Dave Sullivan', 'dave-sullivan', 18),
  ('Mariel Miller', 'mariel-miller', 18), ('Stephen Rotay', 'stephen-rotay', 16),
  ('Chris Davenport', 'chris-davenport', 16), ('Aaron Bakken', 'aaron-bakken', 16)
) as c(n, s, l)
where exists (select 1 from "org" where "id" = '00000000-0000-0000-0000-000000000001');
