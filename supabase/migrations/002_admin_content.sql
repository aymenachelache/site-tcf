alter table public.questions
  drop constraint if exists questions_options_check;

alter table public.questions
  add constraint questions_options_four_choices
  check (
    jsonb_typeof(options) = 'array'
    and jsonb_array_length(options) = 4
  );

alter table public.questions
  add constraint questions_correct_option_letter
  check (correct_option is null or correct_option in ('A', 'B', 'C', 'D'));

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'tcf-exam-audio',
  'tcf-exam-audio',
  false,
  20971520,
  array['audio/mpeg', 'audio/wav', 'audio/x-wav']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Admins read exam audio" on storage.objects;
drop policy if exists "Admins upload exam audio" on storage.objects;
drop policy if exists "Admins update exam audio" on storage.objects;
drop policy if exists "Admins delete exam audio" on storage.objects;

create policy "Admins read exam audio"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'tcf-exam-audio'
    and (select public.is_admin())
  );

create policy "Admins upload exam audio"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'tcf-exam-audio'
    and (select public.is_admin())
  );

create policy "Admins update exam audio"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'tcf-exam-audio'
    and (select public.is_admin())
  )
  with check (
    bucket_id = 'tcf-exam-audio'
    and (select public.is_admin())
  );

create policy "Admins delete exam audio"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'tcf-exam-audio'
    and (select public.is_admin())
  );
