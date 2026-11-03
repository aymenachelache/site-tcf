alter table public.questions
  add column if not exists tier smallint;

update public.questions q
set tier = case
  when s.kind = 'CE' and q.position <= 4 then 1
  when s.kind = 'CE' and q.position <= 10 then 2
  when s.kind = 'CE' and q.position <= 19 then 3
  when s.kind = 'CE' and q.position <= 29 then 4
  when s.kind = 'CE' and q.position <= 35 then 5
  when s.kind = 'CE' then 6
  else 1
end
from public.exam_sections s
where s.id = q.section_id
  and q.tier is null;

alter table public.questions
  alter column tier set default 1,
  alter column tier set not null;

create index if not exists questions_section_tier_idx
  on public.questions (section_id, tier);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.questions'::regclass
      and conname = 'questions_tier_check'
  ) then
    alter table public.questions
      add constraint questions_tier_check check (tier between 1 and 6);
  end if;
end;
$$;

create table if not exists public.section_draw_rules (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.exam_sections(id) on delete cascade,
  tier smallint not null check (tier between 1 and 6),
  draw_count integer not null default 0 check (draw_count >= 0),
  points_per_question numeric(8, 2) not null default 1 check (points_per_question >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (section_id, tier)
);

drop trigger if exists set_section_draw_rules_updated_at on public.section_draw_rules;
create trigger set_section_draw_rules_updated_at
  before update on public.section_draw_rules
  for each row execute function public.set_updated_at();

alter table public.section_draw_rules enable row level security;
revoke all on public.section_draw_rules from anon, authenticated;
grant select, insert, update, delete on public.section_draw_rules to authenticated;

drop policy if exists "Admins manage section draw rules" on public.section_draw_rules;
create policy "Admins manage section draw rules"
  on public.section_draw_rules for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

insert into public.section_draw_rules (section_id, tier, draw_count, points_per_question)
select s.id, defaults.tier, defaults.draw_count, defaults.points_per_question
from public.exam_sections s
cross join (
  values
    ('CO'::text, 1::smallint, 34, 1::numeric),
    ('SL'::text, 1::smallint, 23, 1::numeric),
    ('CE'::text, 1::smallint, 3, 3::numeric),
    ('CE'::text, 2::smallint, 5, 9::numeric),
    ('CE'::text, 3::smallint, 8, 15::numeric),
    ('CE'::text, 4::smallint, 9, 21::numeric),
    ('CE'::text, 5::smallint, 5, 26::numeric),
    ('CE'::text, 6::smallint, 4, 33::numeric)
) as defaults(kind, tier, draw_count, points_per_question)
where s.kind = defaults.kind
on conflict (section_id, tier) do nothing;

create or replace function public.initialize_section_draw_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kind = 'CO' then
    insert into public.section_draw_rules (section_id, tier, draw_count, points_per_question)
    values (new.id, 1, 34, 1);
  elsif new.kind = 'SL' then
    insert into public.section_draw_rules (section_id, tier, draw_count, points_per_question)
    values (new.id, 1, 23, 1);
  elsif new.kind = 'CE' then
    insert into public.section_draw_rules (section_id, tier, draw_count, points_per_question)
    values
      (new.id, 1, 3, 3),
      (new.id, 2, 5, 9),
      (new.id, 3, 8, 15),
      (new.id, 4, 9, 21),
      (new.id, 5, 5, 26),
      (new.id, 6, 4, 33);
  end if;
  return new;
end;
$$;

revoke all on function public.initialize_section_draw_rules() from public;
drop trigger if exists initialize_section_draw_rules on public.exam_sections;
create trigger initialize_section_draw_rules
  after insert on public.exam_sections
  for each row execute function public.initialize_section_draw_rules();

alter table public.attempts
  add column if not exists question_points numeric[] not null default '{}'::numeric[];

create index if not exists attempts_user_id_idx on public.attempts (user_id);
create index if not exists attempts_question_ids_gin_idx
  on public.attempts using gin (question_ids);

update public.attempts a
set question_points = coalesce((
  select array_agg(coalesce(q.points, 0) order by drawn.ordinality)
  from unnest(a.question_ids) with ordinality drawn(question_id, ordinality)
  left join public.questions q on q.id = drawn.question_id
), '{}'::numeric[])
where cardinality(a.question_ids) > 0
  and cardinality(a.question_points) = 0;

create or replace function public.admin_assign_question_tiers(
  p_section_id uuid,
  p_ranges jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  updated_count integer;
begin
  if not public.is_admin() then
    raise exception 'Accès administrateur requis.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_ranges) is distinct from 'array' then
    raise exception 'Définissez au moins une plage de positions.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_ranges) = 0 then
    raise exception 'Définissez au moins une plage de positions.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_ranges) as range_items(item)
    where jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item -> 'start_position') is distinct from 'number'
      or jsonb_typeof(item -> 'end_position') is distinct from 'number'
      or jsonb_typeof(item -> 'tier') is distinct from 'number'
      or (item ->> 'start_position') !~ '^[0-9]+$'
      or (item ->> 'end_position') !~ '^[0-9]+$'
      or (item ->> 'tier') !~ '^[0-9]+$'
  ) then
    raise exception 'Chaque plage doit avoir un début et une fin valides et un niveau de 1 à 6.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_ranges) as range_items(item)
    where (item ->> 'start_position')::integer < 1
      or (item ->> 'end_position')::integer < (item ->> 'start_position')::integer
      or (item ->> 'tier')::integer not between 1 and 6
  ) then
    raise exception 'Chaque plage doit avoir un début et une fin valides et un niveau de 1 à 6.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_ranges) with ordinality as left_range(item, range_order)
    join jsonb_array_elements(p_ranges) with ordinality as right_range(item, range_order)
      on left_range.range_order < right_range.range_order
     and (left_range.item ->> 'start_position')::integer <= (right_range.item ->> 'end_position')::integer
     and (right_range.item ->> 'start_position')::integer <= (left_range.item ->> 'end_position')::integer
  ) then
    raise exception 'Les plages de positions ne doivent pas se chevaucher.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.exam_sections where id = p_section_id) then
    raise exception 'Épreuve introuvable.' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.questions q
    where q.section_id = p_section_id
      and not exists (
        select 1
        from jsonb_to_recordset(p_ranges) as rule(start_position integer, end_position integer, tier smallint)
        where q.position between rule.start_position and rule.end_position
      )
  ) then
    raise exception 'Les plages doivent couvrir toutes les questions de l’épreuve.' using errcode = '22023';
  end if;

  update public.questions q
  set tier = rule.tier
  from jsonb_to_recordset(p_ranges) as rule(start_position integer, end_position integer, tier smallint)
  where q.section_id = p_section_id
    and q.position between rule.start_position and rule.end_position;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.admin_assign_question_tiers(uuid, jsonb) from public;
