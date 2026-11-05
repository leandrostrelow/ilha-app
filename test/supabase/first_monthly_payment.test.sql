begin;
-- Rollback includes pg_net's queue: NO external payment is requested by this test.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare target uuid; existing uuid; first_date date; option jsonb; next_option jsonb;
  today date:=(now() at time zone 'America/Sao_Paulo')::date;
  month date:=date_trunc('month',now() at time zone 'America/Sao_Paulo')::date;
  prepared jsonb; again jsonb; invoice uuid; request_count integer;
begin
  select c.client_id into target from private.monthly_billing_candidates(month) c
    where c.state='ELIGIBLE'
      and not exists(select 1 from public.app_payment_invoices i where i.client_id=c.client_id)
      and not exists(select 1 from public.app_monthly_billing_enrollments e where e.client_id=c.client_id)
      and not exists(select 1 from public.app_monthly_billing_enrollment_audit a where a.client_id=c.client_id and a.enabled)
    order by c.client_id limit 1;
  if target is null then raise exception 'Missing unissued first-activation fixture'; end if;
  update public.app_clients set due_day=31 where id=target;
  insert into public.app_monthly_billing_enrollments(client_id,enabled,enabled_at,billing_method)
    values(target,true,now(),'ASAAS_PIX');
  select first_due_date into first_date from public.app_monthly_billing_enrollments where client_id=target;
  if first_date is distinct from today then raise exception 'First payment not due today'; end if;
  select value into option from jsonb_array_elements(private.client_monthly_payment_options(target)) where value->>'invoice_month'=month::text;
  if option->>'state'<>'AVAILABLE' or (option->>'due_date')::date<>today then raise exception 'First payment hidden: %',option; end if;
  if not exists(select 1 from private.monthly_billing_advance_targets(today) where client_id=target and invoice_month=month and due_date=today) then
    raise exception 'First payment excluded from automation'; end if;
  select value into next_option from jsonb_array_elements(private.client_monthly_payment_options(target)) where value->>'invoice_month'=(month+interval '1 month')::date::text;
  if (next_option->>'due_date')::date<>private.monthly_billing_due_date((month+interval '1 month')::date,31) then raise exception 'Recurring due date changed'; end if;
  -- bytea is decoded without reading private HTTP headers.
  select count(*) into request_count from net.http_request_queue
    where convert_from(body,'UTF8')::jsonb=jsonb_build_object('action','activation_generate','clientId',target);
  if request_count<>1 then raise exception 'Activation must queue exactly one targeted request: %',request_count; end if;
  update public.app_monthly_billing_enrollments set enabled=true where client_id=target;
  if (select count(*) from net.http_request_queue where convert_from(body,'UTF8')::jsonb=jsonb_build_object('action','activation_generate','clientId',target))<>1 then
    raise exception 'Unchanged activation requeued'; end if;
  prepared:=public.prepare_client_monthly_pix(target,month,'PRODUCTION');
  invoice:=(prepared->>'invoiceId')::uuid;
  if invoice is null then raise exception 'First Pix could not be prepared: %',prepared; end if;
  if (select due_date from public.app_payment_invoices where id=invoice)<>today then raise exception 'Invoice moved forward'; end if;
  again:=public.prepare_client_monthly_pix(target,month,'PRODUCTION');
  if again->>'invoiceId'<>invoice::text then raise exception 'Duplicate first invoice'; end if;
  if (select count(*) from public.app_payment_invoices where client_id=target and invoice_month=month and superseded_at is null)<>1 then raise exception 'Duplicate cycle'; end if;
  update public.app_monthly_billing_enrollments set enabled=false where client_id=target;
  if private.client_monthly_payment_options(target)<>'[]'::jsonb then raise exception 'Disabled billing available'; end if;
  update public.app_monthly_billing_enrollments set enabled=true,enabled_at=now() where client_id=target;
  if (select first_due_date from public.app_monthly_billing_enrollments where client_id=target)<>first_date then raise exception 'Reactivation reset first date'; end if;
  perform set_config('ilha.monthly_billing_write','1',true);
  update public.app_payment_invoices set status='PAGA',paid_at=now(),provider_status='RECEIVED' where id=invoice;
  update public.app_invoice_provider_payments set status='RECEIVED' where invoice_id=invoice;
  prepared:=public.prepare_client_monthly_pix(target,month,'PRODUCTION');
  if prepared->>'state'<>'PAID' then raise exception 'Paid invoice reopened: %',prepared; end if;

  select e.client_id into existing from public.app_monthly_billing_enrollments e
    where e.first_due_date is null and exists(select 1 from public.app_payment_invoices i where i.client_id=e.client_id) limit 1;
  if existing is null then raise exception 'Missing historical fixture'; end if;
  update public.app_monthly_billing_enrollments set enabled=false where client_id=existing;
  update public.app_monthly_billing_enrollments set enabled=true,enabled_at=now() where client_id=existing;
  if (select first_due_date from public.app_monthly_billing_enrollments where client_id=existing) is not null then raise exception 'Historical enrollment backfilled'; end if;
  if has_function_privilege('anon','private.invoke_first_monthly_payment(uuid)','EXECUTE') or
    has_function_privilege('authenticated','private.invoke_first_monthly_payment(uuid)','EXECUTE') or
    has_table_privilege('authenticated','public.app_monthly_billing_enrollments','UPDATE') then raise exception 'Activation bypass available'; end if;
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  begin
    perform public.admin_set_app_monthly_billing_enrollment(target,true,'ASAAS_PIX');
    raise exception 'Unauthenticated activation accepted';
  exception when insufficient_privilege then null; end;
end;
$$;
rollback;
