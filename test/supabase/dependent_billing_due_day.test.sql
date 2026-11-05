-- Production-compatible smoke check. All changes, including updated_at, roll back.
begin;
set local statement_timeout = '10s';
set local lock_timeout = '2s';
do $$
declare
  actor uuid;
  f public.app_family_members%rowtype;
  payer public.app_clients%rowtype;
  next_day integer;
  invoice_snapshot jsonb;
  ledger_snapshot jsonb;
  amount_before numeric;
begin
  select p.id into strict actor from public.profiles p join public.protected_access_accounts a
    on lower(p.email)=a.email and a.role='admin' and a.active
    where p.role='admin' and p.active order by p.id limit 1;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  select * into strict f from public.app_family_members where status='ATIVO' and student_id is not null
    and full_name ilike 'Joao Felipe Zago' limit 1;
  select * into strict payer from public.app_clients where id=f.billing_responsible_id;
  select jsonb_agg(to_jsonb(i) order by id) into invoice_snapshot from public.app_payment_invoices i where client_id=payer.id;
  select jsonb_agg(to_jsonb(t) order by id) into ledger_snapshot from public.financial_transactions t
    where app_payment_invoice_id in (select id from public.app_payment_invoices where client_id=payer.id);
  amount_before := (private.client_family_summary_data(payer.id)->>'total_monthly_amount')::numeric;
  next_day := case when payer.due_day=25 then 26 else 25 end;
  perform public.admin_update_family_student(f.id,jsonb_build_object('billing_due_day',next_day,'expected_billing_due_day',payer.due_day));
  if not exists(select 1 from public.app_clients where id=payer.id and due_day=next_day) then raise exception 'Due day not saved'; end if;
  if (private.client_family_summary_data(payer.id)->>'total_monthly_amount')::numeric is distinct from amount_before then raise exception 'Family amount changed'; end if;
  if (select jsonb_agg(to_jsonb(i) order by id) from public.app_payment_invoices i where client_id=payer.id) is distinct from invoice_snapshot then raise exception 'Invoice changed'; end if;
  if (select jsonb_agg(to_jsonb(t) order by id) from public.financial_transactions t where app_payment_invoice_id in (select id from public.app_payment_invoices where client_id=payer.id)) is distinct from ledger_snapshot then raise exception 'Ledger changed'; end if;
  begin
    perform public.admin_update_family_student(f.id,jsonb_build_object('billing_due_day',15,'expected_billing_due_day',payer.due_day));
    raise exception 'Stale update accepted';
  exception when serialization_failure then null;
  end;
end $$;
rollback;
select 'PASS: shared due day persisted in transaction; family total, invoices and ledger unchanged; stale update rejected; all test changes rolled back' as result;
