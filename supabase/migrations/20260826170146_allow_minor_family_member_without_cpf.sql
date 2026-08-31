begin;

do $$
begin
  if to_regclass('public.app_family_members') is null then
    raise exception 'A declaração de menor exige a estrutura de membros familiares.'
      using errcode = '55000';
  end if;
end;
$$;

alter table public.app_family_members
  add column if not exists minor_without_cpf_declared boolean not null default false,
  add column if not exists minor_declared_at timestamptz;

comment on column public.app_family_members.minor_without_cpf_declared is
  'Declaração do responsável financeiro de que o membro é menor de idade e ainda não possui CPF.';
comment on column public.app_family_members.minor_declared_at is
  'Momento em que o responsável declarou a menoridade sem CPF.';

create or replace function private.validate_app_family_member()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  today_sp date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  new.full_name := nullif(trim(new.full_name), '');
  new.relationship := left(nullif(trim(new.relationship), ''), 60);
  new.cpf := nullif(pg_catalog.regexp_replace(coalesce(new.cpf, ''), '\D', '', 'g'), '');
  new.phone := nullif(pg_catalog.regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), '');
  new.contact_responsible_name := nullif(trim(new.contact_responsible_name), '');
  new.contact_responsible_phone := nullif(
    pg_catalog.regexp_replace(coalesce(new.contact_responsible_phone, ''), '\D', '', 'g'),
    ''
  );
  new.rejection_reason := left(nullif(trim(new.rejection_reason), ''), 500);
  new.notes := left(nullif(trim(new.notes), ''), 1000);

  if new.full_name is null then
    raise exception 'Informe o nome completo do membro.' using errcode = '22023';
  end if;
  if new.contact_responsible_name is null then
    raise exception 'O contato do responsável financeiro é obrigatório.' using errcode = '22023';
  end if;
  if new.birth_date is not null
     and (new.birth_date < date '1900-01-01' or new.birth_date > today_sp) then
    raise exception 'Data de nascimento inválida.' using errcode = '22023';
  end if;
  if new.minor_without_cpf_declared is true
     and new.birth_date is not null
     and new.birth_date <= (today_sp - interval '18 years')::date then
    raise exception 'A data informada não corresponde a uma pessoa menor de idade.'
      using errcode = '22023';
  end if;
  if new.minor_without_cpf_declared is true and new.cpf is not null then
    new.minor_without_cpf_declared := false;
    new.minor_declared_at := null;
  end if;
  if new.birth_date is null
     and new.cpf is null
     and new.minor_without_cpf_declared is not true
     and not (
       new.responsible_confirmation_required is true
       and new.requested_by_client_id is null
     ) then
    raise exception 'Informe o CPF, a data de nascimento ou declare que o membro é menor sem CPF.'
      using errcode = '22023';
  end if;
  if new.birth_date is not null
     and new.birth_date <= (today_sp - interval '18 years')::date
     and new.cpf is null
     and new.minor_without_cpf_declared is not true
     and not (
       new.responsible_confirmation_required is true
       and new.requested_by_client_id is null
     ) then
    raise exception 'CPF é obrigatório para membros adultos.' using errcode = '22023';
  end if;
  if new.cpf is not null and not public.is_valid_cpf(new.cpf) then
    raise exception 'CPF do membro inválido.' using errcode = '22023';
  end if;
  if new.monthly_amount is not null and new.monthly_amount < 0 then
    raise exception 'O valor mensal não pode ser negativo.' using errcode = '22023';
  end if;
  if new.member_client_id = new.billing_responsible_id then
    raise exception 'O responsável não pode ser membro financeiro de si mesmo.' using errcode = '22023';
  end if;
  if new.responsible_confirmation_required is false then
    new.responsible_confirmed_at := coalesce(new.responsible_confirmed_at, now());
  end if;
  if new.minor_without_cpf_declared is true then
    new.minor_declared_at := coalesce(new.minor_declared_at, now());
  else
    new.minor_declared_at := null;
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function private.validate_app_family_member()
  from public, anon, authenticated, service_role;

drop function if exists public.confirm_family_member_details(uuid, date, text, text);
drop function if exists private.confirm_family_member_details_impl(uuid, date, text, text);

