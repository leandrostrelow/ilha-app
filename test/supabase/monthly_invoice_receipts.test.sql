begin;
-- All mutations, notifications and ledger rows are rolled back. No Asaas calls.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare month date:=date_trunc('month',now() at time zone 'America/Sao_Paulo')::date;
  today date:=(now() at time zone 'America/Sao_Paulo')::date;
  target uuid; new_id uuid; old_id uuid; fresh_amount numeric; option jsonb; result jsonb; repeated jsonb;
  i public.app_payment_invoices%rowtype; p public.app_invoice_provider_payments%rowtype;
  enrollment_before jsonb; receipt jsonb; proof jsonb; rejected boolean;
begin
  if has_function_privilege('authenticated','public.prepare_monthly_invoice_receipt(uuid,uuid,text,date,numeric,text)','EXECUTE')
    or has_function_privilege('authenticated','public.complete_monthly_invoice_receipt(uuid,uuid,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.get_my_monthly_payment_options()','EXECUTE') then raise exception 'Unsafe grants'; end if;

  select e.client_id,x into target,option from public.app_monthly_billing_enrollments e
    cross join lateral jsonb_array_elements(private.client_monthly_payment_options(e.client_id)) x
    where x->>'invoice_month'=month::text and x->>'state'='AVAILABLE' and x->>'invoice_id' is null limit 1;
  if target is null then raise exception 'Missing unissued fixture'; end if;
  update public.app_clients set due_day=28 where id=target;
  result:=public.prepare_client_monthly_pix(target,month,'PRODUCTION');
  new_id:=(result->>'invoiceId')::uuid;
  if new_id is null then raise exception 'Current month on-demand failed: %',result; end if;
  repeated:=public.prepare_client_monthly_pix(target,month,'PRODUCTION');
  if repeated->>'invoiceId'<>new_id::text then raise exception 'Duplicate current invoice'; end if;
  result:=public.prepare_client_monthly_pix(target,(month+interval '1 month')::date,'PRODUCTION');
  if result->>'state'<>'TOO_EARLY' then raise exception 'Future D-15 gate failed'; end if;

  select e.client_id,x into target,option from public.app_monthly_billing_enrollments e
    cross join lateral jsonb_array_elements(private.client_monthly_payment_options(e.client_id)) x
    where x->>'invoice_month'=month::text and x->>'state'='REISSUABLE' limit 1;
  if target is null then raise exception 'Missing cancelled fixture'; end if;
  old_id:=(option->>'invoice_id')::uuid; fresh_amount:=(option->>'amount')::numeric;
  result:=public.prepare_client_monthly_pix(target,month,'PRODUCTION');
  new_id:=(result->>'invoiceId')::uuid;
  if new_id is null or new_id=old_id then raise exception 'Reissue did not create new identity: %',result; end if;
  if (select amount from public.app_payment_invoices where id=new_id)<>fresh_amount then raise exception 'Stale reissue amount'; end if;
  if not exists(select 1 from public.app_payment_invoices where id=old_id and status='CANCELADA' and superseded_at is not null) then raise exception 'Lost cancelled history'; end if;
  repeated:=public.prepare_client_monthly_pix(target,month,'PRODUCTION');
  if repeated->>'invoiceId'<>new_id::text then raise exception 'Duplicate replacement'; end if;

  select invoice.* into i from public.app_payment_invoices invoice join public.app_invoice_provider_payments payment on payment.invoice_id=invoice.id
    where invoice.status in ('AGUARDANDO','VENCIDA') and invoice.paid_at is null and payment.status in ('PENDING','OVERDUE') and payment.provider_payment_id is not null limit 1;
  if i.id is null then raise exception 'Missing payable fixture'; end if;
  select * into p from public.app_invoice_provider_payments where invoice_id=i.id;
  select to_jsonb(e) into enrollment_before from public.app_monthly_billing_enrollments e where client_id=i.client_id;
  rejected:=false;
  begin perform public.prepare_monthly_invoice_receipt(i.id,i.client_id,'CASH',today,i.amount+1,null);
  exception when others then rejected:=true; end;
  if not rejected then raise exception 'Changed amount accepted'; end if;
  receipt:=public.prepare_monthly_invoice_receipt(i.id,i.client_id,'CASH',today,i.amount,'TEST ROLLBACK');
  rejected:=false;
  begin perform public.prepare_monthly_invoice_receipt(i.id,i.client_id,'CASH',today,i.amount,null);
  exception when others then rejected:=true; end;
  if not rejected then raise exception 'Parallel confirmation not locked'; end if;
  proof:=jsonb_build_object('payment',jsonb_build_object('id',p.provider_payment_id,'external_reference',p.external_reference,
    'customer',p.provider_customer_id,'value',i.amount,'status','RECEIVED','billing_type','PIX','payment_date',today));
  rejected:=false;
  begin perform public.complete_monthly_invoice_receipt(i.id,(receipt->>'claimToken')::uuid,proof);
  exception when others then rejected:=true; end;
  if not rejected then raise exception 'Normal Pix misclassified as cash'; end if;
  proof:=jsonb_set(proof,'{payment,billing_type}','"RECEIVED_IN_CASH"');
  result:=public.complete_monthly_invoice_receipt(i.id,(receipt->>'claimToken')::uuid,proof);
  repeated:=public.complete_monthly_invoice_receipt(i.id,(receipt->>'claimToken')::uuid,proof);
  if result->>'state'<>'COMPLETED' or repeated->>'state'<>'COMPLETED' then raise exception 'Idempotent receipt failed'; end if;
  if not exists(select 1 from public.app_payment_invoices where id=i.id and status='PAGA' and received_method='CASH' and received_on=today) then raise exception 'Invoice receipt missing'; end if;
  if enrollment_before is distinct from (select to_jsonb(e) from public.app_monthly_billing_enrollments e where client_id=i.client_id) then raise exception 'Recurring settings changed'; end if;
  result:=public.apply_app_invoice_payment_reconciliation(p.provider_payment_id,p.provider_environment,'RECEIVED',p.external_reference,i.amount,now(),'test-late-cash-webhook',proof);
  if result->>'applied'<>'true' then raise exception 'Cash webhook rejected: %',result; end if;
  if not exists(select 1 from public.financial_transactions where app_payment_invoice_id=i.id and status='RECEBIDO' and payment_method='CASH') then raise exception 'Ledger lost receipt method'; end if;
  if (select count(*) from public.financial_transactions where app_payment_invoice_id=i.id)<>1 then raise exception 'Duplicate ledger'; end if;
  if exists(select 1 from private.monthly_payment_reminder_targets(today) where invoice_id=i.id) then raise exception 'Paid reminder still active'; end if;

  insert into public.app_payment_invoices(client_id,invoice_month,amount,due_date,status,payment_method)
    values(i.client_id,(month+interval '4 months')::date,10,(month+interval '4 months')::date,'ABERTA','CASH') returning id into new_id;
  receipt:=public.prepare_monthly_invoice_receipt(new_id,i.client_id,'CLUB_PIX',today,10,null);
  result:=public.complete_monthly_invoice_receipt(new_id,(receipt->>'claimToken')::uuid,null);
  if result->>'state'<>'COMPLETED' then raise exception 'Local manual invoice not settled'; end if;
  if exists(select 1 from public.app_invoice_provider_payments where invoice_id=new_id) then raise exception 'Local receipt created a provider charge'; end if;
  if enrollment_before is distinct from (select to_jsonb(e) from public.app_monthly_billing_enrollments e where client_id=i.client_id) then raise exception 'Local receipt changed recurring settings'; end if;
end;
$$;
rollback;
