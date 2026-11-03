create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  birth_date date,
  photo_url text,
  role text not null default 'user' check (role in ('user', 'admin')),
  locale text not null default 'fr',
  suspended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  price_dzd integer not null default 0 check (price_dzd >= 0),
  sort_order integer not null default 0,
  exam_ids uuid[] not null default '{}',
  exam_credits integer check (exam_credits is null or exam_credits >= 0),
  access_days integer check (access_days is null or access_days > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null check (email = lower(email)),
  plan_id uuid not null references public.plans(id) on delete restrict,
  amount_dzd integer not null check (amount_dzd >= 0),
  reference text not null unique,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  receipt_ref text,
  admin_note text,
  processed_by uuid references auth.users(id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index payment_requests_receipt_ref_unique
  on public.payment_requests (receipt_ref)
  where receipt_ref is not null;

create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid references public.plans(id) on delete set null,
  payment_request_id uuid references public.payment_requests(id) on delete set null,
  exam_ids uuid[] not null default '{}',
  credits_remaining integer check (credits_remaining is null or credits_remaining >= 0),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.exams (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  exam_type text not null check (exam_type in ('TCF Tout Public', 'Canada', 'IRN', 'Québec')),
  is_free boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.exam_sections (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  kind text not null check (kind in ('CO', 'SL', 'CE', 'EE', 'EO')),
  duration_seconds integer not null check (duration_seconds > 0),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_id, kind)
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.exam_sections(id) on delete cascade,
  position integer not null check (position > 0),
  prompt text not null,
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  correct_option text,
  explanation text,
  level text,
  points numeric(8, 2) not null default 1 check (points >= 0),
  media_url text,
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (section_id, position)
);

create table public.prompts_production (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.exam_sections(id) on delete cascade,
  task_number integer not null check (task_number > 0),
  instructions text not null,
  min_words integer check (min_words is null or min_words >= 0),
  max_words integer check (max_words is null or max_words >= 0),
  prep_seconds integer check (prep_seconds is null or prep_seconds >= 0),
  speak_seconds integer check (speak_seconds is null or speak_seconds >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (section_id, task_number),
  check (min_words is null or max_words is null or min_words <= max_words)
);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete restrict,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  submitted_at timestamptz,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'submitted', 'abandoned')),
  fullscreen_exits integer not null default 0 check (fullscreen_exits >= 0),
  events jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  selected_option text,
  is_correct boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);

create table public.productions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  prompt_id uuid not null references public.prompts_production(id) on delete restrict,
  text text,
  audio_path text,
  transcript text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attempt_id, prompt_id)
);

