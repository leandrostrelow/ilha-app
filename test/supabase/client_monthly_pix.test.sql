begin;
-- These fixtures roll back completely; no provider request is made.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare target uuid; month date:=date_trunc('month',now() at time zone 'America/Sao_Paulo')::date;
  result jsonb; again jsonb; test_invoice_id uuid; due date; n integer; message_id uuid;
begin
  select c.client_id into target from private.monthly_billing_candidates(month) c
    join public.app_monthly_billing_enrollments e on e.client_id=c.client_id and e.enabled
    where c.state='ELIGIBLE'
    order by c.client_id limit 1;
  if target is null then raise exception 'Missing eligible test fixture'; end if;
  -- Bring an unissued fixture into the window, only inside this rollback.
  update public.app_clients set due_day=least(extract(day from now() at time zone 'America/Sao_Paulo')::integer,28) where id=target;
  if has_function_privilege('authenticated','public.prepare_client_monthly_pix(uuid,date,text)','EXECUTE')
    or has_function_privilege('anon','public.get_my_monthly_payment_options()','EXECUTE')
    or has_function_privilege('authenticated','public.enqueue_due_monthly_payment_reminders()','EXECUTE') then
    raise exception 'Unexpected client grants'; end if;
  result:=public.prepare_client_monthly_pix(target,(month+interval '2 months')::date,'PRODUCTION');
  if result->>'state'<>'BLOCKED' then raise exception 'Future month accepted'; end if;
  result:=public.prepare_client_monthly_pix(target,month,'PRODUCTION');
  test_invoice_id:=(result->>'invoiceId')::uuid;
  if test_invoice_id is null then raise exception 'Eligible account cannot prepare Pix: %',result; end if;
  again:=public.prepare_client_monthly_pix(target,month,'PRODUCTION');
  if again->>'invoiceId'<>test_invoice_id::text then raise exception 'Duplicate invoice'; end if;
  if (select count(*) from public.app_payment_invoices where client_id=target and invoice_month=month and superseded_at is null)<>1 then
    raise exception 'More than one current invoice'; end if;
  update public.app_monthly_billing_enrollments set enabled=false where client_id=target;
  result:=public.prepare_client_monthly_pix(target,month,'PRODUCTION');
  if result->>'state'<>'BLOCKED' then raise exception 'Disabled account accepted'; end if;
  update public.app_monthly_billing_enrollments set enabled=true where client_id=target;
  perform set_config('ilha.monthly_billing_write','1',true);
  update public.app_payment_invoices set provider_status='PENDING',status='AGUARDANDO',pix_payload='TEST-ROLLBACK-NOT-A-PAYMENT',pix_expires_at=now()+interval '1 day' where id=test_invoice_id returning due_date into due;
  for n in -6..6 loop
    if exists(select 1 from private.monthly_payment_reminder_targets(due+n) t where t.invoice_id=test_invoice_id)
      is distinct from (n between -5 and 5) then raise exception 'Reminder boundary incorrect: %',n; end if;
  end loop;
  perform public.enqueue_due_monthly_payment_reminders();
  perform public.enqueue_due_monthly_payment_reminders();
  select count(*),min(id::text)::uuid into n,message_id from public.app_client_notifications
    where user_id=target and event_type='FATURA_MENSAL_LEMBRETE' and link_url='/?view=payments&invoice='||test_invoice_id::text;
  if n<>1 then raise exception 'Not exactly one daily reminder: %',n; end if;
  if not public.monthly_payment_notification_is_current(message_id) then raise exception 'Valid reminder rejected'; end if;
  update public.app_payment_invoices set status='PAGA',provider_status='RECEIVED',paid_at=now() where id=test_invoice_id;
  if public.monthly_payment_notification_is_current(message_id) then raise exception 'Paid reminder accepted'; end if;
  if exists(select 1 from private.monthly_payment_reminder_targets(due) t where t.invoice_id=test_invoice_id) then raise exception 'Paid invoice reminder'; end if;
  result:=public.prepare_client_monthly_pix(target,month,'PRODUCTION');
  if result->>'state'<>'PAID' then raise exception 'Paid invoice could be emitted again'; end if;
  insert into public.app_client_notifications(user_id,title,body,event_type,dedupe_key)
    values(target,'TEST','TEST','FATURA_MENSAL_DISPONIVEL','test-silent-monthly-issued');
  if exists(select 1 from public.app_client_notifications where dedupe_key='test-silent-monthly-issued') then raise exception 'Issuance sent a notification'; end if;
end;
$$;
rollback;
