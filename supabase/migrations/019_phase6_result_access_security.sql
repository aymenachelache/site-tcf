begin;

alter table public.attempts enable row level security;
alter table public.answers enable row level security;
alter table public.results enable row level security;

revoke all on public.attempts, public.results from anon;
grant select on public.attempts, public.results to authenticated;

revoke all on public.answers from anon;
revoke select on public.answers from authenticated;
revoke select (is_correct) on public.answers from anon, authenticated;
grant select (
  id, attempt_id, question_id, selected_option, updated_at, created_at
) on public.answers to authenticated;

drop policy if exists "Users read own attempts; admins read all" on public.attempts;
create policy "Users read own attempts; admins read all"
  on public.attempts for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Users read own results; admins read all" on public.results;
create policy "Users read own results; admins read all"
  on public.results for select to authenticated
  using (
    exists (
      select 1
      from public.attempts a
      where a.id = attempt_id
        and a.user_id = (select auth.uid())
        and a.status = 'submitted'
    )
    or (select public.is_admin())
  );

notify pgrst, 'reload schema';

commit;
