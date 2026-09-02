-- Phase 5: outbound + suppression enforcement surface (ARCHITECTURE.md C.6).
-- message lands now (not Phase 6) because the send path writes it and webhook
-- idempotency depends on its UNIQUE(provider, provider_message_id);
-- conversation_id is added by the Phase 6 migration.

create table "mailbox" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "provider" text not null check ("provider" in ('smartlead', 'gmail')),
  "address" text not null,
  "domain" text not null,
  "daily_cap" integer not null default 30,
  "status" text not null default 'warming' check ("status" in ('warming', 'active', 'paused')),
  "external_ref" text,
  "created_at" timestamptz not null default now(),
  unique ("org_id", "address")
);
create index "mailbox_org_idx" on "mailbox" ("org_id");

create table "angle" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "name" text not null,
  "description" text not null,
  "prompt_version_id" uuid references "prompt_version"("id"),
  "active" boolean not null default true,
  "created_at" timestamptz not null default now(),
  unique ("org_id", "name")
);

create table "campaign" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "name" text not null,
  "status" text not null default 'draft' check ("status" in ('draft', 'active', 'paused', 'done')),
  "cohort_definition" jsonb not null default '{}'::jsonb,
  "send_window" jsonb not null default '{"days":[1,2,3,4,5],"startHour":8,"endHour":17,"timezone":"America/Chicago"}'::jsonb,
  "created_at" timestamptz not null default now()
);
create index "campaign_org_idx" on "campaign" ("org_id");

create table "campaign_membership" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "campaign_id" uuid not null references "campaign"("id"),
  "candidate_id" uuid not null references "candidate"("id"),
  "status" text not null default 'pending' check ("status" in ('pending', 'drafted', 'sent', 'replied', 'excluded')),
  "created_at" timestamptz not null default now(),
  unique ("campaign_id", "candidate_id")
);
create index "campaign_membership_org_idx" on "campaign_membership" ("org_id");

create table "message" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "candidate_id" uuid references "candidate"("id"),
  "direction" text not null check ("direction" in ('inbound', 'outbound')),
  "provider" text not null,
  "provider_message_id" text not null,
  "mailbox_id" uuid references "mailbox"("id"),
  "subject" text,
  "body_text" text,
  "agent_job_id" uuid references "agent_job"("id"),
  "occurred_at" timestamptz not null default now(),
  unique ("provider", "provider_message_id")
);
create index "message_org_candidate_idx" on "message" ("org_id", "candidate_id");

create table "outreach_draft" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "campaign_id" uuid not null references "campaign"("id"),
  "candidate_id" uuid not null references "candidate"("id"),
  "angle_id" uuid not null references "angle"("id"),
  "mailbox_id" uuid references "mailbox"("id"),
  "subject" text not null,
  "body_text" text not null,
  "cited_attribute_ids" uuid[] not null default '{}',
  "status" text not null default 'draft'
    check ("status" in ('draft', 'approved', 'rejected', 'scheduled', 'sent', 'blocked')),
  "blocked_reason" text,
  "approved_by" uuid references "user"("id"),
  "agent_job_id" uuid references "agent_job"("id"),
  "sent_message_id" uuid references "message"("id"),
  "created_at" timestamptz not null default now()
);
create index "outreach_draft_org_status_idx" on "outreach_draft" ("org_id", "status");
create index "outreach_draft_campaign_idx" on "outreach_draft" ("campaign_id");

-- Delivery-feedback interactions (bounce/complaint/opt-out) join the timeline.
alter table "interaction" drop constraint "interaction_type_check";
alter table "interaction" add constraint "interaction_type_check" check ("type" in
  ('email_sent','email_reply','email_bounce','email_complaint','opt_out',
   'sms','call','meeting','presentation','territory_check','import_history'));

-- RLS: same org-isolation model as every other table.
alter table "mailbox" enable row level security;
alter table "angle" enable row level security;
alter table "campaign" enable row level security;
alter table "campaign_membership" enable row level security;
alter table "message" enable row level security;
alter table "outreach_draft" enable row level security;

create policy "mailbox_org" on "mailbox" for all
  using ("org_id" = current_org_id()) with check ("org_id" = current_org_id());
create policy "angle_org" on "angle" for all
  using ("org_id" = current_org_id()) with check ("org_id" = current_org_id());
create policy "campaign_org" on "campaign" for all
  using ("org_id" = current_org_id()) with check ("org_id" = current_org_id());
create policy "campaign_membership_org" on "campaign_membership" for all
  using ("org_id" = current_org_id()) with check ("org_id" = current_org_id());
create policy "message_org" on "message" for all
  using ("org_id" = current_org_id()) with check ("org_id" = current_org_id());
create policy "outreach_draft_org" on "outreach_draft" for all
  using ("org_id" = current_org_id()) with check ("org_id" = current_org_id());

grant select, insert, update on "mailbox", "angle", "campaign", "campaign_membership",
  "message", "outreach_draft" to authenticated;

-- Starter angle so drafting has a target; copy direction lands with Steve's
-- input. Conditional so environments without the seed org (tests) still apply.
insert into "angle" ("org_id", "name", "description", "active")
select
  '00000000-0000-0000-0000-000000000001',
  'reactivation-checkin',
  'Personal check-in referencing the candidate''s prior franchise exploration; low-pressure, one question, no pitch. Tone: a person who remembers them.',
  true
where exists (select 1 from "org" where "id" = '00000000-0000-0000-0000-000000000001')
on conflict do nothing;
