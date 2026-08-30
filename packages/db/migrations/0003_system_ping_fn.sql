-- Phase 0 proof: transactional ping callable by an authenticated operator via
-- PostgREST RPC. Writes agent_job + $0 cost_record + event atomically (a SQL
-- function body is one transaction). SECURITY INVOKER, so RLS org policies
-- apply to every insert. The Trigger.dev system.ping task is the durable-job
-- path once TRIGGER_* credentials are configured.
create or replace function public.system_ping()
returns uuid
language plpgsql
as $$
declare
  v_org uuid := public.current_org_id();
  v_job uuid;
  v_corr uuid := gen_random_uuid();
begin
  if v_org is null then
    raise exception 'authenticated user has no org membership';
  end if;

  insert into "agent_job" (org_id, type, status, started_at, finished_at, result, correlation_id)
  values (v_org, 'system.ping', 'succeeded', now(), now(), '{"pong": true}'::jsonb, v_corr)
  returning id into v_job;

  insert into "cost_record" (org_id, agent_job_id, category, provider, amount_usd, detail)
  values (v_org, v_job, 'other', 'system', 0, '{"task": "system.ping"}'::jsonb);

  insert into "event" (org_id, type, entity_type, entity_id, actor_type, actor_id, correlation_id)
  values (v_org, 'system.ping.completed', 'agent_job', v_job, 'user', auth.uid(), v_corr);

  return v_job;
end;
$$;
