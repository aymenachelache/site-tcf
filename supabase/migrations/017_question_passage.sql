alter table public.questions
  add column if not exists passage text;

drop view if exists public.questions_public cascade;

create view public.questions_public as
select
  q.id,
  q.section_id,
  q.position,
  q.prompt,
  q.passage,
  q.options,
  q.level,
  q.points,
  q.media_url,
  q.duration_seconds,
  q.created_at,
  q.updated_at
from public.questions q
join public.exam_sections s on s.id = q.section_id
join public.exams e on e.id = s.exam_id
where e.status = 'published'
  and (
    e.is_free
    or exists (
      select 1
      from public.entitlements entitlement
      where entitlement.user_id = (select auth.uid())
        and not entitlement.revoked
        and entitlement.starts_at <= now()
        and (entitlement.expires_at is null or entitlement.expires_at > now())
        and (
          e.id = any(entitlement.exam_ids)
          or coalesce(entitlement.credits_remaining, 0) > 0
        )
    )
  );

grant select on public.questions_public to anon, authenticated;

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
          'passage', q.passage,
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

revoke all on function public.get_exam_attempt(uuid, uuid) from public;
grant execute on function public.get_exam_attempt(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
