alter table public.attempts
  add column if not exists question_ids uuid[] not null default '{}';

revoke insert on public.attempts from anon, authenticated;
revoke insert (user_id, exam_id) on public.attempts from authenticated;
revoke select on public.answers from anon, authenticated;
revoke insert (attempt_id, question_id, selected_option),
  update (selected_option) on public.answers from authenticated;
revoke insert, update on public.answers from anon;
grant select (
  id, attempt_id, question_id, selected_option, updated_at, created_at
) on public.answers to authenticated;

create or replace function public.prepare_attempt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  duration_total integer;
begin
  if not exists (
    select 1
    from public.exams
    where id = new.exam_id and status = 'published'
  ) then
    raise exception 'Exam is not available';
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
  co_question_ids uuid[];
  sl_question_ids uuid[];
  ce_question_ids uuid[];
  drawn_question_ids uuid[];
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

  select array_agg(picked.id order by picked.sort_key) into co_question_ids
  from (
    select q.id, random() as sort_key
    from public.questions q
    join public.exam_sections s on s.id = q.section_id
    where s.exam_id = p_exam_id and s.kind = 'CO' and q.correct_option is not null
    order by sort_key
    limit 34
  ) picked;

  select array_agg(picked.id order by picked.sort_key) into sl_question_ids
  from (
    select q.id, random() as sort_key
    from public.questions q
    join public.exam_sections s on s.id = q.section_id
    where s.exam_id = p_exam_id and s.kind = 'SL' and q.correct_option is not null
    order by sort_key
    limit 23
  ) picked;

  select array_agg(picked.id order by picked.sort_key) into ce_question_ids
  from (
    select q.id, random() as sort_key
    from public.questions q
    join public.exam_sections s on s.id = q.section_id
    where s.exam_id = p_exam_id and s.kind = 'CE' and q.correct_option is not null
    order by sort_key
    limit 34
  ) picked;

  if coalesce(cardinality(co_question_ids), 0) <> 34
    or coalesce(cardinality(sl_question_ids), 0) <> 23
    or coalesce(cardinality(ce_question_ids), 0) <> 34 then
    raise exception 'La banque de questions doit contenir au moins 34 CO, 23 SL et 34 CE.'
      using errcode = '22023';
  end if;

  drawn_question_ids := co_question_ids || sl_question_ids || ce_question_ids;

  if not selected_exam.is_free then
    select * into access_row
    from public.entitlements e
    where e.user_id = current_user_id
      and not e.revoked
      and e.starts_at <= now()
      and (e.expires_at is null or e.expires_at > now())
      and coalesce(e.credits_remaining, 0) > 0
    order by e.created_at
    limit 1
    for update;

    if not found then
      raise exception 'Aucun accès valide ou crédit disponible pour cet examen.'
        using errcode = '42501';
    end if;

    update public.entitlements
    set credits_remaining = credits_remaining - 1
    where id = access_row.id and credits_remaining > 0;
    if not found then
      raise exception 'Aucun crédit d’examen disponible.' using errcode = '42501';
    end if;
  end if;

  insert into public.attempts (user_id, exam_id, question_ids)
  values (current_user_id, p_exam_id, drawn_question_ids)
  returning id into attempt_id;
  return attempt_id;
end;
$$;

create or replace function public.get_exam_attempt(
  p_exam_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  attempt_row public.attempts%rowtype;
begin
  select a.*
  into attempt_row
  from public.attempts a
  join public.exams e on e.id = a.exam_id
  where a.id = p_attempt_id
    and a.exam_id = p_exam_id
    and a.status in ('in_progress', 'submitted')
    and (
      a.user_id = auth.uid()
      or (auth.uid() is null and a.user_id is null and e.is_free)
    );

  if not found then
    raise exception 'Tentative introuvable ou accès refusé.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'attemptId', attempt_row.id,
    'status', attempt_row.status,
    'startedAt', attempt_row.started_at,
    'endsAt', attempt_row.ends_at,
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', q.id,
          'section', s.kind,
          'prompt', q.prompt,
          'options', q.options,
          'points', q.points,
          'durationSeconds', q.duration_seconds,
          'mediaUrl', q.media_url
        )
        order by array_position(attempt_row.question_ids, q.id)
      )
      from public.questions q
      join public.exam_sections s on s.id = q.section_id
      where q.id = any(attempt_row.question_ids)
    ), '[]'::jsonb),
    'answers', coalesce((
      select jsonb_object_agg(a.question_id::text, a.selected_option)
      from public.answers a
      where a.attempt_id = attempt_row.id
    ), '{}'::jsonb)
  );
end;
$$;

