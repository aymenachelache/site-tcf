create or replace view public.exam_catalog_sections as
select
  s.exam_id,
  s.kind,
  s.duration_seconds,
  (count(q.id) filter (where q.correct_option is not null))::integer as question_count
from public.exam_sections s
join public.exams e on e.id = s.exam_id
left join public.questions q on q.section_id = s.id
where e.status = 'published'
group by s.exam_id, s.kind, s.duration_seconds;

revoke all on public.exam_catalog_sections from anon, authenticated;
grant select on public.exam_catalog_sections to anon, authenticated;
