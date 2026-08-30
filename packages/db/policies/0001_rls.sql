-- Org isolation on every table. Authenticated users may only touch rows in
-- their own org, resolved from their "user" row (id = auth.uid()).
-- The service role and table owner (worker/db connections) bypass RLS.

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public."user" where id = auth.uid()
$$;

-- org: members can see their own org row only.
alter table "org" enable row level security;
create policy org_isolation on "org"
  using (id = public.current_org_id());

-- user: members can see users in their org; no self-service writes.
alter table "user" enable row level security;
create policy user_isolation on "user"
  for select using (org_id = public.current_org_id());

alter table "candidate" enable row level security;
create policy candidate_isolation on "candidate"
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

alter table "source_record" enable row level security;
create policy source_record_isolation on "source_record"
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

alter table "event" enable row level security;
create policy event_isolation on "event"
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

alter table "agent_job" enable row level security;
create policy agent_job_isolation on "agent_job"
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

alter table "cost_record" enable row level security;
create policy cost_record_isolation on "cost_record"
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

alter table "suppression" enable row level security;
create policy suppression_isolation on "suppression"
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

alter table "prompt_version" enable row level security;
create policy prompt_version_isolation on "prompt_version"
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
