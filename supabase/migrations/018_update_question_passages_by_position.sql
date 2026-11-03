create or replace function public.admin_update_question_passages(
  p_section_id uuid,
  p_passages jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  expected_count integer;
  updated_count integer;
begin
  if not public.is_admin() then
    raise exception 'Accès administrateur requis.' using errcode = '42501';
  end if;

  if p_section_id is null or p_passages is null or jsonb_typeof(p_passages) <> 'array' then
    raise exception 'La section et une liste non vide de passages sont obligatoires.'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_passages) = 0 then
    raise exception 'La section et une liste non vide de passages sont obligatoires.'
      using errcode = '22023';
  end if;

  expected_count := jsonb_array_length(p_passages);

  if exists (
    select 1
    from jsonb_to_recordset(p_passages) as imported(position integer, passage text)
    where imported.position is null or imported.position < 1
  ) then
    raise exception 'Chaque passage doit avoir une position positive.'
      using errcode = '22023';
  end if;

  if exists (
    select imported.position
    from jsonb_to_recordset(p_passages) as imported(position integer, passage text)
    group by imported.position
    having count(*) > 1
  ) then
    raise exception 'Le fichier contient des positions dupliquées.'
      using errcode = '22023';
  end if;

  update public.questions as question
  set passage = imported.passage,
      updated_at = now()
  from jsonb_to_recordset(p_passages) as imported(position integer, passage text)
  where question.section_id = p_section_id
    and question.position = imported.position;

  get diagnostics updated_count = row_count;
  if updated_count <> expected_count then
    raise exception 'Au moins une position importée n’existe pas dans cette section ; aucune modification n’a été conservée.'
      using errcode = 'P0002';
  end if;

  return updated_count;
end;
$$;

revoke all on function public.admin_update_question_passages(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_update_question_passages(uuid, jsonb) to authenticated;
