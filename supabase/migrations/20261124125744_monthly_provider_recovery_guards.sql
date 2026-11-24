begin;

-- Only an explicit rejected customer POST (400/422) can release its own lease.
-- Timeouts, rate limits and server errors keep the original anti-duplication guard.
create or replace function public.release_rejected_app_payment_customer(
  p_client_id uuid, p_provider_environment text, p_resolution_token uuid, p_http_status integer
) returns boolean language plpgsql security definer set search_path = '' as $$
declare released boolean;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Esta operação exige a função de serviço.' using errcode = '42501';
  end if;
  if p_http_status is null or p_http_status not in (400, 422) or p_resolution_token is null then
    raise exception 'Somente uma rejeição definitiva permite liberar a reserva.' using errcode = '22023';
  end if;
  update public.app_payment_customers
     set provider_create_attempted_at = null, resolution_token = null,
         resolution_started_at = null, updated_at = now(),
         last_error = 'CUSTOMER_CREATE_REJECTED_HTTP_' || p_http_status::text
   where client_id = p_client_id and provider = 'ASAAS'
     and provider_environment = p_provider_environment
     and status = 'RESOLVING' and provider_customer_id is null
     and resolution_token = p_resolution_token
     and provider_create_attempted_at is not null
   returning true into released;
  return coalesce(released, false);