create or replace function private.confirm_family_member_details_impl(
  p_family_member_id uuid,
  p_birth_date date default null,
  p_cpf text default null,
  p_phone text default null,
  p_minor_without_cpf boolean default false
)
returns public.app_family_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  current_member public.app_family_members%rowtype;
  saved public.app_family_members%rowtype;
  today_sp date := (now() at time zone 'America/Sao_Paulo')::date;
  next_birth_date date;
  next_cpf text;
  next_phone text;
begin
  if caller_id is null then
    raise exception 'Entre no Ilha Play para confirmar o membro.' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.app_clients as client
     where client.id = caller_id
       and upper(coalesce(client.status, '')) = 'ATIVO'
  ) then
    raise exception 'Sua conta precisa estar ativa para confirmar um membro.' using errcode = '42501';
  end if;

  select member.* into current_member
    from public.app_family_members as member
   where member.id = p_family_member_id
     and member.billing_responsible_id = caller_id
     and member.status in ('PENDENTE', 'ATIVO')
   for update;
  if not found then
    raise exception 'Membro não encontrado nesta família.' using errcode = 'P0002';
  end if;

  next_phone := coalesce(
    nullif(pg_catalog.regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), ''),
    current_member.phone
  );

  if p_minor_without_cpf is true then
    next_birth_date := p_birth_date;
    next_cpf := null;
    if next_birth_date is not null
       and next_birth_date <= (today_sp - interval '18 years')::date then
      raise exception 'A data informada não corresponde a uma pessoa menor de idade.'
        using errcode = '22023';
    end if;
  else
    next_birth_date := coalesce(p_birth_date, current_member.birth_date);
    next_cpf := coalesce(
      nullif(pg_catalog.regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), ''),
      current_member.cpf
    );
    if next_birth_date is null and next_cpf is null then
      raise exception 'Informe o CPF, a data de nascimento ou marque que é menor sem CPF.'
        using errcode = '22023';
    end if;
    if next_birth_date is not null
       and next_birth_date <= (today_sp - interval '18 years')::date
       and next_cpf is null then
      raise exception 'Informe o CPF do membro adulto.' using errcode = '22023';
    end if;
  end if;

  update public.app_family_members as member
     set birth_date = next_birth_date,
         cpf = next_cpf,
         phone = next_phone,
         minor_without_cpf_declared = p_minor_without_cpf,
         minor_declared_at = case when p_minor_without_cpf then now() else null end,
         responsible_confirmation_required = false,
         responsible_confirmed_at = now()
   where member.id = current_member.id
  returning member.* into saved;

  return saved;
end;
$$;