create table public.corrections (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  source text not null check (source in ('ai', 'human')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed')),
  result jsonb,
  validated_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.results (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  section_kind text not null check (section_kind in ('CO', 'SL', 'CE', 'EE', 'EO')),
  score numeric(8, 2) not null default 0,
  cefr_level text check (cefr_level is null or cefr_level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attempt_id, section_kind)
);

create table public.cefr_thresholds (
  id uuid primary key default gen_random_uuid(),
  section_kind text not null check (section_kind in ('CO', 'SL', 'CE', 'EE', 'EO')),
  min_score numeric(8, 2) not null,
  level text not null check (level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (section_kind, min_score)
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  target text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'plans', 'payment_requests', 'entitlements', 'exams',
    'exam_sections', 'questions', 'prompts_production', 'attempts',
    'answers', 'productions', 'corrections', 'results',
    'cefr_thresholds', 'audit_log'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      'set_' || table_name || '_updated_at',
      table_name
    );
  end loop;
end;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles
    where user_id = (select auth.uid())
      and role = 'admin'
      and suspended = false
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (user_id, first_name, last_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    'user'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

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
    order by starts_at desc
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

create trigger prepare_new_attempt
  before insert on public.attempts
  for each row execute function public.prepare_attempt();

create or replace function public.can_answer_attempt(p_attempt_id uuid, p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.attempts a
    join public.exam_sections s on s.exam_id = a.exam_id
    join public.questions q on q.section_id = s.id
    where a.id = p_attempt_id
      and q.id = p_question_id
      and a.user_id = (select auth.uid())
      and a.status = 'in_progress'
      and a.ends_at > now()
  );
$$;

create or replace function public.can_write_production(p_attempt_id uuid, p_prompt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.attempts a
    join public.prompts_production p on p.id = p_prompt_id
    join public.exam_sections s on s.id = p.section_id and s.exam_id = a.exam_id
    where a.id = p_attempt_id
      and a.user_id = (select auth.uid())
      and a.status = 'in_progress'
      and a.ends_at > now()
  );
$$;

revoke all on function public.can_answer_attempt(uuid, uuid) from public;
revoke all on function public.can_write_production(uuid, uuid) from public;
grant execute on function public.can_answer_attempt(uuid, uuid) to authenticated;
grant execute on function public.can_write_production(uuid, uuid) to authenticated;

create or replace view public.questions_public as
select
  q.id,
  q.section_id,
  q.position,
  q.prompt,
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

create or replace view public.prompts_production_public as
select
  p.id,
  p.section_id,
  p.task_number,
  p.instructions,
  p.min_words,
  p.max_words,
  p.prep_seconds,
  p.speak_seconds,
  p.created_at,
  p.updated_at
from public.prompts_production p
join public.exam_sections s on s.id = p.section_id
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

create or replace view public.answers_public as
select
  a.id,
  a.attempt_id,
  a.question_id,
  a.selected_option,
  a.updated_at,
  a.created_at
from public.answers a
join public.attempts t on t.id = a.attempt_id
where t.user_id = (select auth.uid()) or (select public.is_admin());

alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.payment_requests enable row level security;
alter table public.entitlements enable row level security;
alter table public.exams enable row level security;
alter table public.exam_sections enable row level security;
alter table public.questions enable row level security;
alter table public.prompts_production enable row level security;
alter table public.attempts enable row level security;
alter table public.answers enable row level security;
alter table public.productions enable row level security;
alter table public.corrections enable row level security;
alter table public.results enable row level security;
alter table public.cefr_thresholds enable row level security;
alter table public.audit_log enable row level security;

revoke all on public.profiles, public.plans, public.payment_requests,
  public.entitlements, public.exams, public.exam_sections, public.questions,
  public.prompts_production, public.attempts, public.answers, public.productions,
  public.corrections, public.results, public.cefr_thresholds, public.audit_log
from anon, authenticated;

grant select on public.profiles, public.plans, public.payment_requests,
  public.entitlements, public.exams, public.exam_sections,
  public.attempts, public.productions, public.corrections, public.results,
  public.cefr_thresholds to authenticated;
grant select on public.plans to anon;
grant update (first_name, last_name, birth_date, photo_url, locale)
  on public.profiles to authenticated;
grant insert (user_id, email, plan_id, amount_dzd, reference)
  on public.payment_requests to authenticated;
grant update, delete on public.payment_requests to authenticated;
grant insert, update, delete on public.plans, public.entitlements, public.exams,
  public.exam_sections, public.questions, public.prompts_production,
  public.corrections, public.results, public.cefr_thresholds
  to authenticated;
grant insert (user_id, exam_id), update (fullscreen_exits, events)
  on public.attempts to authenticated;
grant insert (attempt_id, question_id, selected_option), update (selected_option)
  on public.answers to authenticated;
grant select, delete on public.answers to authenticated;
grant insert (attempt_id, prompt_id, text, audio_path, transcript),
  update (text, audio_path, transcript) on public.productions to authenticated;
grant delete on public.productions to authenticated;
grant insert on public.audit_log to authenticated;
grant select on public.questions_public, public.prompts_production_public,
  public.answers_public to authenticated;
grant select on public.exams, public.exam_sections, public.questions_public,
  public.prompts_production_public to anon;

create policy "Users read own profile; admins read all"
  on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "Users update own profile; admins update all"
  on public.profiles for update to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()))
  with check (user_id = (select auth.uid()) or (select public.is_admin()));

create policy "Active plans are public; admins read all"
  on public.plans for select to anon, authenticated
  using (active or (select public.is_admin()));
create policy "Admins manage plans"
  on public.plans for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Users read own payment requests; admins read all"
  on public.payment_requests for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "Users create own pending payment requests"
  on public.payment_requests for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and email = lower(coalesce((select auth.jwt() ->> 'email'), ''))
    and status = 'pending'
    and receipt_ref is null
    and processed_by is null
    and processed_at is null
  );
create policy "Admins manage payment requests"
  on public.payment_requests for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Users read own entitlements; admins read all"
  on public.entitlements for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "Admins manage entitlements"
  on public.entitlements for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Published exams are public; admins read all"
  on public.exams for select to anon, authenticated
  using (status = 'published' or (select public.is_admin()));
create policy "Admins manage exams"
  on public.exams for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Published exam sections are public; admins read all"
  on public.exam_sections for select to anon, authenticated
  using (
    exists (
      select 1 from public.exams e
      where e.id = exam_id and e.status = 'published'
    )
    or (select public.is_admin())
  );
create policy "Admins manage exam sections"
  on public.exam_sections for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Only admins read question answer keys"
  on public.questions for select to authenticated
  using ((select public.is_admin()));
create policy "Admins manage questions"
  on public.questions for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins manage production prompts"
  on public.prompts_production for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Users read own attempts; admins read all"
  on public.attempts for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "Users start attempts for published exams"
  on public.attempts for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.exams e
      where e.id = exam_id and e.status = 'published'
    )
  );
