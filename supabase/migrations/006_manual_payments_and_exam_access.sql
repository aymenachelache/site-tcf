grant select on public.payment_requests, public.entitlements to authenticated;
grant insert (user_id, email, plan_id, amount_dzd, reference)
  on public.payment_requests to authenticated;
grant update, delete on public.payment_requests to authenticated;
grant insert, update, delete on public.entitlements to authenticated;
grant select, insert on public.audit_log to authenticated;
grant select on public.plans to anon, authenticated;
alter table public.attempts alter column user_id drop not null;

create or replace function public.admin_process_payment(
  p_request_id uuid,
  p_action text,
  p_receipt_ref text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  payment public.payment_requests%rowtype;
  selected_plan public.plans%rowtype;
  new_entitlement_id uuid;
  normalized_receipt text := nullif(btrim(p_receipt_ref), '');
  normalized_note text := nullif(btrim(p_note), '');
begin
  if not public.is_admin() then
    raise exception 'Accès administrateur requis.' using errcode = '42501';
  end if;

  if p_action not in ('approve', 'reject') then
    raise exception 'Action de paiement invalide.' using errcode = '22023';
  end if;

  select * into payment
  from public.payment_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Demande de paiement introuvable.' using errcode = 'P0002';
  end if;
  if payment.status <> 'pending' then
    raise exception 'Cette demande a déjà été traitée.' using errcode = '22023';
  end if;

  if p_action = 'reject' then
    if normalized_note is null then
      raise exception 'Le motif du refus est obligatoire.' using errcode = '22023';
    end if;

    update public.payment_requests
    set status = 'rejected',
        admin_note = normalized_note,
        processed_by = auth.uid(),
        processed_at = now()
    where id = payment.id;

    insert into public.audit_log (actor_id, action, target, metadata)
    values (
      auth.uid(),
      'payment.rejected',
      payment.id::text,
      jsonb_build_object('user_id', payment.user_id, 'email', payment.email, 'reason', normalized_note)
    );
    return null;
  end if;

  if normalized_receipt is null then
    raise exception 'Le numéro de transaction du reçu est obligatoire.' using errcode = '22023';
  end if;

  select * into selected_plan
  from public.plans
  where id = payment.plan_id;

  if not found then
    raise exception 'Le forfait associé est introuvable.' using errcode = 'P0002';
  end if;
  if cardinality(selected_plan.exam_ids) = 0 and coalesce(selected_plan.exam_credits, 0) = 0 then
    raise exception 'Ce forfait ne contient aucun examen ni crédit.' using errcode = '22023';
  end if;

  insert into public.entitlements (
    user_id, plan_id, payment_request_id, exam_ids, credits_remaining, expires_at
  )
  values (
    payment.user_id,
    selected_plan.id,
    payment.id,
    selected_plan.exam_ids,
    selected_plan.exam_credits,
    case
      when selected_plan.access_days is null then null
      else now() + make_interval(days => selected_plan.access_days)
    end
  )
  returning id into new_entitlement_id;

  update public.payment_requests
  set status = 'approved',
      receipt_ref = normalized_receipt,
      admin_note = normalized_note,
      processed_by = auth.uid(),
      processed_at = now()
  where id = payment.id;

  insert into public.audit_log (actor_id, action, target, metadata)
  values (
    auth.uid(),
    'payment.approved',
    payment.id::text,
    jsonb_build_object(
      'user_id', payment.user_id,
      'email', payment.email,
      'receipt_ref', normalized_receipt,
      'entitlement_id', new_entitlement_id
    )
  );
  return new_entitlement_id;
end;
$$;

create or replace function public.admin_grant_access(
  p_email text,
  p_plan_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  account_id uuid;
  selected_plan public.plans%rowtype;
  new_entitlement_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Accès administrateur requis.' using errcode = '42501';
  end if;

  if nullif(btrim(p_email), '') is null then
    raise exception 'Adresse email obligatoire.' using errcode = '22023';
  end if;

  select id into account_id
  from auth.users
  where lower(email) = lower(btrim(p_email))
  limit 1;
  if account_id is null then
    raise exception 'Aucun compte ne correspond à cette adresse email.' using errcode = 'P0002';
  end if;

  select * into selected_plan
  from public.plans
  where id = p_plan_id and active = true;
  if not found then
    raise exception 'Forfait actif introuvable.' using errcode = 'P0002';
  end if;
  if cardinality(selected_plan.exam_ids) = 0 and coalesce(selected_plan.exam_credits, 0) = 0 then
    raise exception 'Ce forfait ne contient aucun examen ni crédit.' using errcode = '22023';
  end if;

  insert into public.entitlements (
    user_id, plan_id, exam_ids, credits_remaining, expires_at
  )
  values (
    account_id,
    selected_plan.id,
    selected_plan.exam_ids,
    selected_plan.exam_credits,
    case
      when selected_plan.access_days is null then null
      else now() + make_interval(days => selected_plan.access_days)
    end
  )
  returning id into new_entitlement_id;

  insert into public.audit_log (actor_id, action, target, metadata)
  values (
    auth.uid(),
    'entitlement.granted',
    new_entitlement_id::text,
    jsonb_build_object('user_id', account_id, 'email', lower(btrim(p_email)), 'plan_id', selected_plan.id)
  );
  return new_entitlement_id;
end;
$$;

create or replace function public.admin_adjust_entitlement(
  p_entitlement_id uuid,
  p_action text,
  p_days integer default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  access_row public.entitlements%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Accès administrateur requis.' using errcode = '42501';
  end if;

  select * into access_row
  from public.entitlements
  where id = p_entitlement_id
  for update;
  if not found then
    raise exception 'Accès introuvable.' using errcode = 'P0002';
  end if;

  if p_action = 'revoke' then
    update public.entitlements set revoked = true where id = access_row.id;
  elsif p_action = 'extend' then
    if p_days is null or p_days < 1 or p_days > 3650 then
      raise exception 'La prolongation doit être comprise entre 1 et 3650 jours.' using errcode = '22023';
    end if;
    if access_row.expires_at is null then
      raise exception 'Cet accès n’expire pas et ne peut pas être prolongé.' using errcode = '22023';
    end if;
    update public.entitlements
    set expires_at = greatest(access_row.expires_at, now()) + make_interval(days => p_days),
        revoked = false
    where id = access_row.id;
  else
    raise exception 'Action d’accès invalide.' using errcode = '22023';
  end if;

  insert into public.audit_log (actor_id, action, target, metadata)
  values (
    auth.uid(),
    case when p_action = 'revoke' then 'entitlement.revoked' else 'entitlement.extended' end,
    access_row.id::text,
    jsonb_build_object('user_id', access_row.user_id, 'days', p_days, 'note', nullif(btrim(p_note), ''))
  );
end;
$$;

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

create or replace function public.start_exam(p_exam_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  selected_exam public.exams%rowtype;
  access_row public.entitlements%rowtype;
  attempt_id uuid;
  exam_duration integer;
begin
  if current_user_id is not null and not exists (
    select 1
    from public.profiles
    where user_id = current_user_id and suspended = false
  ) then
    raise exception 'Compte suspendu ou profil absent.' using errcode = '42501';
  end if;

  select * into selected_exam
  from public.exams
  where id = p_exam_id and status = 'published';
  if not found then
    raise exception 'Examen indisponible.' using errcode = 'P0002';
  end if;

  if current_user_id is null and not selected_exam.is_free then
    raise exception 'Connexion requise pour démarrer un examen payant.' using errcode = '42501';
  end if;

  if not selected_exam.is_free then
    select * into access_row
    from public.entitlements e
    where e.user_id = current_user_id
      and not e.revoked
      and e.starts_at <= now()
      and (e.expires_at is null or e.expires_at > now())
      and (e.exam_ids @> array[p_exam_id] or coalesce(e.credits_remaining, 0) > 0)
    order by (e.exam_ids @> array[p_exam_id]) desc, e.created_at
    limit 1
    for update;

    if not found then
      raise exception 'Aucun accès valide à cet examen.' using errcode = '42501';
    end if;

    if not (access_row.exam_ids @> array[p_exam_id]) then
      update public.entitlements
      set credits_remaining = credits_remaining - 1
      where id = access_row.id and credits_remaining > 0;
      if not found then
        raise exception 'Aucun crédit d’examen disponible.' using errcode = '42501';
      end if;
    end if;
  end if;

  select greatest(coalesce(sum(duration_seconds), 5400), 60)::integer
  into exam_duration
  from public.exam_sections
  where exam_id = p_exam_id;

  insert into public.attempts (user_id, exam_id, ends_at)
  values (current_user_id, p_exam_id, now() + make_interval(secs => exam_duration))
  returning id into attempt_id;
  return attempt_id;
end;
$$;

create or replace function public.audit_payment_request_creation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.audit_log (actor_id, action, target, metadata)
  values (
    new.user_id,
    'payment.requested',
    new.id::text,
    jsonb_build_object(
      'email', new.email,
      'plan_id', new.plan_id,
      'amount_dzd', new.amount_dzd,
      'reference', new.reference
    )
  );
  return new;
end;
$$;

revoke all on function public.audit_payment_request_creation() from public, anon, authenticated;
drop trigger if exists audit_payment_request_creation on public.payment_requests;
create trigger audit_payment_request_creation
after insert on public.payment_requests
for each row execute function public.audit_payment_request_creation();

create or replace function public.public_free_attempt_exists(
  p_attempt_id uuid,
  p_exam_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.attempts a
    join public.exams e on e.id = a.exam_id
    where a.id = p_attempt_id
      and a.exam_id = p_exam_id
      and a.user_id is null
      and a.status = 'in_progress'
      and a.ends_at > now()
      and e.status = 'published'
      and e.is_free
  );
$$;

revoke all on function public.admin_process_payment(uuid, text, text, text) from public, anon;
revoke all on function public.admin_grant_access(text, uuid) from public, anon;
revoke all on function public.admin_adjust_entitlement(uuid, text, integer, text) from public, anon;
revoke all on function public.admin_list_entitlements() from public, anon;
revoke all on function public.start_exam(uuid) from public, anon;
grant execute on function public.admin_process_payment(uuid, text, text, text) to authenticated;
grant execute on function public.admin_grant_access(text, uuid) to authenticated;
grant execute on function public.admin_adjust_entitlement(uuid, text, integer, text) to authenticated;
grant execute on function public.admin_list_entitlements() to authenticated;
revoke all on function public.public_free_attempt_exists(uuid, uuid) from public;
grant execute on function public.start_exam(uuid) to anon, authenticated;
grant execute on function public.public_free_attempt_exists(uuid, uuid) to anon, authenticated;
