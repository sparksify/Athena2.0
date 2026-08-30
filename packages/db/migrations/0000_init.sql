create table "org" (
  "id" uuid primary key default gen_random_uuid(),
  "name" text not null,
  "created_at" timestamptz not null default now()
);

create table "user" (
  "id" uuid primary key,
  "org_id" uuid not null references "org"("id"),
  "email" text not null,
  "full_name" text,
  "role" text not null default 'read_only'
    check ("role" in ('super_admin','fcc_admin','manager','consultant','analyst','read_only')),
  "created_at" timestamptz not null default now()
);
create unique index "user_org_email_idx" on "user" ("org_id", "email");

create table "candidate" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "full_name" text,
  "primary_email" text,
  "primary_phone" text,
  "status" text not null default 'new',
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);
create index "candidate_org_idx" on "candidate" ("org_id");

create table "source_record" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "source_type" text not null,
  "source_batch_id" text,
  "content_hash" text not null,
  "payload" jsonb not null,
  "imported_at" timestamptz not null default now()
);
create unique index "source_record_org_hash_idx" on "source_record" ("org_id", "content_hash");

create table "event" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "type" text not null,
  "entity_type" text not null,
  "entity_id" uuid,
  "actor_type" text not null default 'system'
    check ("actor_type" in ('system','user','agent')),
  "actor_id" uuid,
  "payload" jsonb not null default '{}',
  "correlation_id" uuid,
  "created_at" timestamptz not null default now()
);
create index "event_org_created_idx" on "event" ("org_id", "created_at");
create index "event_entity_idx" on "event" ("entity_type", "entity_id");

create table "agent_job" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "type" text not null,
  "status" text not null default 'queued'
    check ("status" in ('queued','running','succeeded','failed')),
  "payload" jsonb not null default '{}',
  "result" jsonb,
  "error" text,
  "correlation_id" uuid,
  "created_at" timestamptz not null default now(),
  "started_at" timestamptz,
  "finished_at" timestamptz
);
create index "agent_job_org_status_idx" on "agent_job" ("org_id", "status");

create table "cost_record" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "agent_job_id" uuid references "agent_job"("id"),
  "category" text not null
    check ("category" in ('llm','enrichment','verification','message','other')),
  "provider" text not null,
  "amount_usd" numeric(12,6) not null,
  "detail" jsonb not null default '{}',
  "created_at" timestamptz not null default now()
);
create index "cost_record_org_created_idx" on "cost_record" ("org_id", "created_at");

create table "suppression" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "channel" text not null check ("channel" in ('email','sms')),
  "identifier" text not null,
  "reason" text not null,
  "source" text,
  "created_at" timestamptz not null default now()
);
create unique index "suppression_org_channel_identifier_idx"
  on "suppression" ("org_id", "channel", "identifier");

create table "prompt_version" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "name" text not null,
  "version" integer not null,
  "content" text not null,
  "model" text,
  "active" boolean not null default false,
  "created_at" timestamptz not null default now()
);
create unique index "prompt_version_org_name_version_idx"
  on "prompt_version" ("org_id", "name", "version");
