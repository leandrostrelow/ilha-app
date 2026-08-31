begin;

-- Follow-up kept separate because the first family migration was already
-- exercised on staging before these privacy/service-role findings were fixed.
do $$
begin
  if to_regclass('public.app_family_members') is null
     or to_regclass('public.app_family_member_audit') is null then
    raise exception 'A correção familiar exige a migration create_family_billing_accounts.'
      using errcode = '55000';
  end if;
end;
$$;

-- A service-role JWT does not necessarily identify an auth.users row. Audit
-- those operations with a NULL actor instead of breaking the access linkage.
create or replace function private.audit_app_family_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_actor_id uuid;
begin
  select auth_user.id into audit_actor_id
    from auth.users as auth_user
   where auth_user.id = (select auth.uid());

  insert into public.app_family_member_audit (
    family_member_id,
    actor_id,
    action,
    old_data,
    new_data
  ) values (
    new.id,
    audit_actor_id,
    case when tg_op = 'INSERT' then 'CRIADO' else 'ATUALIZADO' end,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new)
  );
  return new;
end;
$$;

revoke all on function private.audit_app_family_member()
  from public, anon, authenticated, service_role;

-- A transfer must not make the former payer disappear from the family. Move
-- the dependants and preserve that payer as an ordinary billed member.
create or replace function public.admin_transfer_family_billing_responsibility(
  p_current_responsible_id uuid,
  p_new_responsible_id uuid
)
returns setof public.app_family_members
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_responsible public.app_clients%rowtype;
  new_responsible public.app_clients%rowtype;
begin
  if (select auth.uid()) is null
     or not coalesce(public.has_club_permission('clients.write'), false) then
    raise exception 'Seu acesso não permite transferir a responsabilidade financeira.'
      using errcode = '42501';
  end if;
  if p_current_responsible_id is null
     or p_new_responsible_id is null
     or p_current_responsible_id = p_new_responsible_id then
    raise exception 'Escolha dois responsáveis diferentes.' using errcode = '22023';
  end if;

  select client.* into current_responsible
    from public.app_clients as client
   where client.id = p_current_responsible_id
   for update;
  if not found then
    raise exception 'Responsável atual não encontrado.' using errcode = 'P0002';
  end if;

  select client.* into new_responsible
    from public.app_clients as client
   where client.id = p_new_responsible_id
   for update;
  if not found then
    raise exception 'Novo responsável não encontrado.' using errcode = 'P0002';
  end if;

  update public.app_family_members as member
     set status = 'DESVINCULADO',
         reviewed_by = (select auth.uid()),
         reviewed_at = now(),
         rejection_reason = 'Passou a ser o responsável financeiro da família.'
   where member.billing_responsible_id = p_current_responsible_id
     and member.member_client_id = p_new_responsible_id
     and member.status in ('PENDENTE', 'ATIVO');

  return query
  update public.app_family_members as member
     set billing_responsible_id = p_new_responsible_id,
         contact_responsible_name = new_responsible.full_name,
         contact_responsible_phone = new_responsible.phone,
         reviewed_by = (select auth.uid()),
         reviewed_at = case
           when member.status = 'PENDENTE' then null
           else now()
         end
   where member.billing_responsible_id = p_current_responsible_id
     and member.status in ('PENDENTE', 'ATIVO')
     and member.member_client_id is distinct from p_new_responsible_id
  returning member.*;

  if exists (
    select 1
      from public.app_family_members as member
     where member.billing_responsible_id = p_new_responsible_id
       and member.member_client_id = p_current_responsible_id
       and member.status in ('PENDENTE', 'ATIVO')
  ) then
    return query
    update public.app_family_members as member
       set full_name = current_responsible.full_name,
           birth_date = coalesce(current_responsible.birth_date, member.birth_date),
           cpf = coalesce(current_responsible.cpf, member.cpf),
           phone = coalesce(current_responsible.phone, member.phone),
           contact_responsible_name = new_responsible.full_name,
           contact_responsible_phone = new_responsible.phone,
           monthly_amount = coalesce(
             member.monthly_amount,
             nullif(current_responsible.plan_amount, 0)
           ),
           status = 'ATIVO',
           reviewed_by = (select auth.uid()),
           reviewed_at = now(),
           rejection_reason = null
     where member.billing_responsible_id = p_new_responsible_id
       and member.member_client_id = p_current_responsible_id
       and member.status in ('PENDENTE', 'ATIVO')
    returning member.*;
  else
    return query
    insert into public.app_family_members (
      billing_responsible_id,
      member_client_id,
      full_name,
      relationship,
      birth_date,
      cpf,
      phone,
      contact_responsible_name,
      contact_responsible_phone,
      monthly_amount,
      status,
      reviewed_by,
      reviewed_at,
      notes
    ) values (
      p_new_responsible_id,
      current_responsible.id,
      current_responsible.full_name,
      'Outro',
      current_responsible.birth_date,
      current_responsible.cpf,
      current_responsible.phone,
      new_responsible.full_name,
      new_responsible.phone,
      nullif(current_responsible.plan_amount, 0),
      'ATIVO',
      (select auth.uid()),
      now(),
      'Antigo responsável financeiro mantido como membro após transferência.'
    )
    returning *;
  end if;
end;
$$;

revoke all on function public.admin_transfer_family_billing_responsibility(uuid, uuid)
  from public, anon;
grant execute on function public.admin_transfer_family_billing_responsibility(uuid, uuid)
  to authenticated;

-- Resolve the effective payer for both sides of the relationship. Members get
-- only their own sanitized card, no family total and no sibling/dependant list.
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
              'is_minor',
                member.birth_date is not null
                and member.birth_date > (
                  (now() at time zone 'America/Sao_Paulo')::date - interval '18 years'
                )::date,
              'lessons', case
                when member.birth_date is not null
                 and member.birth_date > (
                   (now() at time zone 'America/Sao_Paulo')::date - interval '18 years'
                 )::date
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
                when member.birth_date is not null
                 and member.birth_date > (
                   (now() at time zone 'America/Sao_Paulo')::date - interval '18 years'
                 )::date
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

comment on function private.get_my_family_summary_impl(uuid) is
  'Resolve o pagador efetivo sem expor financeiro, familiares ou agenda adulta para membros vinculados.';

commit;
