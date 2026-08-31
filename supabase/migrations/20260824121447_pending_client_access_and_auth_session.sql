begin;

-- New Ilha Play accounts may authenticate immediately, but onboarding must
-- never grant club access. Existing approved accounts stay ATIVO.
create or replace function public.keep_self_service_client_pending()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  onboarding_write boolean :=
    coalesce(current_setting('ilha.onboarding_client_id', true), '') = new.id::text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'authenticated'
     and onboarding_write
     and new.id = (select auth.uid())
     and not coalesce(public.has_club_permission('clients.write'), false) then
    if tg_op = 'INSERT' then
      new.status := 'PENDENTE';
    elsif upper(coalesce(old.status, 'PENDENTE')) <> 'ATIVO' then
      new.status := old.status;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.keep_self_service_client_pending()
  from public, anon, authenticated;

drop trigger if exists keep_self_service_client_pending on public.app_clients;
create trigger keep_self_service_client_pending
before insert or update on public.app_clients
for each row execute function public.keep_self_service_client_pending();

create or replace function public.is_current_app_client_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.app_clients as client
     where client.id = (select auth.uid())
       and upper(coalesce(client.status, '')) = 'ATIVO'
       and client.registration_completed_at is not null
  );
$$;

revoke all on function public.is_current_app_client_active()
  from public, anon;
grant execute on function public.is_current_app_client_active()
  to authenticated;

drop policy if exists "plans read active or permitted staff" on public.app_plans;
create policy "plans read active or permitted staff"
on public.app_plans for select to authenticated
using (
  (active is true and (select public.is_current_app_client_active()))
  or (select public.has_club_permission('plans'))
);

drop policy if exists "announcements read active or permitted staff" on public.app_announcements;
create policy "announcements read active or permitted staff"
on public.app_announcements for select to authenticated
using (
  (active is true and (select public.is_current_app_client_active()))
  or (select public.has_club_permission('announcements'))
);

drop policy if exists "plan requests read own or permitted staff" on public.app_plan_requests;
create policy "plan requests read own or permitted staff"
on public.app_plan_requests for select to authenticated
using (
  (client_id = (select auth.uid()) and (select public.is_current_app_client_active()))
  or (select public.has_club_permission('plans'))
);

drop policy if exists "plan requests insert own" on public.app_plan_requests;
create policy "plan requests insert own"
on public.app_plan_requests for insert to authenticated
with check (
  client_id = (select auth.uid())
  and (select public.is_current_app_client_active())
);

drop policy if exists "store requests read own or permitted staff" on public.app_store_requests;
create policy "store requests read own or permitted staff"
on public.app_store_requests for select to authenticated
using (
  (client_id = (select auth.uid()) and (select public.is_current_app_client_active()))
  or (select public.has_club_permission('store'))
);

drop policy if exists "store requests insert own" on public.app_store_requests;
create policy "store requests insert own"
on public.app_store_requests for insert to authenticated
with check (
  client_id = (select auth.uid())
  and (select public.is_current_app_client_active())
);

drop policy if exists "court bookings read own or permitted staff" on public.app_court_bookings;
create policy "court bookings read own or permitted staff"
on public.app_court_bookings for select to authenticated
using (
  (
    (client_id = (select auth.uid()) or opponent_client_id = (select auth.uid()))
    and (select public.is_current_app_client_active())
  )
  or (select public.has_club_permission('classes'))
);

drop policy if exists "payment invoices read own or permitted staff" on public.app_payment_invoices;
create policy "payment invoices read own or permitted staff"
on public.app_payment_invoices for select to authenticated
using (
  (client_id = (select auth.uid()) and (select public.is_current_app_client_active()))
  or (select public.has_club_permission('finance.read'))
  or (select public.has_club_permission('finance.write'))
);

drop policy if exists app_client_notifications_read_own_or_permitted_office
  on public.app_client_notifications;
create policy app_client_notifications_read_own_or_permitted_office
on public.app_client_notifications for select to authenticated
using (
  (user_id = (select auth.uid()) and (select public.is_current_app_client_active()))
  or (select public.has_club_permission('communication'))
);

drop policy if exists app_client_notifications_update_own_or_permitted_office
  on public.app_client_notifications;
create policy app_client_notifications_update_own_or_permitted_office
on public.app_client_notifications for update to authenticated
using (
  (user_id = (select auth.uid()) and (select public.is_current_app_client_active()))
  or (select public.has_club_permission('communication'))
)
with check (
  (user_id = (select auth.uid()) and (select public.is_current_app_client_active()))
  or (select public.has_club_permission('communication'))
);

drop policy if exists app_notification_dismissals_select_own on public.app_notification_dismissals;
create policy app_notification_dismissals_select_own
on public.app_notification_dismissals for select to authenticated
using ((select auth.uid()) = user_id and (select public.is_current_app_client_active()));

drop policy if exists app_notification_dismissals_insert_own on public.app_notification_dismissals;
create policy app_notification_dismissals_insert_own
on public.app_notification_dismissals for insert to authenticated
with check ((select auth.uid()) = user_id and (select public.is_current_app_client_active()));

drop policy if exists app_notification_dismissals_update_own on public.app_notification_dismissals;
create policy app_notification_dismissals_update_own
on public.app_notification_dismissals for update to authenticated
using ((select auth.uid()) = user_id and (select public.is_current_app_client_active()))
with check ((select auth.uid()) = user_id and (select public.is_current_app_client_active()));

drop policy if exists app_notification_dismissals_delete_own on public.app_notification_dismissals;
create policy app_notification_dismissals_delete_own
on public.app_notification_dismissals for delete to authenticated
using ((select auth.uid()) = user_id and (select public.is_current_app_client_active()));

drop policy if exists "clients manage own push subscriptions" on public.app_push_subscriptions;
create policy "clients manage own push subscriptions"
on public.app_push_subscriptions for all to authenticated
using (
  user_id = (select auth.uid())
  and (select public.is_current_app_client_active())
)
with check (
  user_id = (select auth.uid())
  and (select public.is_current_app_client_active())
);

comment on function public.is_current_app_client_active() is
  'RLS gate: only a completed client explicitly approved as ATIVO may access Ilha Play club data.';

commit;
