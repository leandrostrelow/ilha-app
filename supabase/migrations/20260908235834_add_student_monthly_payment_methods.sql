begin;

alter table public.app_monthly_billing_enrollments
  add column billing_method text not null default 'ASAAS_PIX';

alter table public.app_monthly_billing_enrollments
  add constraint app_monthly_billing_enrollments_method_check
  check (billing_method in ('ASAAS_PIX', 'CLUB_PIX', 'CASH'));

alter table public.app_monthly_billing_enrollment_audit
  add column previous_billing_method text not null default 'ASAAS_PIX',
  add column billing_method text not null default 'ASAAS_PIX';

alter table public.app_monthly_billing_enrollment_audit
  add constraint app_monthly_billing_enrollment_audit_method_check
  check (
    previous_billing_method in ('ASAAS_PIX', 'CLUB_PIX', 'CASH')
    and billing_method in ('ASAAS_PIX', 'CLUB_PIX', 'CASH')
  );

create index app_monthly_billing_enrollments_enabled_method_idx
  on public.app_monthly_billing_enrollments (billing_method, client_id)
  where enabled;

create or replace function public.admin_get_app_monthly_billing_enrollments()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (
    coalesce(public.has_club_permission('finance.read'), false)
    or coalesce(public.has_club_permission('finance.write'), false)
  ) then
    raise exception 'Seu acesso não permite visualizar as ativações de mensalidade.'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'clientId', enrollment.client_id,
        'enabled', enrollment.enabled,
        'billingMethod', enrollment.billing_method,
        'enabledAt', enrollment.enabled_at,
        'updatedAt', enrollment.updated_at
      ) order by enrollment.client_id)
      from public.app_monthly_billing_enrollments as enrollment
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_get_app_monthly_billing_enrollments()
  from public, anon, authenticated, service_role;
grant execute on function public.admin_get_app_monthly_billing_enrollments()
  to authenticated;

drop function public.admin_set_app_monthly_billing_enrollment(uuid, boolean);

