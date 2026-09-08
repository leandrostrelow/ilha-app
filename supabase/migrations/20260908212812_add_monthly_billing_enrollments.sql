create table public.app_monthly_billing_enrollments (
  client_id uuid primary key
    references public.app_clients(id) on delete cascade,
  enabled boolean not null default false,
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint app_monthly_billing_enrollments_enabled_metadata_check check (
    not enabled or enabled_at is not null
  )
);

create index app_monthly_billing_enrollments_enabled_idx
  on public.app_monthly_billing_enrollments (client_id)
  where enabled;

create table public.app_monthly_billing_enrollment_audit (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null
    references public.app_clients(id) on delete cascade,
  previous_enabled boolean not null,
  enabled boolean not null,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index app_monthly_billing_enrollment_audit_client_created_idx
  on public.app_monthly_billing_enrollment_audit (client_id, created_at desc);

alter table public.app_monthly_billing_enrollments enable row level security;
alter table public.app_monthly_billing_enrollments force row level security;
alter table public.app_monthly_billing_enrollment_audit enable row level security;
alter table public.app_monthly_billing_enrollment_audit force row level security;

revoke all on table public.app_monthly_billing_enrollments
  from public, anon, authenticated, service_role;
revoke all on table public.app_monthly_billing_enrollment_audit
  from public, anon, authenticated, service_role;

grant select, insert, update on table public.app_monthly_billing_enrollments
  to service_role;
grant select, insert on table public.app_monthly_billing_enrollment_audit
  to service_role;

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

create or replace function public.admin_set_app_monthly_billing_enrollment(
  p_client_id uuid,
  p_enabled boolean
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
  if not exists (select 1 from public.app_clients where id = p_client_id) then
    raise exception 'Aluno não encontrado.' using errcode = 'P0002';
  end if;

  select * into previous_row
    from public.app_monthly_billing_enrollments
   where client_id = p_client_id
   for update;
  if found then
    previous_enabled := previous_row.enabled;
  end if;

  if p_enabled and not previous_enabled then
    select * into candidate
      from private.monthly_billing_candidates(validation_month, p_client_id)
     limit 1;
    if candidate.client_id is null then
      raise exception 'O responsável financeiro não está disponível para cobrança.'
        using errcode = '22023';
    end if;
    if candidate.state = 'SKIPPED' then
      raise exception 'Este cadastro ainda não pode receber mensalidade automática: %.',
        coalesce(candidate.reason, 'revise o plano e os dados financeiros')
        using errcode = '22023';
    end if;
  end if;

  insert into public.app_monthly_billing_enrollments (
    client_id,
    enabled,
    enabled_at,
    enabled_by,
    updated_at,
    updated_by
  ) values (
    p_client_id,
    p_enabled,
    case when p_enabled then now() else null end,
    case when p_enabled then (select auth.uid()) else null end,
    now(),
    (select auth.uid())
  )
  on conflict (client_id) do update
    set enabled = excluded.enabled,
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

  if previous_enabled is distinct from saved_row.enabled then
    insert into public.app_monthly_billing_enrollment_audit (
      client_id,
      previous_enabled,
      enabled,
      changed_by
    ) values (
      saved_row.client_id,
      previous_enabled,
      saved_row.enabled,
      (select auth.uid())
    );
  end if;

  return jsonb_build_object(
    'clientId', saved_row.client_id,
    'enabled', saved_row.enabled,
    'enabledAt', saved_row.enabled_at,
    'updatedAt', saved_row.updated_at
  );
end;
$$;

revoke all on function public.admin_set_app_monthly_billing_enrollment(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_app_monthly_billing_enrollment(uuid, boolean)
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
     for share;
    if not found then
      raise exception 'A cobrança mensal deste aluno está desativada.'
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
     order by client_id
     for share
  loop
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

comment on table public.app_monthly_billing_enrollments is
  'Allowlist privada e auditada dos responsáveis autorizados a receber mensalidades Pix automáticas.';
comment on function public.generate_enrolled_app_monthly_pix_billing(date, uuid, text) is
  'Gera mensalidades somente para responsáveis explicitamente ativados pelo financeiro.';
