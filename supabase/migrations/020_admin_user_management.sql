alter table public.profiles
  add column if not exists phone text,
  add column if not exists suspended boolean not null default false,
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_phone_algerian_format'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_phone_algerian_format
      check (phone is null or phone ~ '^\+213[567][0-9]{8}$');
  end if;
end;
$$;

grant update (phone) on public.profiles to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_phone text;
begin
  normalized_phone := regexp_replace(
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    '[[:space:]()-]',
    '',
    'g'
  );
  if normalized_phone ~ '^0[567][0-9]{8}$' then
    normalized_phone := '+213' || substr(normalized_phone, 2);
  end if;
  if normalized_phone !~ '^\+213[567][0-9]{8}$' then
    raise exception 'Numéro de téléphone algérien obligatoire et invalide.'
      using errcode = '22023';
  end if;

  insert into public.profiles (user_id, first_name, last_name, role, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    'user',
    normalized_phone
  );
  return new;
end;
$$;

create or replace function public.admin_list_users(
  p_search text default '',
  p_status text default 'all',
  p_page integer default 1
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  result_count integer;
  users_json jsonb;
  normalized_search text := btrim(coalesce(p_search, ''));
begin
  if not public.is_admin() then
    raise exception 'Accès administrateur requis.' using errcode = '42501';
  end if;
  if p_status not in ('all', 'active', 'suspended') or p_page < 1 then
    raise exception 'Filtres de recherche invalides.' using errcode = '22023';
  end if;

  select count(*) into result_count
  from public.profiles p
  join auth.users u on u.id = p.user_id
  where (p_status = 'all'
      or (p_status = 'active' and not p.suspended)
      or (p_status = 'suspended' and p.suspended))
    and (
      normalized_search = ''
      or concat_ws(' ', p.first_name, p.last_name) ilike '%' || normalized_search || '%'
      or p.first_name ilike '%' || normalized_search || '%'
      or p.last_name ilike '%' || normalized_search || '%'
      or u.email ilike '%' || normalized_search || '%'
      or p.phone ilike '%' || normalized_search || '%'
    );

  select coalesce(jsonb_agg(to_jsonb(user_page) order by user_page.created_at desc), '[]'::jsonb)
  into users_json
  from (
    select
      p.user_id,
      p.first_name,
      p.last_name,
      u.email,
      p.phone,
      u.created_at,
      p.role,
      p.suspended,
      p.suspended_at,
      p.suspended_reason
    from public.profiles p
    join auth.users u on u.id = p.user_id
    where (p_status = 'all'
        or (p_status = 'active' and not p.suspended)
        or (p_status = 'suspended' and p.suspended))
      and (
        normalized_search = ''
        or concat_ws(' ', p.first_name, p.last_name) ilike '%' || normalized_search || '%'
        or p.first_name ilike '%' || normalized_search || '%'
        or p.last_name ilike '%' || normalized_search || '%'
        or u.email ilike '%' || normalized_search || '%'
        or p.phone ilike '%' || normalized_search || '%'
      )
    order by u.created_at desc
    limit 25
    offset (p_page - 1) * 25
  ) as user_page;

  return jsonb_build_object('total', result_count, 'users', users_json);
end;
$$;

create or replace function public.admin_set_user_suspension(
  p_user_id uuid,
  p_suspended boolean,
  p_reason text default null,
  p_confirmation text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_admin_id uuid := auth.uid();
  target_profile public.profiles%rowtype;
  target_email text;
  active_admin_count integer;
  normalized_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
begin
  if not public.is_admin() or current_admin_id is null then
    raise exception 'Accès administrateur requis.' using errcode = '42501';
  end if;
  if current_admin_id = p_user_id and p_suspended then
    raise exception 'Vous ne pouvez pas désactiver votre propre compte.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('admin-active-user-suspensions'));
  select * into target_profile
  from public.profiles
  where user_id = p_user_id
  for update;
  if not found then
    raise exception 'Utilisateur introuvable.' using errcode = 'P0002';
  end if;

  select email into target_email from auth.users where id = p_user_id;

  if target_profile.suspended = p_suspended then
    return jsonb_build_object('user_id', p_user_id, 'suspended', p_suspended);
  end if;

  if p_suspended and target_profile.role = 'admin' then
    if coalesce(p_confirmation, '') <> 'DESACTIVER ' || lower(coalesce(target_email, '')) then
      raise exception 'Confirmation renforcée requise.' using errcode = '42501';
    end if;
    select count(*) into active_admin_count
    from public.profiles
    where role = 'admin' and not suspended;
    if active_admin_count <= 1 then
      raise exception 'Impossible de désactiver le dernier administrateur actif.' using errcode = '42501';
    end if;
  end if;

  update public.profiles
  set suspended = p_suspended,
      suspended_at = case when p_suspended then now() else null end,
      suspended_reason = case when p_suspended then normalized_reason else null end,
      updated_at = now()
  where user_id = p_user_id;

  if p_suspended then
    delete from auth.sessions where user_id = p_user_id;
  end if;

  insert into public.audit_log (actor_id, action, target, metadata)
  values (
    current_admin_id,
    case when p_suspended then 'admin.user_suspended' else 'admin.user_reactivated' end,
    p_user_id::text,
    jsonb_build_object('email', target_email, 'reason', case when p_suspended then normalized_reason else null end)
  );

  return jsonb_build_object('user_id', p_user_id, 'suspended', p_suspended);
end;
$$;

revoke all on function public.admin_list_users(text, text, integer) from public, anon;
grant execute on function public.admin_list_users(text, text, integer) to authenticated;
revoke all on function public.admin_set_user_suspension(uuid, boolean, text, text) from public, anon;
grant execute on function public.admin_set_user_suspension(uuid, boolean, text, text) to authenticated;

notify pgrst, 'reload schema';
