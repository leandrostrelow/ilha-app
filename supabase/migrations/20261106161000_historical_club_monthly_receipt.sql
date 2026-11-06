begin;
-- Historical off-platform receipts only; never generates a provider payment.
create function public.record_historical_club_monthly_receipt(
  p_client_id uuid,p_actor_id uuid,p_invoice_month date,p_amount numeric,p_due_date date,p_received_on date,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.app_clients%rowtype; i public.app_payment_invoices%rowtype;
  r private.monthly_invoice_receipts%rowtype; prepared jsonb; result jsonb;
  today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if p_actor_id is null or not exists(select 1 from auth.users where id=p_actor_id)
    or p_invoice_month is null or p_invoice_month<>date_trunc('month',p_invoice_month::timestamp)::date
    or p_invoice_month>=date_trunc('month',today::timestamp)::date
    or p_due_date is null or date_trunc('month',p_due_date::timestamp)::date<>p_invoice_month
    or p_received_on is null or p_received_on>today or p_received_on<p_invoice_month
    or p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2)
    or p_reason is null or length(trim(p_reason)) not between 10 and 400 then
    raise exception 'Confira competência passada, valor, vencimento, data real e motivo.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ilha-monthly-billing:'||p_invoice_month::text,0));
  select * into strict c from public.app_clients where id=p_client_id for update;
  if exists(select 1 from public.app_family_members where member_client_id=c.id or billing_responsible_id=c.id) then
    raise exception 'Histórico familiar exige conciliação específica da composição.';
  end if;
  -- A paid historical receipt may be retried, but never replace any old invoice.
  select * into i from public.app_payment_invoices where client_id=c.id and invoice_month=p_invoice_month;
  if i.id is not null then
    select * into r from private.monthly_invoice_receipts where invoice_id=i.id;
    if i.status='PAGA' and i.amount=p_amount and i.due_date=p_due_date and i.received_on=p_received_on
      and r.completed_at is not null and r.reversed_at is null and r.method='CLUB_PIX'
      and r.notes='Registro histórico autorizado: '||trim(p_reason)
      and not exists(select 1 from public.app_invoice_provider_payments where invoice_id=i.id) then
      return jsonb_build_object('state','COMPLETED','invoiceId',i.id);
    end if;
    raise exception 'Já existe fatura nesta competência; concilie o registro existente.';
  end if;
  if exists(select 1 from public.financial_transactions f where
    lower(trim(f.counterparty))=lower(trim(c.full_name))
    and coalesce(f.competence_month,date_trunc('month',f.due_date::timestamp)::date)=p_invoice_month
    and f.category='Mensalidade') then
    raise exception 'Existe lançamento financeiro no mês; confira antes de registrar outra receita.';
  end if;
  perform pg_catalog.set_config('ilha.monthly_billing_write','1',true);
  insert into public.app_payment_invoices(client_id,invoice_month,amount,due_date,status,description,notes)
    values(c.id,p_invoice_month,p_amount,p_due_date,'ABERTA','Mensalidade histórica recebida por Pix do clube',
      'Registro histórico autorizado: '||trim(p_reason)) returning * into i;
  prepared:=public.prepare_monthly_invoice_receipt(i.id,p_actor_id,'CLUB_PIX',p_received_on,p_amount,i.notes);
  result:=public.complete_monthly_invoice_receipt(i.id,(prepared->>'claimToken')::uuid,null);
  if result->>'state' is distinct from 'COMPLETED' then raise exception 'Recebimento histórico não concluído.'; end if;
  return result;
end;
$$;
revoke all on function public.record_historical_club_monthly_receipt(uuid,uuid,date,numeric,date,date,text) from public,anon,authenticated,service_role;
grant execute on function public.record_historical_club_monthly_receipt(uuid,uuid,date,numeric,date,date,text) to service_role;
commit;
