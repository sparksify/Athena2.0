-- A removed user keeps their row (approvals and installs reference it) but
-- loses their login; disabled_at records when.
alter table "user" add column "disabled_at" timestamptz;