grant execute on function public.admin_assign_question_tiers(uuid, jsonb) to authenticated;

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
      raise exception 'L’épreuve % est absente de cet examen.' , section_row.kind using errcode = '22023';
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

  insert into public.attempts (user_id, exam_id, question_ids, question_points)
  values (current_user_id, p_exam_id, drawn_question_ids, drawn_question_points)
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
          'points', coalesce(attempt_row.question_points[drawn.ordinality::integer], q.points),
          'durationSeconds', q.duration_seconds,
          'mediaUrl', q.media_url
        )
        order by drawn.ordinality
      )
      from unnest(attempt_row.question_ids) with ordinality drawn(question_id, ordinality)
      join public.questions q on q.id = drawn.question_id
      join public.exam_sections s on s.id = q.section_id
    ), '[]'::jsonb),
    'answers', coalesce((
      select jsonb_object_agg(a.question_id::text, a.selected_option)
      from public.answers a
      where a.attempt_id = attempt_row.id
    ), '{}'::jsonb)
  );
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
    from unnest(attempt_row.question_ids) as drawn(question_id)
    join public.questions q on q.id = drawn.question_id
    where q.correct_option is null
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
      scored.kind,
      scored.correct_count,
      scored.question_count,
      scored.earned_points,
      scored.maximum_points,
      round(scored.earned_points * 699 / nullif(scored.maximum_points, 0), 2) as score
    from (
      select
        s.kind,
        count(*) filter (where a.is_correct) as correct_count,
        count(*) as question_count,
        coalesce(sum(
          case when a.is_correct
            then coalesce(attempt_row.question_points[drawn.ordinality::integer], q.points)
            else 0
          end
        ), 0) as earned_points,
        coalesce(sum(coalesce(attempt_row.question_points[drawn.ordinality::integer], q.points)), 0)
          as maximum_points
      from unnest(attempt_row.question_ids) with ordinality drawn(question_id, ordinality)
      join public.questions q on q.id = drawn.question_id
      join public.exam_sections s on s.id = q.section_id
      left join public.answers a
        on a.attempt_id = attempt_row.id and a.question_id = q.id
      group by s.kind
    ) scored
  loop
    if section_row.maximum_points <= 0 then
      raise exception 'Le score maximum de l’épreuve % doit être supérieur à zéro.', section_row.kind
        using errcode = '22023';
    end if;

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
        'total', section_row.question_count,
        'earnedPoints', section_row.earned_points,
        'maximumPoints', section_row.maximum_points
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

revoke all on function public.start_exam(uuid) from public;
revoke all on function public.get_exam_attempt(uuid, uuid) from public;
revoke all on function public.submit_exam(uuid, uuid) from public;
grant execute on function public.start_exam(uuid) to anon, authenticated;
grant execute on function public.get_exam_attempt(uuid, uuid) to anon, authenticated;
grant execute on function public.submit_exam(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
