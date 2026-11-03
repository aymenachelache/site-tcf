create or replace function public.admin_list_entitlements()
returns table (
  id uuid,
  user_id uuid,
  email text,
  plan_id uuid,
  plan_name text,
  exam_ids uuid[],
  credits_remaining integer,
  starts_at timestamptz,
  expires_at timestamptz,
  revoked boolean
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès administrateur requis.' using errcode = '42501';
  end if;

  return query
  select e.id, e.user_id, coalesce(u.email, '')::text, e.plan_id, p.name,
         e.exam_ids, e.credits_remaining, e.starts_at, e.expires_at, e.revoked
  from public.entitlements e
  left join auth.users u on u.id = e.user_id
  left join public.plans p on p.id = e.plan_id
  order by e.created_at desc
  limit 200;
end;
$$;

revoke all on function public.admin_list_entitlements() from public, anon;
grant execute on function public.admin_list_entitlements() to authenticated;
