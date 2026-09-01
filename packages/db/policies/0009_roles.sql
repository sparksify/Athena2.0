-- Phase 4: role model in RLS. Consultants see only candidates assigned to
-- them (and none of the financials — 0008 already excludes them there);
-- every other role sees the whole org. assigned_to_user_id is the Phase 4
-- ownership hook; Phase 7's routing machinery becomes its writer.

alter table "candidate" add column "assigned_to_user_id" uuid references "user"("id");
create index "candidate_assigned_idx" on "candidate" ("assigned_to_user_id");

-- SECURITY DEFINER so child-table policies can check candidate visibility
-- without recursive RLS evaluation.
create or replace function public.can_view_candidate(p_candidate_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from candidate c
    where c.id = p_candidate_id
      and c.org_id = public.current_org_id()
      and (public.current_user_role() <> 'consultant'
           or c.assigned_to_user_id = auth.uid())
  )
$$;

-- candidate: consultants read only their own; writes stay admin-shaped
drop policy candidate_isolation on "candidate";
create policy candidate_select on "candidate" for select
  using (org_id = public.current_org_id()
         and (public.current_user_role() <> 'consultant'
              or assigned_to_user_id = auth.uid()));
create policy candidate_write on "candidate" for all
  using (org_id = public.current_org_id()
         and public.current_user_role() in ('super_admin','fcc_admin','manager'))
  with check (org_id = public.current_org_id()
         and public.current_user_role() in ('super_admin','fcc_admin','manager'));

-- candidate-content tables follow candidate visibility for consultants
drop policy score_snapshot_isolation on "score_snapshot";
create policy score_snapshot_select on "score_snapshot" for select
  using (org_id = public.current_org_id() and public.can_view_candidate(candidate_id));

drop policy candidate_attribute_isolation on "candidate_attribute";
create policy candidate_attribute_select on "candidate_attribute" for select
  using (org_id = public.current_org_id() and public.can_view_candidate(candidate_id));

drop policy interaction_isolation on "interaction";
create policy interaction_select on "interaction" for select
  using (org_id = public.current_org_id() and public.can_view_candidate(candidate_id));

drop policy questionnaire_isolation on "questionnaire";
create policy questionnaire_select on "questionnaire" for select
  using (org_id = public.current_org_id() and public.can_view_candidate(candidate_id));

drop policy candidate_source_link_isolation on "candidate_source_link";
create policy candidate_source_link_select on "candidate_source_link" for select
  using (org_id = public.current_org_id() and public.can_view_candidate(candidate_id));

-- identifiers: unlinked ones are back-office data; consultants see only
-- identifiers of their own candidates
drop policy identifier_isolation on "identifier";
create policy identifier_select on "identifier" for select
  using (org_id = public.current_org_id()
         and (public.current_user_role() <> 'consultant'
              or (candidate_id is not null and public.can_view_candidate(candidate_id))));

drop policy email_verification_isolation on "email_verification";
create policy email_verification_select on "email_verification" for select
  using (org_id = public.current_org_id()
         and (public.current_user_role() <> 'consultant'
              or exists (select 1 from identifier i
                         where i.id = identifier_id
                           and i.candidate_id is not null
                           and public.can_view_candidate(i.candidate_id))));

-- identity review is a back-office surface: no consultant access
drop policy identity_review_isolation on "identity_review";
create policy identity_review_select on "identity_review" for all
  using (org_id = public.current_org_id() and public.current_user_role() <> 'consultant')
  with check (org_id = public.current_org_id() and public.current_user_role() <> 'consultant');

-- Writes to candidate-content tables happen through service connections
-- (worker/import) which bypass RLS; UI writes stay confined to the SQL
-- functions and identity_review inserts above.
