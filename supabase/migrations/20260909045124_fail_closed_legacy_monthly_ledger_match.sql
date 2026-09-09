begin;

-- A legacy monthly ledger row may only be adopted while it is still open.
-- Closed or concurrently changed rows must fail closed instead of causing a
-- second ledger row to be inserted for the same historical charge.
create or replace function private.ensure_app_invoice_financial_transaction(
  p_invoice_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice_row public.app_payment_invoices%rowtype;
  client_name text;
  transaction_row public.financial_transactions%rowtype;
  legacy_row public.financial_transactions%rowtype;
  legacy_ids uuid[];
  invoice_processing_method text;
begin
  select invoice.* into strict invoice_row
  from public.app_payment_invoices as invoice
  where invoice.id = p_invoice_id
  for update of invoice;

  invoice_processing_method := case
    when upper(coalesce(invoice_row.payment_method, '')) in ('CLUB_PIX', 'CASH', 'PIX_CLUBE', 'DINHEIRO') then 'MANUAL'
    else 'ASAAS'
  end;

  select client.full_name into strict client_name
  from public.app_clients as client
  where client.id = invoice_row.client_id;

  select ledger.* into transaction_row
  from public.financial_transactions as ledger
  where ledger.app_payment_invoice_id = p_invoice_id
  for update;

  if found then
    if transaction_row.type <> 'RECEITA'
       or transaction_row.amount is distinct from invoice_row.amount
       or transaction_row.due_date is distinct from invoice_row.due_date
       or transaction_row.ledger_origin <> 'APP_MONTHLY_INVOICE'
       or transaction_row.processing_method <> invoice_processing_method then
      raise exception 'O lançamento financeiro vinculado diverge do snapshot da fatura.'
        using errcode = '23514';
    end if;
    return transaction_row.id;
  end if;

  select coalesce(array_agg(ledger.id order by ledger.id), '{}'::uuid[])
    into legacy_ids
  from public.financial_transactions as ledger
  where ledger.app_payment_invoice_id is null
    and ledger.recurring_rule_id is null
    and ledger.ledger_origin = 'LEGACY'
    and ledger.type = 'RECEITA'
    and ledger.amount = invoice_row.amount
    and ledger.due_date is not distinct from invoice_row.due_date
    and lower(trim(coalesce(ledger.counterparty, ''))) = lower(trim(client_name))
    and lower(coalesce(ledger.category, '')) in ('mensalidade', 'aulas')
    and lower(ledger.description) like '%mensalidade%';

  if cardinality(legacy_ids) > 1 then
    raise exception 'Mais de um lançamento legado corresponde à fatura mensal.' using errcode = '23514';
  end if;

  perform pg_catalog.set_config('ilha.monthly_billing_write', '1', true);
  if cardinality(legacy_ids) = 1 then
    select ledger.* into legacy_row
    from public.financial_transactions as ledger
    where ledger.id = legacy_ids[1]
    for update;

    if not found
       or legacy_row.app_payment_invoice_id is not null
       or legacy_row.recurring_rule_id is not null
       or legacy_row.ledger_origin <> 'LEGACY'
       or legacy_row.type <> 'RECEITA'
       or legacy_row.amount is distinct from invoice_row.amount
       or legacy_row.due_date is distinct from invoice_row.due_date
       or lower(trim(coalesce(legacy_row.counterparty, ''))) <> lower(trim(client_name))
       or lower(coalesce(legacy_row.category, '')) not in ('mensalidade', 'aulas')
       or lower(legacy_row.description) not like '%mensalidade%' then
      raise exception 'O lançamento legado mudou durante a vinculação da fatura mensal.'
        using errcode = '23514';
    end if;

    if upper(coalesce(legacy_row.status, '')) not in ('ABERTO', 'VENCIDO') then
      raise exception 'Um lançamento legado já encerrado corresponde à fatura mensal; revise antes de vincular.'
        using errcode = '23514';
    end if;

    update public.financial_transactions
       set app_payment_invoice_id = p_invoice_id,
           processing_method = invoice_processing_method,
           ledger_origin = 'APP_MONTHLY_INVOICE',
           classification = 'FIXO',
           updated_at = now()
     where id = legacy_row.id
    returning * into strict transaction_row;

    return transaction_row.id;
  end if;

  insert into public.financial_transactions (
    app_payment_invoice_id, counterparty, description, category, type,
    classification, amount, due_date, paid_at, status, payment_method,
    processing_method, ledger_origin, notes
  ) values (
    p_invoice_id, client_name, invoice_row.description, 'Mensalidade', 'RECEITA',
    'FIXO', invoice_row.amount, invoice_row.due_date, invoice_row.paid_at,
    case
      when invoice_row.status = 'PAGA' then 'RECEBIDO'
      when invoice_row.status = 'VENCIDA' then 'VENCIDO'
      when invoice_row.status = 'CANCELADA' then 'CANCELADO'
      else 'ABERTO'
    end,
    invoice_row.payment_method, invoice_processing_method, 'APP_MONTHLY_INVOICE',
    'Gerado pelo financeiro mensal do Ilha Play.'
  ) returning * into strict transaction_row;

  return transaction_row.id;
end;
$$;

revoke all on function private.ensure_app_invoice_financial_transaction(uuid)
  from public, anon, authenticated, service_role;

comment on function private.ensure_app_invoice_financial_transaction(uuid) is
  'Vincula a fatura mensal ao razão sem adotar ou duplicar lançamentos legados já encerrados.';

commit;
