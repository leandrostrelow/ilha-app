begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare target uuid; actor uuid; months jsonb; outcome jsonb; repeated jsonb; entry jsonb; receipt jsonb;
  req uuid:=gen_random_uuid(); before_enrollment jsonb; rejected boolean; invoice uuid;
begin
  if has_function_privilege('authenticated','public.prepare_monthly_receipt_batch(uuid,uuid,uuid,jsonb,text,date,text)','EXECUTE')
    or has_function_privilege('anon','public.admin_get_monthly_receipt_calendar(uuid)','EXECUTE') then raise exception 'Unsafe grants'; end if;
  select c.id into target from public.app_clients c where c.status='ATIVO' and not exists(
    select 1 from public.app_family_members f where f.member_client_id=c.id and f.billing_responsible_id<>c.id and f.status in ('ATIVO','PENDENTE'))
    and (select count(*) from jsonb_array_elements(private.monthly_receipt_calendar(c.id)) r where r->>'state'='AVAILABLE' and r->>'invoice_id' is null)>=3 limit 1;
  if target is null then raise exception 'No eligible test fixture'; end if;
  select id into actor from auth.users where id=target;
  if actor is null then select id into actor from auth.users limit 1; end if;
  select jsonb_agg(jsonb_build_object('month',r->>'invoice_month','expectedAmount',(r->>'amount')::numeric) order by r->>'invoice_month') into months
    from (select r from jsonb_array_elements(private.monthly_receipt_calendar(target)) r where r->>'state'='AVAILABLE' and r->>'invoice_id' is null order by r->>'invoice_month' limit 3) x;
  select to_jsonb(e) into before_enrollment from public.app_monthly_billing_enrollments e where client_id=target;
  rejected:=false;
  begin perform public.prepare_monthly_receipt_batch(target,actor,req,jsonb_set(months,'{0,expectedAmount}','0'::jsonb),'CASH',current_date,'TEST ROLLBACK');
  exception when others then rejected:=true; end;
  if not rejected then raise exception 'Zero amount accepted'; end if;
  outcome:=public.prepare_monthly_receipt_batch(target,actor,req,months,'CASH',current_date,'TEST ROLLBACK');
  repeated:=public.prepare_monthly_receipt_batch(target,actor,req,months,'CASH',current_date,'TEST ROLLBACK');
  if repeated<>outcome or jsonb_array_length(outcome->'invoices')<>3 then raise exception 'Batch idempotency failed'; end if;
  for entry in select value from jsonb_array_elements(outcome->'invoices') loop
    invoice:=(entry->>'invoiceId')::uuid;
    receipt:=public.prepare_monthly_invoice_receipt(invoice,actor,'CASH',current_date,(entry->>'amount')::numeric,'TEST ROLLBACK');
    perform public.complete_monthly_invoice_receipt(invoice,(receipt->>'claimToken')::uuid,null);
    if not exists(select 1 from public.app_payment_invoices where id=invoice and status='PAGA' and received_method='CASH') then raise exception 'Invoice not paid'; end if;
    if (select count(*) from public.financial_transactions where app_payment_invoice_id=invoice and status='RECEBIDO')<>1 then raise exception 'Incorrect ledger'; end if;
    if exists(select 1 from public.app_invoice_provider_payments where invoice_id=invoice) then raise exception 'Manual receipt created remote dispatch'; end if;
    if exists(select 1 from private.monthly_payment_reminder_targets((entry->>'month')::date) where invoice_id=invoice) then raise exception 'Paid reminder'; end if;
  end loop;
  if before_enrollment is distinct from (select to_jsonb(e) from public.app_monthly_billing_enrollments e where client_id=target) then raise exception 'Enrollment changed'; end if;
  for entry in select value from jsonb_array_elements(months) loop
    if not exists(select 1 from jsonb_array_elements(private.monthly_receipt_calendar(target)) r where r->>'invoice_month'=entry->>'month' and r->>'state'='PAID') then raise exception 'Calendar missing paid month'; end if;
  end loop;
  rejected:=false;
  begin perform public.prepare_monthly_receipt_batch(target,actor,gen_random_uuid(),months,'CASH',current_date,null);
  exception when others then rejected:=true; end;
  if not rejected then raise exception 'Paid months accepted twice'; end if;
  rejected:=false;
  begin perform public.prepare_monthly_receipt_batch(target,actor,req,months,'CLUB_PIX',current_date,'TEST ROLLBACK');
  exception when others then rejected:=true; end;
  if not rejected then raise exception 'Batch accepted changed method'; end if;
end;
$$;
rollback;
