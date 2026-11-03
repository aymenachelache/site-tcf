revoke insert, update, delete on public.entitlements from authenticated;

grant select on public.audit_log to authenticated;

create or replace function public.admin_list_payment_audit()
returns table (
  id uuid,
  actor_id uuid,
  actor_email text,
  action text,
  target text,
  metadata jsonb,
  created_at timestamptz
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
  select log.id, log.actor_id, coalesce(actor.email, '')::text,
         log.action, log.target, log.metadata, log.created_at
  from public.audit_log log
  left join auth.users actor on actor.id = log.actor_id
  order by log.created_at desc
  limit 100;
end;
$$;

revoke all on function public.admin_list_payment_audit() from public, anon;
grant execute on function public.admin_list_payment_audit() to authenticated;

create or replace function public.prepare_attempt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  exam_is_free boolean;
  duration_total integer;
  available_entitlement_id uuid;
begin
  select is_free into exam_is_free
  from public.exams
  where id = new.exam_id and status = 'published';

  if not found then
    raise exception 'Exam is not available';
  end if;

  if not exam_is_free then
    select id into available_entitlement_id
    from public.entitlements
    where user_id = new.user_id
      and not revoked
      and starts_at <= now()
      and (expires_at is null or expires_at > now())
      and (
        new.exam_id = any(exam_ids)
        or coalesce(credits_remaining, 0) > 0
      )
    order by (new.exam_id = any(exam_ids)) desc, starts_at desc
    limit 1
    for update;

    if available_entitlement_id is null then
      raise exception 'No valid entitlement for this exam';
    end if;

    update public.entitlements
    set credits_remaining = credits_remaining - 1
    where id = available_entitlement_id
      and not (new.exam_id = any(exam_ids))
      and credits_remaining > 0;
  end if;

  select coalesce(sum(duration_seconds), 0)::integer
  into duration_total
  from public.exam_sections
  where exam_id = new.exam_id;

  if duration_total <= 0 then
    raise exception 'Exam has no configured duration';
  end if;

  new.started_at := now();
  new.ends_at := new.started_at + make_interval(secs => duration_total);
  new.submitted_at := null;
  new.status := 'in_progress';
  new.fullscreen_exits := 0;
  new.events := '[]'::jsonb;
  return new;
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
  section_row record;
  rule_row record;
  available_count integer;
  configured_count integer;
  maximum_points numeric;
  picked_ids uuid[];
  picked_points numeric[];
  drawn_question_ids uuid[] := '{}'::uuid[];
  drawn_question_points numeric[] := '{}'::numeric[];
  attempt_id uuid;
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

  for section_row in
    select expected.kind, expected.required_count, s.id as section_id
    from (values ('CO'::text, 34), ('SL'::text, 23), ('CE'::text, 34))
      as expected(kind, required_count)
    left join public.exam_sections s
      on s.exam_id = p_exam_id and s.kind = expected.kind
  loop
    if section_row.section_id is null then
      raise exception 'L’épreuve % est absente de cet examen.', section_row.kind using errcode = '22023';
    end if;

    select coalesce(sum(r.draw_count), 0),
           coalesce(sum(r.draw_count * r.points_per_question), 0)
    into configured_count, maximum_points
    from public.section_draw_rules r
    where r.section_id = section_row.section_id;

    if configured_count <> section_row.required_count then
      raise exception 'Épreuve % : les règles doivent prévoir % questions (configuration actuelle : %).',
        section_row.kind, section_row.required_count, configured_count
        using errcode = '22023';
    end if;
    if maximum_points <= 0 then
      raise exception 'Épreuve % : le score maximum des règles doit être supérieur à zéro.',
        section_row.kind using errcode = '22023';
    end if;
  end loop;

  for rule_row in
    select r.section_id, r.tier, r.draw_count, r.points_per_question, s.kind, s.position
    from public.section_draw_rules r
    join public.exam_sections s on s.id = r.section_id
    where s.exam_id = p_exam_id and s.kind in ('CO', 'SL', 'CE')
    order by s.position, r.tier
  loop
    select count(*) into available_count
    from public.questions q
    where q.section_id = rule_row.section_id
      and q.tier = rule_row.tier
      and q.correct_option is not null;

    if available_count < rule_row.draw_count then
      raise exception 'Épreuve %, niveau % : % question(s) prête(s), % requise(s).',
        rule_row.kind, rule_row.tier, available_count, rule_row.draw_count
        using errcode = '22023';
    end if;

    if rule_row.draw_count = 0 then
      continue;
    end if;

    select array_agg(picked.id order by picked.was_seen, picked.random_key),
           array_agg(rule_row.points_per_question order by picked.was_seen, picked.random_key)
    into picked_ids, picked_points
    from (
      select
        q.id,
        case when current_user_id is not null and exists (
          select 1
          from public.attempts previous_attempt
          where previous_attempt.user_id = current_user_id
            and previous_attempt.question_ids @> array[q.id]
        ) then 1 else 0 end as was_seen,
        random() as random_key
      from public.questions q
      where q.section_id = rule_row.section_id
        and q.tier = rule_row.tier
        and q.correct_option is not null
      order by was_seen, random_key
      limit rule_row.draw_count
    ) picked;

    drawn_question_ids := drawn_question_ids || picked_ids;
    drawn_question_points := drawn_question_points || picked_points;
  end loop;

  if cardinality(drawn_question_ids) <> 91
    or cardinality(drawn_question_points) <> cardinality(drawn_question_ids) then
    raise exception 'Le tirage est incomplet ou ses points ne sont pas configurés.' using errcode = '22023';
  end if;

  if not selected_exam.is_free then
    select * into access_row
    from public.entitlements e
    where e.user_id = current_user_id
      and not e.revoked
      and e.starts_at <= now()
      and (e.expires_at is null or e.expires_at > now())
      and (coalesce(e.exam_ids @> array[p_exam_id], false) or coalesce(e.credits_remaining, 0) > 0)
    order by coalesce(e.exam_ids @> array[p_exam_id], false) desc, e.created_at
    limit 1
    for update;

    if not found then
      raise exception 'Aucun accès valide à cet examen.' using errcode = '42501';
    end if;

    -- The prepare_attempt trigger performs the atomic credit consumption on insert.
    -- Do not decrement here: doing so would charge twice or reject a one-credit plan.
  end if;

  insert into public.attempts (user_id, exam_id, question_ids, question_points)
  values (current_user_id, p_exam_id, drawn_question_ids, drawn_question_points)
  returning id into attempt_id;
  return attempt_id;
end;
$$;

revoke all on function public.start_exam(uuid) from public;
grant execute on function public.start_exam(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
