begin;
create table public.admin_dashboard_payment_dismissals (
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid not null references public.app_payment_invoices(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key(user_id,invoice_id)
);
alter table public.admin_dashboard_payment_dismissals enable row level security;
revoke all on public.admin_dashboard_payment_dismissals from public,anon,authenticated;
grant select,insert,delete on public.admin_dashboard_payment_dismissals to authenticated;
create policy dashboard_dismissals_read_own on public.admin_dashboard_payment_dismissals for select to authenticated
using(user_id=(select auth.uid()) and (select public.has_club_permission('finance.read')));
create policy dashboard_dismissals_insert_own on public.admin_dashboard_payment_dismissals for insert to authenticated
with check(user_id=(select auth.uid()) and (select public.has_club_permission('finance.read')) and exists (
  select 1 from public.app_payment_invoices i where i.id=invoice_id and i.superseded_at is null
    and i.provider_status in ('CONFIRMED','RECEIVED') and i.status not in ('CANCELADA','CANCELADO','ESTORNADA')
));
create policy dashboard_dismissals_delete_own on public.admin_dashboard_payment_dismissals for delete to authenticated
using(user_id=(select auth.uid()) and (select public.has_club_permission('finance.read')));
-- Realtime only signals the dashboard to refetch through the existing RLS.
do $$
declare table_name text;
begin
  foreach table_name in array array['app_clients','app_payment_invoices','admin_dashboard_payment_dismissals'] loop
    if not exists(select 1 from pg_publication_tables p where p.pubname='supabase_realtime' and p.schemaname='public' and p.tablename=table_name) then
      execute format('alter publication supabase_realtime add table public.%I',table_name);
    end if;
  end loop;
end;
$$;
commit;