create or replace function public.save_exam_answer(
  p_exam_id uuid,
  p_attempt_id uuid,
  p_question_id uuid,
  p_selected_option text
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  attempt_row public.attempts%rowtype;
begin
  if p_selected_option is null or p_selected_option not in ('A', 'B', 'C', 'D') then
    raise exception 'Réponse sélectionnée invalide.' using errcode = '22023';
  end if;

  select a.*
  into attempt_row
  from public.attempts a
  join public.exams e on e.id = a.exam_id
  where a.id = p_attempt_id
    and a.exam_id = p_exam_id
    and a.status = 'in_progress'
    and a.ends_at > now()
    and (
      a.user_id = auth.uid()
      or (auth.uid() is null and a.user_id is null and e.is_free)
    )
  for update of a;

  if not found then
    raise exception 'Tentative expirée, terminée ou accès refusé.' using errcode = '42501';
  end if;

  if not p_question_id = any(attempt_row.question_ids) then
    raise exception 'Cette question ne fait pas partie de votre tentative.' using errcode = '42501';
  end if;

  insert into public.answers (attempt_id, question_id, selected_option)
  values (attempt_row.id, p_question_id, p_selected_option)
  on conflict (attempt_id, question_id)
  do update set
    selected_option = excluded.selected_option,
    is_correct = false,
    updated_at = now();
end;
$$;

create or replace function public.submit_exam(
  p_exam_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  attempt_row public.attempts%rowtype;
  section_row record;
  section_scores jsonb := '{}'::jsonb;
  section_levels jsonb := '{}'::jsonb;
  global_score numeric;
begin
  select a.*
  into attempt_row
  from public.attempts a
  join public.exams e on e.id = a.exam_id
  where a.id = p_attempt_id
    and a.exam_id = p_exam_id
    and (
      a.user_id = auth.uid()
      or (auth.uid() is null and a.user_id is null and e.is_free)
    )
  for update of a;

  if not found then
    raise exception 'Tentative introuvable ou accès refusé.' using errcode = '42501';
  end if;

  if attempt_row.status = 'submitted' then
    select coalesce(jsonb_object_agg(r.section_kind, r.score), '{}'::jsonb),
           coalesce(jsonb_object_agg(r.section_kind, r.cefr_level), '{}'::jsonb),
           coalesce(avg(r.score), 0)
    into section_scores, section_levels, global_score
    from public.results r
    where r.attempt_id = attempt_row.id
      and r.section_kind in ('CO', 'SL', 'CE');

    return jsonb_build_object(
      'sectionScores', section_scores,
      'sectionLevels', section_levels,
      'globalScore', round(global_score, 2)
    );
  end if;

  if attempt_row.status <> 'in_progress' then
    raise exception 'Cette tentative ne peut pas être soumise.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.questions q
    where q.id = any(attempt_row.question_ids)
      and q.correct_option is null
  ) then
    raise exception 'Une ou plusieurs questions tirées au sort n’ont pas de bonne réponse configurée.'
      using errcode = '22023';
  end if;

  update public.answers a
  set is_correct = (a.selected_option = q.correct_option),
      updated_at = now()
  from public.questions q
  where a.attempt_id = attempt_row.id
    and q.id = a.question_id
    and q.id = any(attempt_row.question_ids);

  for section_row in
    select
      s.kind,
      coalesce(sum(case when a.is_correct then q.points else 0 end), 0) as score,
      count(*) filter (where a.is_correct) as correct_count,
      count(*) as question_count
    from unnest(attempt_row.question_ids) drawn(question_id)
    join public.questions q on q.id = drawn.question_id
    join public.exam_sections s on s.id = q.section_id
    left join public.answers a
      on a.attempt_id = attempt_row.id and a.question_id = q.id
    group by s.kind
  loop
    insert into public.results (attempt_id, section_kind, score, cefr_level, details)
    values (
      attempt_row.id,
      section_row.kind,
      section_row.score,
      (
        select t.level
        from public.cefr_thresholds t
        where t.section_kind = section_row.kind
          and t.min_score <= section_row.score
        order by t.min_score desc
        limit 1
      ),
      jsonb_build_object(
        'correct', section_row.correct_count,
        'total', section_row.question_count
      )
    )
    on conflict (attempt_id, section_kind)
    do update set
      score = excluded.score,
      cefr_level = excluded.cefr_level,
      details = excluded.details,
      updated_at = now();

    section_scores := section_scores || jsonb_build_object(section_row.kind, section_row.score);
    section_levels := section_levels || jsonb_build_object(
      section_row.kind,
      (
        select t.level
        from public.cefr_thresholds t
        where t.section_kind = section_row.kind
          and t.min_score <= section_row.score
        order by t.min_score desc
        limit 1
      )
    );
  end loop;

  update public.attempts
  set status = 'submitted', submitted_at = now()
  where id = attempt_row.id;

  select coalesce(avg(r.score), 0)
  into global_score
  from public.results r
  where r.attempt_id = attempt_row.id
    and r.section_kind in ('CO', 'SL', 'CE');

  return jsonb_build_object(
    'sectionScores', section_scores,
    'sectionLevels', section_levels,
    'globalScore', round(global_score, 2)
  );
end;
$$;

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
      and a.status in ('in_progress', 'submitted')
      and e.status = 'published'
      and e.is_free
  );
$$;

revoke all on function public.start_exam(uuid) from public;
revoke all on function public.get_exam_attempt(uuid, uuid) from public;
revoke all on function public.save_exam_answer(uuid, uuid, uuid, text) from public;
revoke all on function public.submit_exam(uuid, uuid) from public;
revoke all on function public.public_free_attempt_exists(uuid, uuid) from public;
grant execute on function public.start_exam(uuid) to anon, authenticated;
grant execute on function public.get_exam_attempt(uuid, uuid) to anon, authenticated;
grant execute on function public.save_exam_answer(uuid, uuid, uuid, text) to anon, authenticated;
grant execute on function public.submit_exam(uuid, uuid) to anon, authenticated;
grant execute on function public.public_free_attempt_exists(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
