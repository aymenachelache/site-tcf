alter table public.questions
  add column if not exists audio_path text,
  add column if not exists image_path text;

update public.questions
set audio_path = media_url
where audio_path is null
  and media_url is not null;

grant select, insert, update, delete on public.questions to authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'tcf-exam-images',
  'tcf-exam-images',
  false,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

update storage.buckets
set
  public = false,
  file_size_limit = 20971520,
  allowed_mime_types = array['audio/mpeg', 'audio/wav', 'audio/x-wav']
where id = 'tcf-exam-audio';

drop policy if exists "Admins read exam images" on storage.objects;
drop policy if exists "Admins upload exam images" on storage.objects;
drop policy if exists "Admins update exam images" on storage.objects;
drop policy if exists "Admins delete exam images" on storage.objects;

create policy "Admins read exam images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'tcf-exam-images'
    and (select public.is_admin())
  );

create policy "Admins upload exam images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'tcf-exam-images'
    and (select public.is_admin())
  );

create policy "Admins update exam images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'tcf-exam-images'
    and (select public.is_admin())
  )
  with check (
    bucket_id = 'tcf-exam-images'
    and (select public.is_admin())
  );

create policy "Admins delete exam images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'tcf-exam-images'
    and (select public.is_admin())
  );

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
          'audioPath', coalesce(q.audio_path, q.media_url),
          'imagePath', q.image_path
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
