begin;

-- Read-only calendar; recurring enrollment and automatic D-15 generation stay unchanged.
create function private.monthly_receipt_calendar(p_client_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m date; c record; i public.app_payment_invoices%rowtype;
  p public.app_invoice_provider_payments%rowtype; state text; reason text;
  result jsonb:='[]'::jsonb;
begin
  if exists(select 1 from public.app_family_members where member_client_id=p_client_id
    and billing_responsible_id<>p_client_id and status in ('PENDENTE','ATIVO')) then
    raise exception 'Registre o recebimento na conta do responsável financeiro.';
  end if;
  for m in select d::date from generate_series(date_trunc('month',now() at time zone 'America/Sao_Paulo'),
    date_trunc('month',now() at time zone 'America/Sao_Paulo')+interval '11 months',interval '1 month') d loop
    select * into c from private.monthly_billing_candidates(m,p_client_id);
    if c.client_id is null then raise exception 'Aluno não encontrado.'; end if;
    select * into i from public.app_payment_invoices where id=c.invoice_id;
    select * into p from public.app_invoice_provider_payments where invoice_id=c.invoice_id;
    state:='BLOCKED'; reason:=c.reason;
    if i.status='PAGA' or i.paid_at is not null or p.status='RECEIVED' then state:='PAID'; reason:=null;
    elsif i.id is not null then
      if i.status<>'CANCELADA' and i.amount>0 and i.superseded_at is null and (
        (p.id is not null and p.provider_payment_id is not null and p.status in ('PENDING','OVERDUE')) or
        (p.id is null and i.provider_status is null and i.issued_at is null and nullif(i.pix_payload,'') is null)
      ) then state:='AVAILABLE'; reason:=null;
      else reason:='Esta cobrança precisa de revisão antes da baixa.'; end if;
    elsif (c.state in ('ELIGIBLE','ELIGIBLE_WITH_WARNING') or c.reason='MISSING_VALID_CPF') and c.amount>0
      and not exists(select 1 from public.app_clients where id=p_client_id and plan_cancel_at<=c.due_date) then
      state:='AVAILABLE'; reason:=null;
    end if;
    result:=result||jsonb_build_array(jsonb_build_object('invoice_month',m,'invoice_id',i.id,
      'amount',c.amount,'due_date',c.due_date,'family_billing',c.family_billing,
      'state',state,'reason',reason,'received_on',i.received_on,'received_method',i.received_method));
  end loop;
  return result;
end;
$$;
revoke all on function private.monthly_receipt_calendar(uuid) from public,anon,authenticated,service_role;

create function public.admin_get_monthly_receipt_calendar(p_client_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not (coalesce(public.has_club_permission('finance.read'),false)
    or coalesce(public.has_club_permission('finance.write'),false)) then
    raise exception 'Sem acesso ao financeiro.' using errcode='42501';
  end if;
  return private.monthly_receipt_calendar(p_client_id);
end;
$$;
revoke all on function public.admin_get_monthly_receipt_calendar(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_monthly_receipt_calendar(uuid) to authenticated;

create table private.monthly_receipt_batches (
  request_id uuid primary key,
  client_id uuid not null references public.app_clients(id),
  actor_id uuid not null references auth.users(id),
  request jsonb not null,
  invoices jsonb not null,
  created_at timestamptz not null default now()
);
alter table private.monthly_receipt_batches enable row level security;
revoke all on private.monthly_receipt_batches from public,anon,authenticated,service_role;

-- Only the finance-authorized Edge handler may prepare a receipt batch.
-- All months validate before any provider operation; a changed value rolls back preparation.
create function public.prepare_monthly_receipt_batch(p_client_id uuid,p_actor_id uuid,p_request_id uuid,
  p_months jsonb,p_method text,p_received_on date,p_notes text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved private.monthly_receipt_batches%rowtype; req jsonb; entry jsonb; option jsonb;
  calendar jsonb; months jsonb; invoice public.app_payment_invoices%rowtype; m date;
  result jsonb:='[]'::jsonb; today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if p_client_id is null or p_actor_id is null or p_request_id is null or p_method is null
    or p_method not in ('CASH','CLUB_PIX') or p_received_on is null or p_received_on>today
    or p_received_on<date '2000-01-01' or jsonb_typeof(p_months) is distinct from 'array'
    or jsonb_array_length(p_months) not between 1 and 12 then raise exception 'Confira os meses, a forma e a data recebida.'; end if;
  if (select count(distinct value->>'month') from jsonb_array_elements(p_months))<>jsonb_array_length(p_months) then
    raise exception 'Não repita o mesmo mês.'; end if;
  for entry in select value from jsonb_array_elements(p_months) loop
    if jsonb_typeof(entry) is distinct from 'object' or entry-'month'-'expectedAmount'<>'{}'::jsonb
      or coalesce(entry->>'month','')!~'^\d{4}-\d{2}-01$'
      or jsonb_typeof(entry->'expectedAmount') is distinct from 'number'
      or (entry->>'expectedAmount')::numeric<=0 then raise exception 'Seleção de meses inválida.'; end if;
  end loop;
  select jsonb_agg(value order by value->>'month') into months from jsonb_array_elements(p_months);
  req:=jsonb_build_object('months',months,'method',p_method,'receivedOn',p_received_on,'notes',left(nullif(trim(p_notes),''),500));
  perform pg_advisory_xact_lock(hashtextextended('ilha-receipt-batch:'||p_request_id::text,0));
  select * into saved from private.monthly_receipt_batches where request_id=p_request_id;
  if found then
    if saved.client_id<>p_client_id or saved.actor_id<>p_actor_id or saved.request<>req then
      raise exception 'Esta confirmação já está vinculada a outros dados.'; end if;
    return jsonb_build_object('invoices',saved.invoices,'requestId',p_request_id);
  end if;
  for entry in select value from jsonb_array_elements(months) loop
    m:=(entry->>'month')::date;
    perform pg_advisory_xact_lock(hashtextextended('ilha-monthly-billing:'||m::text,0));
    perform pg_advisory_xact_lock(hashtextextended('ilha-monthly-manual:'||m::text,0));
  end loop;
  perform 1 from public.app_clients where id=p_client_id for update;
  perform 1 from public.app_family_members where billing_responsible_id=p_client_id and status in ('PENDENTE','ATIVO') order by id for update;
  calendar:=private.monthly_receipt_calendar(p_client_id);
  perform set_config('ilha.monthly_billing_write','1',true);
  for entry in select value from jsonb_array_elements(months) loop
    m:=(entry->>'month')::date;
    select value into option from jsonb_array_elements(calendar) where value->>'invoice_month'=m::text;
    if option is null or option->>'state'<>'AVAILABLE' then
      raise exception 'O mês % já está pago ou precisa de revisão. Atualize a seleção.',to_char(m,'MM/YYYY'); end if;
    if (option->>'amount')::numeric is distinct from (entry->>'expectedAmount')::numeric then
      raise exception 'O valor de % mudou. Confira antes de receber.',to_char(m,'MM/YYYY'); end if;
    select * into invoice from public.app_payment_invoices where id=(option->>'invoice_id')::uuid for update;
    if invoice.id is null then
      insert into public.app_payment_invoices(client_id,invoice_month,description,plan_code,plan_name,
        amount,due_date,status,payment_method,family_billing,notes)
      select id,m,'Mensalidade '||to_char(m,'MM/YYYY'),case when (option->>'family_billing')::boolean then 'familia' else official_plan_code end,
        case when (option->>'family_billing')::boolean then 'Conta familiar' else official_plan_name end,
        (option->>'amount')::numeric,(option->>'due_date')::date,'ABERTA',p_method,(option->>'family_billing')::boolean,
        'Recebimento por competência solicitado pelo ADM; próximas mensalidades mantidas.'
      from public.app_clients where id=p_client_id returning * into strict invoice;
      if invoice.family_billing then
        insert into public.app_family_invoice_items(invoice_id,beneficiary_client_id,item_type,description,amount)
          select invoice.id,id,'RESPONSAVEL',full_name,coalesce(plan_amount,0) from public.app_clients where id=p_client_id;
        insert into public.app_family_invoice_items(invoice_id,family_member_id,beneficiary_client_id,item_type,description,amount)
          select invoice.id,id,member_client_id,'MEMBRO',full_name,coalesce(monthly_amount,0)
          from public.app_family_members where billing_responsible_id=p_client_id and status='ATIVO'
            and (not coalesce(responsible_confirmation_required,false) or responsible_confirmed_at is not null or billing_authorized_at is not null)
          order by id;
      end if;
    elsif invoice.status in ('PAGA','CANCELADA') or invoice.paid_at is not null or invoice.superseded_at is not null
      or invoice.amount is distinct from (entry->>'expectedAmount')::numeric then
      raise exception 'A fatura mudou durante a conferência. Atualize a página.';
    end if;
    result:=result||jsonb_build_array(jsonb_build_object('invoiceId',invoice.id,'month',m,'amount',invoice.amount));
  end loop;
  insert into private.monthly_receipt_batches(request_id,client_id,actor_id,request,invoices)
    values(p_request_id,p_client_id,p_actor_id,req,result);
  return jsonb_build_object('invoices',result,'requestId',p_request_id);
end;
$$;
revoke all on function public.prepare_monthly_receipt_batch(uuid,uuid,uuid,jsonb,text,date,text) from public,anon,authenticated,service_role;
grant execute on function public.prepare_monthly_receipt_batch(uuid,uuid,uuid,jsonb,text,date,text) to service_role;

commit;
