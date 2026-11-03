create table if not exists public.email_notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  event_key text not null unique,
  recipient text not null,
  status text not null default 'processing'
    check (status in ('processing', 'sent', 'failed')),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_notification_log enable row level security;
revoke all on public.email_notification_log from anon, authenticated;
revoke select (is_correct) on public.answers from anon, authenticated;

drop policy if exists "Users read own attempts; admins read all" on public.attempts;
create policy "Users read own attempts; admins read all"
  on public.attempts for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Users read own results; admins read all" on public.results;
create policy "Users read own results; admins read all"
  on public.results for select to authenticated
  using (
    (exists (
      select 1
      from public.attempts a
      where a.id = attempt_id
        and a.user_id = (select auth.uid())
        and a.status = 'submitted'
    ))
    or (select public.is_admin())
  );

create or replace function public.admin_dashboard_analytics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès administrateur requis.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'totalUsers', (select count(*) from auth.users),
    'pendingPayments', (
      select count(*) from public.payment_requests where status = 'pending'
    ),
    'revenueDzd', (
      select coalesce(sum(amount_dzd), 0)
      from public.payment_requests
      where status = 'approved'
    ),
    'signupsByDay', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', days.day::date,
        'count', coalesce(daily.count, 0)
      ) order by days.day), '[]'::jsonb)
      from generate_series((current_date - 13)::timestamp, current_date::timestamp, interval '1 day') days(day)
      left join (
        select created_at::date as day, count(*) as count
        from auth.users
        where created_at >= current_date - 13
          and created_at < current_date + 1
        group by created_at::date
      ) daily on daily.day = days.day::date
    ),
    'attemptsByDay', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', days.day::date,
        'count', coalesce(daily.count, 0)
      ) order by days.day), '[]'::jsonb)
      from generate_series((current_date - 13)::timestamp, current_date::timestamp, interval '1 day') days(day)
      left join (
        select created_at::date as day, count(*) as count
        from public.attempts
        where created_at >= current_date - 13
          and created_at < current_date + 1
        group by created_at::date
      ) daily on daily.day = days.day::date
    ),
    'averageScoreBySection', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'section', section.kind,
        'average', coalesce(scores.average, 0),
        'attempts', coalesce(scores.attempts, 0)
      )       order by section.sort_order), '[]'::jsonb)
      from (values ('CO'::text, 1), ('SL'::text, 2), ('CE'::text, 3))
        as section(kind, sort_order)
      left join (
        select r.section_kind, round(avg(r.score), 2) as average, count(*) as attempts
        from public.results r
        join public.attempts a on a.id = r.attempt_id
        where a.status = 'submitted'
          and r.section_kind in ('CO', 'SL', 'CE')
        group by r.section_kind
      ) scores on scores.section_kind = section.kind
    )
  );
end;
$$;

revoke all on function public.admin_dashboard_analytics() from public, anon;
grant execute on function public.admin_dashboard_analytics() to authenticated;

create or replace function public.get_submitted_attempt_result(p_attempt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  attempt_row public.attempts%rowtype;
begin
  select a.* into attempt_row
  from public.attempts a
  where a.id = p_attempt_id
    and a.user_id = auth.uid()
    and a.status = 'submitted';

  if not found then
    raise exception 'Résultat introuvable ou tentative non soumise.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'attemptId', attempt_row.id,
    'submittedAt', attempt_row.submitted_at,
    'examTitle', (
      select e.title from public.exams e where e.id = attempt_row.exam_id
    ),
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
        'section', r.section_kind,
        'score', r.score,
        'level', r.cefr_level,
        'details', r.details
      ) order by case r.section_kind when 'CO' then 1 when 'SL' then 2 when 'CE' then 3 else 4 end)
      from public.results r
      where r.attempt_id = attempt_row.id
        and r.section_kind in ('CO', 'SL', 'CE')
    ), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id,
        'section', s.kind,
        'prompt', q.prompt,
        'options', q.options,
        'selectedOption', answer.selected_option,
        'correctOption', q.correct_option,
        'explanation', q.explanation,
        'points', coalesce(attempt_row.question_points[drawn.ordinality::integer], q.points),
        'isCorrect', coalesce(answer.is_correct, false)
      ) order by drawn.ordinality)
      from unnest(attempt_row.question_ids) with ordinality drawn(question_id, ordinality)
      join public.questions q on q.id = drawn.question_id
      join public.exam_sections s on s.id = q.section_id
      left join public.answers answer
        on answer.attempt_id = attempt_row.id and answer.question_id = q.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_submitted_attempt_result(uuid) from public, anon;
grant execute on function public.get_submitted_attempt_result(uuid) to authenticated;

create or replace function public.claim_expiring_entitlement_notifications()
returns table (
  notification_id uuid,
  email text,
  first_name text,
  plan_name text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Accès réservé au service de notification.' using errcode = '42501';
  end if;

  return query
  with eligible as (
    select e.id as entitlement_id,
           e.user_id,
           e.expires_at,
           u.email::text as recipient,
           coalesce(profile.first_name, '') as given_name,
           coalesce(plan.name, 'votre accès TCF') as offer_name,
           'entitlement-expiring:' || e.id::text || ':' ||
             to_char(e.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as event_key
    from public.entitlements e
    join auth.users u on u.id = e.user_id
    left join public.profiles profile on profile.user_id = e.user_id
    left join public.plans plan on plan.id = e.plan_id
    where not e.revoked
      and e.expires_at > now()
      and (
        (e.expires_at >= now() + interval '3 days'
          and e.expires_at < now() + interval '4 days')
        or exists (
          select 1
          from public.email_notification_log previous
          where previous.event_key = 'entitlement-expiring:' || e.id::text || ':' ||
            to_char(e.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
            and (
              previous.status = 'failed'
              or (previous.status = 'processing' and previous.updated_at < now() - interval '15 minutes')
            )
        )
      )
      and u.email is not null
  ),
  claimed as (
    insert into public.email_notification_log (user_id, event_key, recipient, status, updated_at)
    select eligible.user_id, eligible.event_key, eligible.recipient, 'processing', now()
    from eligible
    on conflict (event_key) do update
      set status = 'processing', last_error = null, updated_at = now()
      where public.email_notification_log.status = 'failed'
        or (
          public.email_notification_log.status = 'processing'
          and public.email_notification_log.updated_at < now() - interval '15 minutes'
        )
    returning id, event_key
  )
  select claimed.id, eligible.recipient, eligible.given_name, eligible.offer_name, eligible.expires_at
  from claimed
  join eligible using (event_key);
end;
$$;

create or replace function public.finish_entitlement_notification(
  p_notification_id uuid,
  p_sent boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Accès réservé au service de notification.' using errcode = '42501';
  end if;

  update public.email_notification_log
  set status = case when p_sent then 'sent' else 'failed' end,
      last_error = case when p_sent then null else left(coalesce(p_error, 'Échec d’envoi Resend.'), 2000) end,
      sent_at = case when p_sent then now() else null end,
      updated_at = now()
  where id = p_notification_id
    and status = 'processing';

  if not found then
    raise exception 'Notification non trouvée ou déjà traitée.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.claim_expiring_entitlement_notifications() from public, anon, authenticated;
revoke all on function public.finish_entitlement_notification(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.claim_expiring_entitlement_notifications() to service_role;
grant execute on function public.finish_entitlement_notification(uuid, boolean, text) to service_role;

notify pgrst, 'reload schema';
