-- OAuth credential for a vendor app installed on the org's account. First
-- use: the GoHighLevel marketplace app installed on the FCC agency, whose
-- agency access token mints sub-account tokens for every location (the
-- agency private-integration token cannot). Service connection only: RLS
-- on, no policies, nothing granted to authenticated.
create table "integration_credential" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "provider" text not null,
  "external_id" text,
  "access_token" text not null,
  "refresh_token" text,
  "expires_at" timestamptz,
  "scope" text,
  "installed_by" uuid references "user"("id"),
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  unique ("org_id", "provider")
);
alter table "integration_credential" enable row level security;