revoke all on function private.confirm_family_member_details_impl(uuid, date, text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function private.confirm_family_member_details_impl(uuid, date, text, text, boolean)
  to authenticated;

create or replace function public.confirm_family_member_details(
  p_family_member_id uuid,
  p_birth_date date default null,
  p_cpf text default null,
  p_phone text default null,
  p_minor_without_cpf boolean default false
)
returns public.app_family_members
language sql
security invoker
set search_path = ''
as $$
  select private.confirm_family_member_details_impl(
    p_family_member_id,
    p_birth_date,
    p_cpf,
    p_phone,
    p_minor_without_cpf
  )
$$;

revoke all on function public.confirm_family_member_details(uuid, date, text, text, boolean)
  from public, anon;
grant execute on function public.confirm_family_member_details(uuid, date, text, text, boolean)
  to authenticated;

create or replace function private.get_my_family_summary_impl(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with caller_context as (
    select
      coalesce((
        select member.billing_responsible_id
          from public.app_family_members as member
         where member.member_client_id = p_user_id
           and member.status = 'ATIVO'
         limit 1
      ), p_user_id) as effective_responsible_id,
      exists (
        select 1
          from public.app_family_members as member
         where member.member_client_id = p_user_id
           and member.status = 'ATIVO'
           and member.billing_responsible_id <> p_user_id
      ) as caller_is_member
  )
  select case
    when p_user_id is null or p_user_id <> (select auth.uid()) then
      jsonb_build_object(
        'billing_responsible', null,
        'is_billing_responsible', false,
        'total_monthly_amount', 0,
        'members', '[]'::jsonb
      )
    else coalesce((
      select jsonb_build_object(
        'billing_responsible', jsonb_build_object(
          'id', responsible.id,
          'full_name', responsible.full_name,
          'phone', responsible.phone
        ),
        'is_billing_responsible', not context.caller_is_member,
        'total_monthly_amount', case
          when context.caller_is_member then 0
          else coalesce(responsible.plan_amount, 0) + coalesce((
            select sum(coalesce(member_total.monthly_amount, 0))
              from public.app_family_members as member_total
             where member_total.billing_responsible_id = responsible.id
               and member_total.status = 'ATIVO'
          ), 0)
        end,
        'members', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', member.id,
              'full_name', member.full_name,
              'relationship', member.relationship,
              'birth_date', member.birth_date,
              'phone', member.phone,
              'status', member.status,
              'monthly_amount', case
                when context.caller_is_member then null
                else member.monthly_amount
              end,
              'has_play_access', member.member_client_id is not null,
              'has_cpf', member.cpf is not null,
              'minor_without_cpf_declared', member.minor_without_cpf_declared,
              'needs_details_confirmation',
                member.responsible_confirmation_required is true
                and member.responsible_confirmed_at is null,
              'is_minor',
                member.minor_without_cpf_declared is true
                or (
                  member.birth_date is not null
                  and member.birth_date > (
                    (now() at time zone 'America/Sao_Paulo')::date - interval '18 years'
                  )::date
                ),
              'lessons', case
                when member.minor_without_cpf_declared is true
                  or (
                    member.birth_date is not null
                    and member.birth_date > (
                      (now() at time zone 'America/Sao_Paulo')::date - interval '18 years'
                    )::date
                  )
                then coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'enrollment_id', enrollment.id,
                      'day', slot.day,
                      'time', slot.time,
                      'court_name', slot.court_name,
                      'teacher_name', slot.teacher_name,
                      'level', slot.level,
                      'type', enrollment.type
                    ) order by slot.day, slot.time
                  )
                    from public.lesson_enrollments as enrollment
                    join public.lesson_slots as slot on slot.id = enrollment.slot_id
                   where enrollment.student_id = member.student_id
                     and enrollment.active is true
                     and slot.active is true
                ), '[]'::jsonb)
                else '[]'::jsonb
              end,
              'upcoming_bookings', case
                when (
                  member.minor_without_cpf_declared is true
                  or (
                    member.birth_date is not null
                    and member.birth_date > (
                      (now() at time zone 'America/Sao_Paulo')::date - interval '18 years'
                    )::date
                  )
                )
                 and member.member_client_id is not null
                then coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'id', booking.id,
                      'booking_date', booking.booking_date,
                      'starts_at', booking.starts_at,
                      'court_name', booking.court_name,
                      'status', booking.status,
                      'client_name', booking.client_name,
                      'opponent_name', booking.opponent_name
                    ) order by booking.booking_date, booking.starts_at
                  )
                    from public.app_court_bookings as booking
                   where (
                     booking.client_id = member.member_client_id
                     or booking.opponent_client_id = member.member_client_id
                   )
                     and booking.booking_date >= (now() at time zone 'America/Sao_Paulo')::date
                     and booking.status <> 'CANCELADO'
                ), '[]'::jsonb)
                else '[]'::jsonb
              end
            ) order by member.created_at, member.full_name
          )
            from public.app_family_members as member
           where member.billing_responsible_id = responsible.id
             and member.status in ('PENDENTE', 'ATIVO')
             and (
               not context.caller_is_member
               or member.member_client_id = p_user_id
             )
        ), '[]'::jsonb)
      )
        from caller_context as context
        join public.app_clients as responsible
          on responsible.id = context.effective_responsible_id
         and responsible.status = 'ATIVO'
    ), jsonb_build_object(
      'billing_responsible', null,
      'is_billing_responsible', false,
      'total_monthly_amount', 0,
      'members', '[]'::jsonb
    ))
  end
$$;

revoke all on function private.get_my_family_summary_impl(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.get_my_family_summary_impl(uuid)
  to authenticated;

comment on function public.confirm_family_member_details(uuid, date, text, text, boolean) is
  'Permite somente ao responsável financeiro ativo confirmar o membro, incluindo declaração explícita de menor sem CPF.';

commit;
