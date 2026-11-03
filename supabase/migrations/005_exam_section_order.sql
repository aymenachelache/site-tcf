alter table public.exam_sections
  add column position integer;

update public.exam_sections
set position = case kind
  when 'CO' then 1
  when 'SL' then 2
  when 'CE' then 3
  when 'EE' then 4
  when 'EO' then 5
end;

alter table public.exam_sections
  alter column position set not null,
  add constraint exam_sections_position_positive check (position > 0),
  add constraint exam_sections_exam_position_unique unique (exam_id, position);
