begin;
do $$
declare target uuid; test_date date; due date;
begin
  select client_id into target from public.app_monthly_billing_enrollments limit 1;
  if target is null then raise exception 'Missing test fixture'; end if;
  update public.app_clients set due_day=10 where id=target;
  update public.app_monthly_billing_enrollments set enabled=true,billing_method='ASAAS_PIX' where client_id=target;
  foreach due in array array[date '2026-10-10',date '2027-01-10',date '2028-03-10'] loop
    test_date := due-15;
    if not exists(select 1 from private.monthly_billing_advance_targets(test_date)
      where client_id=target and invoice_month=date_trunc('month',due)::date and due_date=due) then
      raise exception 'Missing at 15 days: %',due;
    end if;
    if exists(select 1 from private.monthly_billing_advance_targets(test_date-1)
      where client_id=target and invoice_month=date_trunc('month',due)::date) then
      raise exception 'Released too early: %',due;
    end if;
  end loop;
  -- A due day still ahead belongs to THIS month, including the due day itself.
  foreach due in array array[date '2026-10-06',date '2026-10-10',date '2026-10-20'] loop
    update public.app_clients set due_day=extract(day from due)::integer where id=target;
    if not exists(select 1 from private.monthly_billing_advance_targets(date '2026-10-06')
      where client_id=target and invoice_month=date '2026-10-01' and due_date=due) then
      raise exception 'Current October due date was shifted: %',due;
    end if;
    if exists(select 1 from private.monthly_billing_advance_targets(date '2026-10-06')
      where client_id=target and invoice_month=date '2026-11-01') then
      raise exception 'November released before its 15-day window';
    end if;
  end loop;
  update public.app_monthly_billing_enrollments set billing_method='CASH' where client_id=target;
  if exists(select 1 from private.monthly_billing_advance_targets(date '2026-09-30') where client_id=target) then
    raise exception 'Manual payment included'; end if;
  update public.app_monthly_billing_enrollments set billing_method='ASAAS_PIX',enabled=false where client_id=target;
  if exists(select 1 from private.monthly_billing_advance_targets(date '2026-09-30') where client_id=target) then
    raise exception 'Disabled enrollment included'; end if;
  if has_function_privilege('authenticated','public.generate_due_app_monthly_pix_billing(text)','EXECUTE') then
    raise exception 'Public client can run scheduler'; end if;
end;
$$;
rollback;
