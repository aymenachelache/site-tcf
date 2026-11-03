alter table public.plans
  add column if not exists objective text,
  add column if not exists badge text,
  add column if not exists features jsonb not null default '[]'::jsonb,
  add column if not exists exam_type text not null default 'TCF Tout Public';

update public.plans
set features = '[]'::jsonb
where features is null or jsonb_typeof(features) <> 'array';

alter table public.plans
  alter column features set default '[]'::jsonb,
  alter column features set not null;

grant select on public.plans to anon, authenticated;
grant update (
  name,
  description,
  price_dzd,
  exam_credits,
  access_days,
  active,
  sort_order,
  objective,
  badge,
  features,
  exam_type
) on public.plans to authenticated;

drop policy if exists "plans_public_read" on public.plans;
create policy "plans_public_read"
  on public.plans for select to anon, authenticated
  using (active = true or (select public.is_admin()));
