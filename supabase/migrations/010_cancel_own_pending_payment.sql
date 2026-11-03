begin;

alter table public.payment_requests
  drop constraint if exists payment_requests_status_check;

alter table public.payment_requests
  add constraint payment_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'cancelled'));

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

create or replace function public.cancel_payment_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  payment_id uuid;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Connectez-vous pour annuler cette demande.' using errcode = '42501';
  end if;

  select id
  into payment_id
  from public.payment_requests
  where id = p_request_id
    and user_id = current_user_id
    and status = 'pending'
  for update;

  if not found then
    raise exception 'Cette demande est introuvable, ne vous appartient pas ou n’est plus en attente.'
      using errcode = 'P0002';
  end if;

  update public.payment_requests
  set status = 'cancelled'
  where id = payment_id;

  return payment_id;
end;
$$;

revoke all on function public.cancel_payment_request(uuid) from public, anon;
grant execute on function public.cancel_payment_request(uuid) to authenticated;

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
