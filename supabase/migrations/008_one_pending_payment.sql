begin;

alter table public.payment_requests
  drop constraint if exists payment_requests_status_check;

alter table public.payment_requests
  add constraint payment_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'cancelled'));

with ranked_pending_requests as (
  select id,
         row_number() over (
           partition by user_id, plan_id
           order by created_at desc, id desc
         ) as row_number
  from public.payment_requests
  where status = 'pending'
)
delete from public.payment_requests as payment
using ranked_pending_requests as ranked
where payment.id = ranked.id
  and ranked.row_number > 1;

create unique index if not exists payment_requests_one_pending
  on public.payment_requests (user_id, plan_id)
  where status = 'pending';

drop policy if exists "Users cancel own pending payment requests" on public.payment_requests;
create policy "Users cancel own pending payment requests"
  on public.payment_requests for update to authenticated
  using (
    user_id = (select auth.uid())
    and status = 'pending'
  )
  with check (
    user_id = (select auth.uid())
    and status = 'cancelled'
  );

revoke update, delete on public.payment_requests from authenticated;
grant update (status) on public.payment_requests to authenticated;

create or replace function public.audit_payment_request_cancellation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'pending' and new.status = 'cancelled' then
    insert into public.audit_log (actor_id, action, target, metadata)
    values (
      new.user_id,
      'payment.cancelled',
      new.id::text,
      jsonb_build_object('plan_id', new.plan_id, 'reference', new.reference)
    );
  end if;
  return new;
end;
$$;

revoke all on function public.audit_payment_request_cancellation() from public, anon, authenticated;
drop trigger if exists audit_payment_request_cancellation on public.payment_requests;
create trigger audit_payment_request_cancellation
after update of status on public.payment_requests
for each row execute function public.audit_payment_request_cancellation();

commit;
