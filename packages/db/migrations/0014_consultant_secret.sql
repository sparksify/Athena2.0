-- Per-consultant GoHighLevel sub-account token. An agency-level private
-- integration cannot read inside a sub-account (GHL offers it no contact,
-- conversation or opportunity scopes), so until the marketplace OAuth app
-- mints sub-account tokens, each consultant's own private-integration token
-- is pasted on the roster. Service connection only: RLS on, no policies,
-- nothing granted to authenticated, so the browser client and Athena Voice
-- can never read it.
create table "consultant_secret" (
  "consultant_id" uuid primary key references "consultant"("id") on delete cascade,
  "org_id" uuid not null references "org"("id"),
  "ghl_token" text,
  "updated_at" timestamptz not null default now()
);
alter table "consultant_secret" enable row level security;