create function public.admin_set_app_monthly_billing_enrollment(
  p_client_id uuid,
  p_enabled boolean,
  p_billing_method text default 'ASAAS_PIX'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_row public.app_monthly_billing_enrollments%rowtype;
  saved_row public.app_monthly_billing_enrollments%rowtype;
  candidate record;
  previous_enabled boolean := false;
  previous_method text := 'ASAAS_PIX';
  normalized_method text := upper(trim(coalesce(p_billing_method, 'ASAAS_PIX')));
  validation_month date := (date_trunc(
    'month',
    now() at time zone 'America/Sao_Paulo'
  ) + interval '1 month')::date;
begin
  if (select auth.uid()) is null
    or not coalesce(public.has_club_permission('finance.write'), false) then
    raise exception 'Seu acesso não permite alterar as ativações de mensalidade.'
      using errcode = '42501';
  end if;
  if p_client_id is null or p_enabled is null then
    raise exception 'Informe o aluno e o estado da cobrança mensal.'
      using errcode = '22023';
  end if;
  if normalized_method not in ('ASAAS_PIX', 'CLUB_PIX', 'CASH') then
    raise exception 'Escolha Pix Asaas, Pix do clube ou dinheiro.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.app_clients where id = p_client_id) then
    raise exception 'Aluno não encontrado.' using errcode = 'P0002';
  end if;

  select * into previous_row
    from public.app_monthly_billing_enrollments
   where client_id = p_client_id
   for update;
  if found then
    previous_enabled := previous_row.enabled;
    previous_method := previous_row.billing_method;
  end if;

  if p_enabled and (
    not previous_enabled
    or previous_method is distinct from normalized_method
  ) then
    select * into candidate
      from private.monthly_billing_candidates(validation_month, p_client_id)
     limit 1;
    if candidate.client_id is null then
      raise exception 'O responsável financeiro não está disponível para cobrança.'
        using errcode = '22023';
    end if;
    if candidate.state = 'SKIPPED' and not (
      normalized_method in ('CLUB_PIX', 'CASH')
      and candidate.reason = 'MISSING_VALID_CPF'
    ) then
      raise exception 'Este cadastro ainda não pode receber mensalidade: %.',
        coalesce(candidate.reason, 'revise o plano e os dados financeiros')
        using errcode = '22023';
    end if;
  end if;

  insert into public.app_monthly_billing_enrollments (
    client_id,
    enabled,
    billing_method,
    enabled_at,
    enabled_by,
    updated_at,
    updated_by
  ) values (
    p_client_id,
    p_enabled,
    normalized_method,
    case when p_enabled then now() else null end,
    case when p_enabled then (select auth.uid()) else null end,
    now(),
    (select auth.uid())
  )
  on conflict (client_id) do update
    set enabled = excluded.enabled,
        billing_method = excluded.billing_method,
        enabled_at = case
          when excluded.enabled and not app_monthly_billing_enrollments.enabled
            then now()
          when excluded.enabled then app_monthly_billing_enrollments.enabled_at
          else null
        end,
        enabled_by = case
          when excluded.enabled and not app_monthly_billing_enrollments.enabled
            then (select auth.uid())
          when excluded.enabled then app_monthly_billing_enrollments.enabled_by
          else null
        end,
        updated_at = now(),
        updated_by = (select auth.uid())
  returning * into saved_row;

  if previous_enabled is distinct from saved_row.enabled
     or previous_method is distinct from saved_row.billing_method then
    insert into public.app_monthly_billing_enrollment_audit (
      client_id,
      previous_enabled,
      enabled,
      previous_billing_method,
      billing_method,
      changed_by
    ) values (
      saved_row.client_id,
      previous_enabled,
      saved_row.enabled,
      previous_method,
      saved_row.billing_method,
      (select auth.uid())
    );
  end if;

  return jsonb_build_object(
    'clientId', saved_row.client_id,
    'enabled', saved_row.enabled,
    'billingMethod', saved_row.billing_method,
    'enabledAt', saved_row.enabled_at,
    'updatedAt', saved_row.updated_at
  );
end;
$$;

revoke all on function public.admin_set_app_monthly_billing_enrollment(uuid, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_app_monthly_billing_enrollment(uuid, boolean, text)
  to authenticated;

create or replace function public.generate_enrolled_app_monthly_pix_billing(
  p_invoice_month date,
  p_client_id uuid default null,
  p_provider_environment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  month_start date;
  enrollment record;
  generated jsonb;
  result_rows jsonb := '[]'::jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Esta operação exige a função de serviço.' using errcode = '42501';
  end if;
  if p_invoice_month is null then
    raise exception 'Informe a competência da cobrança.' using errcode = '22023';
  end if;
  month_start := date_trunc('month', p_invoice_month::timestamp)::date;
  if p_invoice_month <> month_start then
    raise exception 'A competência precisa usar o primeiro dia do mês.' using errcode = '22023';
  end if;

  if p_client_id is not null then
    perform 1
      from public.app_monthly_billing_enrollments
     where client_id = p_client_id
       and enabled
       and billing_method = 'ASAAS_PIX'
     for share;
    if not found then
      raise exception 'A cobrança Pix Asaas deste aluno está desativada ou usa pagamento manual.'
        using errcode = '22023';
    end if;
    if exists (
      select 1
        from public.app_payment_invoices as invoice
       where invoice.client_id = p_client_id
         and invoice.invoice_month = month_start
         and invoice.payment_method in ('CLUB_PIX', 'CASH')
    ) then
      raise exception 'A mensalidade deste mês já foi criada para pagamento manual.'
        using errcode = '22023';
    end if;
    return public.generate_app_monthly_pix_billing(
      month_start,
      p_client_id,
      p_provider_environment
    );
  end if;

  for enrollment in
    select client_id
      from public.app_monthly_billing_enrollments
     where enabled
       and billing_method = 'ASAAS_PIX'
     order by client_id
     for share
  loop
    if exists (
      select 1
        from public.app_payment_invoices as invoice
       where invoice.client_id = enrollment.client_id
         and invoice.invoice_month = month_start
         and invoice.payment_method in ('CLUB_PIX', 'CASH')
    ) then
      continue;
    end if;
    generated := public.generate_app_monthly_pix_billing(
      month_start,
      enrollment.client_id,
      p_provider_environment
    );
    result_rows := result_rows || coalesce(generated -> 'results', '[]'::jsonb);
  end loop;

  return private.monthly_billing_preview_payload(month_start, null)
    || jsonb_build_object('results', result_rows);
end;
$$;

revoke all on function public.generate_enrolled_app_monthly_pix_billing(date, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.generate_enrolled_app_monthly_pix_billing(date, uuid, text)
  to service_role;

create function public.admin_generate_manual_app_monthly_billing(
  p_invoice_month date,
  p_client_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  month_start date;
  enrollment record;
  candidate record;
  invoice_row public.app_payment_invoices%rowtype;
  result_rows jsonb := '[]'::jsonb;
  generated_count integer := 0;
begin
  if (select auth.uid()) is null
    or not coalesce(public.has_club_permission('finance.write'), false) then
    raise exception 'Seu acesso não permite gerar mensalidades manuais.'
      using errcode = '42501';
  end if;
  if p_invoice_month is null then
    raise exception 'Informe a competência da cobrança.' using errcode = '22023';
  end if;
  month_start := date_trunc('month', p_invoice_month::timestamp)::date;
  if p_invoice_month <> month_start then
    raise exception 'A competência precisa usar o primeiro dia do mês.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ilha-monthly-manual:' || month_start::text, 0)
  );
  perform pg_catalog.set_config('ilha.monthly_billing_write', '1', true);

  for enrollment in
    select active.client_id, active.billing_method
      from public.app_monthly_billing_enrollments as active
     where active.enabled
       and active.billing_method in ('CLUB_PIX', 'CASH')
       and (p_client_id is null or active.client_id = p_client_id)
     order by active.client_id
     for share
  loop
    select * into candidate
      from private.monthly_billing_candidates(month_start, enrollment.client_id)
     limit 1;

    if candidate.client_id is null
       or (
         candidate.state not in ('ELIGIBLE', 'ELIGIBLE_WITH_WARNING', 'EXISTING')
         and not (
           candidate.state = 'SKIPPED'
           and candidate.reason = 'MISSING_VALID_CPF'
         )
       ) then
      result_rows := result_rows || jsonb_build_array(jsonb_build_object(
        'invoiceId', candidate.invoice_id,
        'clientId', enrollment.client_id,
        'state', 'SKIPPED',
        'paymentMethod', enrollment.billing_method,
        'error', coalesce(candidate.reason, 'RESPONSAVEL_INELEGIVEL')
      ));
      continue;
    end if;

    perform 1 from public.app_clients where id = enrollment.client_id for update;
    perform 1
      from public.app_family_members
     where billing_responsible_id = enrollment.client_id
       and status in ('PENDENTE', 'ATIVO')
     order by id
     for update;

    if candidate.invoice_id is not null then
      select * into strict invoice_row
        from public.app_payment_invoices
       where id = candidate.invoice_id
       for update;

      if invoice_row.provider_status is not null
         or invoice_row.issued_at is not null
         or nullif(invoice_row.pix_payload, '') is not null
         or exists (
           select 1
             from public.app_invoice_provider_payments as provider
            where provider.invoice_id = invoice_row.id
         ) then
        result_rows := result_rows || jsonb_build_array(jsonb_build_object(
          'invoiceId', invoice_row.id,
          'clientId', invoice_row.client_id,
          'state', 'SKIPPED',
          'paymentMethod', enrollment.billing_method,
          'error', 'INVOICE_ALREADY_MANAGED_BY_ASAAS'
        ));
        continue;
      end if;
    else
      insert into public.app_payment_invoices (
        client_id,
        invoice_month,
        description,
        plan_code,
        plan_name,
        amount,
        due_date,
        status,
        payment_method,
        family_billing,
        provider_status,
        notes
      )
      select
        client.id,
        month_start,
        case when candidate.family_billing
          then 'Mensalidade familiar Ilha Tênis'
          else 'Mensalidade Ilha Tênis'
        end,
        case when candidate.family_billing then 'familia' else client.official_plan_code end,
        case when candidate.family_billing then 'Conta familiar' else client.official_plan_name end,
        candidate.amount,
        candidate.due_date,
        'ABERTA',
        enrollment.billing_method,
        candidate.family_billing,
        null,
        case enrollment.billing_method
          when 'CLUB_PIX' then 'Pagamento combinado por Pix direto do clube; baixa manual pelo ADM.'
          else 'Pagamento combinado em dinheiro; baixa manual pelo ADM.'
        end
      from public.app_clients as client
      where client.id = enrollment.client_id
      returning * into strict invoice_row;

      if candidate.family_billing then
        insert into public.app_family_invoice_items (
          invoice_id,
          beneficiary_client_id,
          item_type,
          description,
          amount
        )
        select invoice_row.id, client.id, 'RESPONSAVEL', client.full_name, coalesce(client.plan_amount, 0)
          from public.app_clients as client
         where client.id = enrollment.client_id;

        insert into public.app_family_invoice_items (
          invoice_id,
          family_member_id,
          beneficiary_client_id,
          item_type,
          description,
          amount
        )
        select
          invoice_row.id,
          member.id,
          member.member_client_id,
          'MEMBRO',
          member.full_name,
          coalesce(member.monthly_amount, 0)
        from public.app_family_members as member
        where member.billing_responsible_id = enrollment.client_id
          and member.status = 'ATIVO'
          and (
            not coalesce(member.responsible_confirmation_required, false)
            or member.responsible_confirmed_at is not null
          )
        order by member.full_name, member.id;
      end if;
      generated_count := generated_count + 1;
    end if;

    perform private.ensure_app_invoice_financial_transaction(invoice_row.id);
    result_rows := result_rows || jsonb_build_array(jsonb_build_object(
      'invoiceId', invoice_row.id,
      'clientId', invoice_row.client_id,
      'state', case when invoice_row.status = 'PAGA' then 'PAID' else 'EXISTING' end,
      'paymentMethod', invoice_row.payment_method,
      'error', null
    ));
  end loop;

  if p_client_id is not null and jsonb_array_length(result_rows) = 0 then
    raise exception 'Este aluno não está ativado para Pix do clube ou dinheiro.'
      using errcode = '22023';
  end if;

  return private.monthly_billing_preview_payload(month_start, p_client_id)
    || jsonb_build_object(
      'results', result_rows,
      'manualGenerated', generated_count
    );
end;
$$;

revoke all on function public.admin_generate_manual_app_monthly_billing(date, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_generate_manual_app_monthly_billing(date, uuid)
  to authenticated;

create function public.admin_confirm_manual_monthly_payment(
  p_invoice_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice_row public.app_payment_invoices%rowtype;
  paid_time timestamptz := now();
  normalized_notes text := left(nullif(trim(p_notes), ''), 500);
begin
  if (select auth.uid()) is null
    or not coalesce(public.has_club_permission('finance.write'), false) then
    raise exception 'Seu acesso não permite confirmar recebimentos.'
      using errcode = '42501';
  end if;
  if p_invoice_id is null then
    raise exception 'Informe a fatura.' using errcode = '22023';
  end if;

  select * into strict invoice_row
    from public.app_payment_invoices
   where id = p_invoice_id
   for update;

  if invoice_row.payment_method not in ('CLUB_PIX', 'CASH')
     or invoice_row.provider_status is not null
     or invoice_row.issued_at is not null
     or nullif(invoice_row.pix_payload, '') is not null
     or exists (
       select 1
         from public.app_invoice_provider_payments as provider
        where provider.invoice_id = invoice_row.id
     ) then
    raise exception 'Somente mensalidades manuais podem ser baixadas por esta ação.'
      using errcode = '22023';
  end if;
  if invoice_row.status = 'CANCELADA' then
    raise exception 'Uma fatura cancelada não pode ser recebida.' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('ilha.monthly_billing_write', '1', true);
  perform private.ensure_app_invoice_financial_transaction(invoice_row.id);

  if invoice_row.status <> 'PAGA' then
    update public.app_payment_invoices
       set status = 'PAGA',
           paid_at = paid_time,
           notes = coalesce(normalized_notes, notes),
           updated_at = paid_time
     where id = invoice_row.id
    returning * into strict invoice_row;

    update public.financial_transactions
       set status = 'RECEBIDO',
           paid_at = invoice_row.paid_at,
           payment_method = invoice_row.payment_method,
           notes = coalesce(normalized_notes, notes),
           updated_at = paid_time
     where app_payment_invoice_id = invoice_row.id;
  end if;

  return jsonb_build_object(
    'invoiceId', invoice_row.id,
    'clientId', invoice_row.client_id,
    'status', invoice_row.status,
    'paymentMethod', invoice_row.payment_method,
    'paidAt', invoice_row.paid_at
  );
exception
  when no_data_found then
    raise exception 'Fatura não encontrada.' using errcode = 'P0002';
end;
$$;

revoke all on function public.admin_confirm_manual_monthly_payment(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_confirm_manual_monthly_payment(uuid, text)
  to authenticated;

comment on column public.app_monthly_billing_enrollments.billing_method is
  'Forma de cobrança mensal: Pix Asaas automático, Pix direto do clube ou dinheiro.';
comment on function public.admin_generate_manual_app_monthly_billing(date, uuid) is
  'Gera somente lançamentos internos para responsáveis ativados em Pix do clube ou dinheiro; nunca cria cobrança no Asaas.';
comment on function public.admin_confirm_manual_monthly_payment(uuid, text) is
  'Confirma no ADM o recebimento de uma mensalidade manual e sincroniza o lançamento financeiro.';

commit;