end;
$$;
revoke all on function public.release_rejected_app_payment_customer(uuid,text,uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.release_rejected_app_payment_customer(uuid,text,uuid,integer) to service_role;

-- Extend the reviewed reconciliation in place, preserving later audited
-- receipt fixes. Refuse unexpected definitions instead of replacing them.
do $migration$
declare definition text; anchor text; extension text;
begin
  definition := pg_get_functiondef('public.apply_app_invoice_payment_reconciliation(text,text,text,text,numeric,timestamptz,text,jsonb)'::regprocedure);
  anchor := E'    ''PARTIALLY_REFUNDED'', ''CHARGEBACK'', ''DISPUTED''\n  ];';
  if position(anchor in definition) = 0 or position('  next_provider_status := case' in definition) = 0 then
    raise exception 'Definição de reconciliação não reconhecida; revise antes de aplicar.';
  end if;
  anchor := 'normalized_status in (''RECEIVED'',''RECEIVED_IN_CASH'')';
  if position(anchor in definition)=0 then raise exception 'Validação de recebimento não reconhecida; revise antes de aplicar.'; end if;
  definition := replace(definition,anchor, '('||anchor||' or (normalized_status=''REVIEW_REQUIRED'' and p_snapshot->>''event'' in (''PAYMENT_RECEIVED_IN_CASH_UNDONE'',''PAYMENT_RESTORED'',''PAYMENT_REFUND_DENIED'')))');
  anchor := E'    ''PARTIALLY_REFUNDED'', ''CHARGEBACK'', ''DISPUTED''\n  ];';
  -- REVIEW_REQUIRED is intentionally not a paid/unpaid transition.
  definition := replace(definition, anchor, E'    ''PARTIALLY_REFUNDED'', ''CHARGEBACK'', ''DISPUTED'', ''REVIEW_REQUIRED''\n  ];');
  extension := $code$
  if normalized_status = 'REVIEW_REQUIRED'
     or (nullif(p_snapshot #>> '{payment,due_date}', '') is not null
         and p_snapshot #>> '{payment,due_date}' is distinct from invoice_row.due_date::text)
     or (p_snapshot #>> '{payment,deleted}' = 'true'
         and normalized_status not in ('DELETED', 'CANCELLED', 'REFUNDED')) then
    update public.app_invoice_provider_payments
       set status = 'REVIEW_REQUIRED',
           provider_payment_id = coalesce(provider_payment_id, normalized_payment_id),
           last_event_id = nullif(normalized_event_id, ''), last_event_at = now(),
           safe_snapshot = snapshot_safe,
           last_error = case
             when p_snapshot ->> 'event' in ('PAYMENT_RECEIVED_IN_CASH_UNDONE', 'PAYMENT_RESTORED', 'PAYMENT_REFUND_DENIED')
               then 'PROVIDER_REVIEW:' || (p_snapshot ->> 'event')
             when p_snapshot #>> '{payment,due_date}' is distinct from invoice_row.due_date::text
               and nullif(p_snapshot #>> '{payment,due_date}', '') is not null
               then 'REMOTE_DUE_DATE_MISMATCH'
             else 'REMOTE_STATE_REQUIRES_REVIEW' end,
           next_reconciliation_at = null, updated_at = now()
     where id = payment_row.id;
    perform pg_catalog.set_config('ilha.monthly_billing_write', '1', true);
    update public.app_payment_invoices
       set provider_status = 'REVIEW_REQUIRED',
           last_payment_error = 'Alteração no Asaas exige conferência no Financeiro.', updated_at = now()
     where id = invoice_row.id;
    -- Preserve paid_at, receipts, invoice status and the financial ledger.
    -- A verified reversal is completed only through the audited admin flow.
    perform private.notify_monthly_billing_finance_review(invoice_row.id, 'REVIEW_REQUIRED');
    return jsonb_build_object('applied', true, 'status', 'REVIEW_REQUIRED',
      'reason', 'PROVIDER_CHANGE_REQUIRES_REVIEW', 'invoice_id', invoice_row.id,
      'provider_payment_id', normalized_payment_id);
  end if;

$code$;
  definition := replace(definition, '  next_provider_status := case', extension || '  next_provider_status := case');
  execute definition;
end;
$migration$;


-- A webhook for the exact unpaid due-date correction may arrive between the
-- remote PUT and the audited commit. Permit only that matching review; the
-- existing identity CAS, fresh GET proof, receipt and audit guards still apply.
do $migration$
declare definition text; anchor text; extension text;
begin
 definition := pg_get_functiondef('public.adjust_unpaid_monthly_invoice(uuid,uuid,text,numeric,date,date,date,text,text,jsonb,timestamptz)'::regprocedure);
 anchor := '(i.status in (''ABERTA'',''AGUARDANDO'',''VENCIDA'') and i.provider_status in (''PENDING'',''OVERDUE'') and p.status in (''PENDING'',''OVERDUE'') and f.status in (''ABERTO'',''VENCIDO''))';
 if position(anchor in definition)=0 then raise exception 'Definição do ajuste auditado não reconhecida; revise antes de aplicar.'; end if;
 extension := $code$
 or ((p_operation='due_date' and i.status in ('ABERTA','AGUARDANDO','VENCIDA')
 and i.provider_status='REVIEW_REQUIRED' and p.status='REVIEW_REQUIRED'
 and f.status in ('ABERTO','VENCIDO') and p.last_error='REMOTE_DUE_DATE_MISMATCH'
 and p.safe_snapshot#>>'{payment,id}'=p.provider_payment_id
 and p.safe_snapshot#>>'{payment,customer}'=p.provider_customer_id
 and p.safe_snapshot#>>'{payment,external_reference}'=p.external_reference
 and (p.safe_snapshot#>>'{payment,value}')::numeric=i.amount
 and p.safe_snapshot#>>'{payment,due_date}'=p_new_due_date::text
 and p.safe_snapshot#>>'{payment,billing_type}'='PIX'
 and p.safe_snapshot#>>'{payment,status}' in ('PENDING','OVERDUE')
 and p.safe_snapshot#>>'{payment,deleted}'='false'
 and coalesce(p.safe_snapshot#>>'{payment,payment_date}','')=''
 and coalesce(p.safe_snapshot#>>'{payment,client_payment_date}','')='') is true)
$code$;
 definition := replace(definition,anchor,anchor||extension);
 definition := replace(definition,'set status=next_status,safe_snapshot=p_snapshot,','set status=next_status,last_error=null,safe_snapshot=p_snapshot,');
 definition := replace(definition,'set due_date=target_date,provider_status=next_status,','set due_date=target_date,provider_status=next_status,last_payment_error=null,');
 execute definition;
end;
$migration$;

commit;
