-- Default org for the pilot, and a trigger that creates a public."user" row
-- for every new Supabase Auth signup. steve@sparksify.com is the operator.
insert into "org" ("id", "name")
values ('00000000-0000-0000-0000-000000000001', 'FranChoice')
on conflict do nothing;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public."user" (id, org_id, email, role)
  values (
    new.id,
    '00000000-0000-0000-0000-000000000001',
    new.email,
    case when new.email = 'steve@sparksify.com' then 'super_admin' else 'read_only' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
