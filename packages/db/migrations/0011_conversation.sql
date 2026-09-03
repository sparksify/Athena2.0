-- Phase 6: conversation engine (ARCHITECTURE.md C.5).
-- conversation is the state machine; message gains its conversation link and
-- the classifier's output. Every transition emits an event (rule 3).

create table "conversation" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "candidate_id" uuid not null references "candidate"("id"),
  "channel" text not null default 'email' check ("channel" in ('email', 'sms')),
  "state" text not null default 'open'
    check ("state" in ('open', 'awaiting_candidate', 'awaiting_human', 'closed')),
  "flagged" boolean not null default false,
  "assigned_user_id" uuid references "user"("id"),
  "opened_at" timestamptz not null default now(),
  "last_message_at" timestamptz not null default now(),
  "created_at" timestamptz not null default now()
);
create index "conversation_org_queue_idx" on "conversation" ("org_id", "state", "flagged", "last_message_at");
create index "conversation_candidate_idx" on "conversation" ("candidate_id");

alter table "message"
  add column "conversation_id" uuid references "conversation"("id"),
  add column "classification" text,
  add column "classification_confidence" numeric(4, 3);
create index "message_conversation_idx" on "message" ("conversation_id", "occurred_at");

alter table "conversation" enable row level security;
create policy "conversation_org" on "conversation" for all
  using ("org_id" = current_org_id()) with check ("org_id" = current_org_id());
grant select, insert, update on "conversation" to authenticated;
