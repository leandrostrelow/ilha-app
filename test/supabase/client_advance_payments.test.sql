begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare target uuid; m date; opt jsonb; normal jsonb; a jsonb; b jsonb; options jsonb;
  before_enrollment jsonb; denied boolean:=false; owner_options jsonb;
begin
  if has_function_privilege('authenticated','public.prepare_client_advance_pix(uuid,date,text)','EXECUTE')
    or has_function_privilege('anon','public.get_my_advance_payment_options()','EXECUTE')
    or has_function_privilege('authenticated','private.client_advance_payment_options(uuid)','EXECUTE') then
    raise exception 'Unsafe advance grants';
  end if;
  select c.id into target from public.app_clients c join public.app_monthly_billing_enrollments e on e.client_id=c.id
    where c.status='ATIVO' and e.enabled and e.billing_method='ASAAS_PIX'
    and exists(select 1 from jsonb_array_elements(private.client_advance_payment_options(c.id)) r
      where r->>'state'='AVAILABLE' and r->>'invoice_id' is null) limit 1;
  if target is null then raise exception 'No advance fixture'; end if;
  options:=private.client_advance_payment_options(target);
  if jsonb_array_length(options)<>12 then raise exception 'Expected 12 months'; end if;
  select value into opt from jsonb_array_elements(options) where value->>'state'='AVAILABLE'
    and value->>'invoice_id' is null and (value->>'invoice_month')::date>current_date+45 order by value->>'invoice_month' limit 1;
  m:=(opt->>'invoice_month')::date;
  if m is null then raise exception 'No future fixture'; end if;
  select to_jsonb(e) into before_enrollment from public.app_monthly_billing_enrollments e where client_id=target;
  normal:=public.prepare_client_monthly_pix(target,m,'PRODUCTION');
  if normal->>'invoiceId' is not null then raise exception 'Normal flow bypassed D15'; end if;
  a:=public.prepare_client_advance_pix(target,m,'PRODUCTION');
  b:=public.prepare_client_advance_pix(target,m,'PRODUCTION');
  if a->>'invoiceId' is null or a->>'invoiceId' is distinct from b->>'invoiceId' then raise exception 'Advance idempotency failed: %',a; end if;
  if (select count(*) from public.app_payment_invoices where client_id=target and invoice_month=m and superseded_at is null)<>1 then raise exception 'Duplicate month'; end if;
  if (select amount from public.app_payment_invoices where id=(a->>'invoiceId')::uuid) is distinct from (opt->>'amount')::numeric then raise exception 'Incorrect price'; end if;
  if before_enrollment is distinct from (select to_jsonb(e) from public.app_monthly_billing_enrollments e where client_id=target) then raise exception 'Enrollment changed'; end if;
  b:=public.prepare_client_advance_pix(target,(date_trunc('month',current_date)+interval '12 months')::date,'PRODUCTION');
  if b->>'invoiceId' is not null then raise exception 'Out-of-range month allowed'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',target)::text,true);
  owner_options:=public.get_my_advance_payment_options();
  if owner_options<>private.client_advance_payment_options(target) then raise exception 'Wrong owner calendar'; end if;
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  begin perform public.get_my_advance_payment_options(); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Missing identity allowed'; end if;
  denied:=false;
  begin perform public.admin_get_monthly_receipt_calendar(target); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Missing finance permission allowed'; end if;
end;
$$;
rollback;
