-- Phase 2: probabilistic identity review queue and non-destructive merge/split.
-- Merge and split are SQL functions so the operator UI (PostgREST RPC) and the
-- worker's auto-link path share exactly one implementation. SECURITY INVOKER:
-- RLS org isolation applies; role checks below gate human callers.

alter table "candidate" add column "merged_into_id" uuid references "candidate"("id");

create table "identity_review" (
  "id" uuid primary key default gen_random_uuid(),
  "org_id" uuid not null references "org"("id"),
  "candidate_a_id" uuid not null references "candidate"("id"),
  "candidate_b_id" uuid not null references "candidate"("id"),
  "score" numeric not null,
  "method" text not null check ("method" in ('splink','manual')),
  "status" text not null default 'pending'
    check ("status" in ('pending','merged','rejected','split')),
  "evidence" jsonb not null default '{}',
  "merge_detail" jsonb,
  "reviewed_by" uuid,
  "reviewed_at" timestamptz,
  "created_at" timestamptz not null default now(),
  check ("candidate_a_id" <> "candidate_b_id")
);
-- one open review per unordered pair
create unique index "identity_review_pending_pair_idx"
  on "identity_review" (least("candidate_a_id","candidate_b_id"),
                        greatest("candidate_a_id","candidate_b_id"))
  where "status" = 'pending';
create index "identity_review_status_idx" on "identity_review" ("org_id", "status");

alter table "identity_review" enable row level security;
create policy identity_review_isolation on "identity_review"
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- Human callers must hold a merge-capable role. Service connections
-- (worker/postgres, auth.uid() is null) are trusted; anon has no execute grant.
create or replace function public.assert_identity_reviewer()
returns void language plpgsql as $$
declare v_role text;
begin
  if auth.uid() is not null then
    select role into v_role from public."user" where id = auth.uid();
    if v_role is null or v_role not in ('super_admin','fcc_admin','manager') then
      raise exception 'role % may not review identities', coalesce(v_role, 'none');
    end if;
  end if;
end;
$$;

-- Merge candidate_b into candidate_a. Non-destructive: everything moved is
-- recorded in merge_detail so split_merge can reverse it exactly.
create or replace function public.merge_candidates(p_review_id uuid)
returns void language plpgsql as $$
declare
  r record;
  v_prior_status text;
  v_dropped jsonb;
  v_link_ids uuid[];
  v_identifier_ids uuid[];
begin
  perform public.assert_identity_reviewer();
  select * into r from identity_review where id = p_review_id for update;
  if not found then raise exception 'identity_review % not found', p_review_id; end if;
  if r.status <> 'pending' then raise exception 'review is %, not pending', r.status; end if;

  -- links b shares with a would violate the unique pair index: record, then drop
  select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) into v_dropped
    from candidate_source_link l
    where l.candidate_id = r.candidate_b_id
      and l.source_record_id in
        (select source_record_id from candidate_source_link where candidate_id = r.candidate_a_id);
  delete from candidate_source_link
    where candidate_id = r.candidate_b_id
      and source_record_id in
        (select source_record_id from candidate_source_link where candidate_id = r.candidate_a_id);

  select coalesce(array_agg(id), '{}') into v_link_ids
    from candidate_source_link where candidate_id = r.candidate_b_id;
  update candidate_source_link set candidate_id = r.candidate_a_id
    where candidate_id = r.candidate_b_id;

  select coalesce(array_agg(id), '{}') into v_identifier_ids
    from identifier where candidate_id = r.candidate_b_id;
  update identifier set candidate_id = r.candidate_a_id
    where candidate_id = r.candidate_b_id;

  select status into v_prior_status from candidate where id = r.candidate_b_id;
  update candidate
    set merged_into_id = r.candidate_a_id, status = 'merged', updated_at = now()
    where id = r.candidate_b_id;

  update identity_review
    set status = 'merged', reviewed_by = auth.uid(), reviewed_at = now(),
        merge_detail = jsonb_build_object(
          'identifier_ids', to_jsonb(v_identifier_ids),
          'link_ids', to_jsonb(v_link_ids),
          'dropped_links', v_dropped,
          'prior_status', v_prior_status)
    where id = p_review_id;

  insert into event (org_id, type, entity_type, entity_id, actor_type, actor_id, payload)
  values (r.org_id, 'identity.merged', 'candidate', r.candidate_a_id,
          case when auth.uid() is null then 'system' else 'user' end, auth.uid(),
          jsonb_build_object('merged_candidate_id', r.candidate_b_id, 'review_id', p_review_id,
                             'score', r.score, 'method', r.method));
end;
$$;

-- Reverse a merge exactly, reviving candidate_b.
create or replace function public.split_merge(p_review_id uuid)
returns void language plpgsql as $$
declare
  r record;
  d record;
begin
  perform public.assert_identity_reviewer();
  select * into r from identity_review where id = p_review_id for update;
  if not found then raise exception 'identity_review % not found', p_review_id; end if;
  if r.status <> 'merged' then raise exception 'review is %, not merged', r.status; end if;

  update candidate_source_link set candidate_id = r.candidate_b_id
    where id in (select (jsonb_array_elements_text(r.merge_detail->'link_ids'))::uuid);
  update identifier set candidate_id = r.candidate_b_id
    where id in (select (jsonb_array_elements_text(r.merge_detail->'identifier_ids'))::uuid);

  for d in select * from jsonb_to_recordset(r.merge_detail->'dropped_links')
      as x(id uuid, org_id uuid, candidate_id uuid, source_record_id uuid,
           confidence numeric, method text, agent_job_id uuid)
  loop
    insert into candidate_source_link (id, org_id, candidate_id, source_record_id, confidence, method, agent_job_id)
    values (d.id, d.org_id, d.candidate_id, d.source_record_id, d.confidence, d.method, d.agent_job_id)
    on conflict do nothing;
  end loop;

  update candidate
    set merged_into_id = null,
        status = coalesce(r.merge_detail->>'prior_status', 'new'),
        updated_at = now()
    where id = r.candidate_b_id;

  update identity_review
    set status = 'split', reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_review_id;

  insert into event (org_id, type, entity_type, entity_id, actor_type, actor_id, payload)
  values (r.org_id, 'identity.split', 'candidate', r.candidate_b_id,
          case when auth.uid() is null then 'system' else 'user' end, auth.uid(),
          jsonb_build_object('split_from_candidate_id', r.candidate_a_id, 'review_id', p_review_id));
end;
$$;

create or replace function public.reject_review(p_review_id uuid)
returns void language plpgsql as $$
declare r record;
begin
  perform public.assert_identity_reviewer();
  select * into r from identity_review where id = p_review_id for update;
  if not found then raise exception 'identity_review % not found', p_review_id; end if;
  if r.status <> 'pending' then raise exception 'review is %, not pending', r.status; end if;
  update identity_review
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_review_id;
  insert into event (org_id, type, entity_type, entity_id, actor_type, actor_id, payload)
  values (r.org_id, 'identity.review_rejected', 'identity_review', p_review_id,
          case when auth.uid() is null then 'system' else 'user' end, auth.uid(),
          jsonb_build_object('candidate_a_id', r.candidate_a_id, 'candidate_b_id', r.candidate_b_id));
end;
$$;