create policy "Users update active attempt telemetry"
  on public.attempts for update to authenticated
  using (
    user_id = (select auth.uid())
    and status = 'in_progress'
    and ends_at > now()
  )
  with check (
    user_id = (select auth.uid())
    and status = 'in_progress'
    and ends_at > now()
  );
create policy "Admins manage attempts"
  on public.attempts for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Users create answers for their active attempts"
  on public.answers for insert to authenticated
  with check ((select public.can_answer_attempt(attempt_id, question_id)));
create policy "Users update answers for their active attempts"
  on public.answers for update to authenticated
  using (
    exists (
      select 1 from public.attempts a
      where a.id = attempt_id and a.user_id = (select auth.uid())
        and a.status = 'in_progress' and a.ends_at > now()
    )
  )
  with check (
    exists (
      select 1 from public.attempts a
      where a.id = attempt_id and a.user_id = (select auth.uid())
        and a.status = 'in_progress' and a.ends_at > now()
    )
  );
create policy "Admins manage answers"
  on public.answers for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Users read own productions; admins read all"
  on public.productions for select to authenticated
  using (
    exists (
      select 1 from public.attempts a
      where a.id = attempt_id and a.user_id = (select auth.uid())
    )
    or (select public.is_admin())
  );
create policy "Users create productions for active attempts"
  on public.productions for insert to authenticated
  with check ((select public.can_write_production(attempt_id, prompt_id)));
create policy "Users update own productions during active attempts"
  on public.productions for update to authenticated
  using (
    exists (
      select 1 from public.attempts a
      where a.id = attempt_id and a.user_id = (select auth.uid())
        and a.status = 'in_progress' and a.ends_at > now()
    )
  )
  with check (
    exists (
      select 1 from public.attempts a
      where a.id = attempt_id and a.user_id = (select auth.uid())
        and a.status = 'in_progress' and a.ends_at > now()
    )
  );
create policy "Admins manage productions"
  on public.productions for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Users read published corrections for own work; admins read all"
  on public.corrections for select to authenticated
  using (
    (published_at is not null and exists (
      select 1
      from public.productions p
      join public.attempts a on a.id = p.attempt_id
      where p.id = production_id and a.user_id = (select auth.uid())
    ))
    or (select public.is_admin())
  );
create policy "Admins manage corrections"
  on public.corrections for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Users read own results; admins read all"
  on public.results for select to authenticated
  using (
    exists (
      select 1 from public.attempts a
      where a.id = attempt_id and a.user_id = (select auth.uid())
    )
    or (select public.is_admin())
  );
create policy "Admins manage results"
  on public.results for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "CEFR thresholds are public; admins manage them"
  on public.cefr_thresholds for select to anon, authenticated
  using (true);
create policy "Admins manage CEFR thresholds"
  on public.cefr_thresholds for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins read audit log"
  on public.audit_log for select to authenticated
  using ((select public.is_admin()));
create policy "Admins write audit log"
  on public.audit_log for insert to authenticated
  with check (
    (select public.is_admin())
    and actor_id = (select auth.uid())
  );
