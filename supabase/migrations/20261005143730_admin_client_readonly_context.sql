-- Share the existing family read model; no customer data is modified.
CREATE OR REPLACE FUNCTION private.client_family_summary_data(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    when p_user_id is null then
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
$function$
;

revoke all on function private.client_family_summary_data(uuid) from public, anon, authenticated, service_role;

-- Keep the customer endpoint restricted to the signed-in customer.
create or replace function private.get_my_family_summary_impl(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
 select case when (select auth.uid()) is not null and p_user_id = (select auth.uid())
 then private.client_family_summary_data(p_user_id)
 else jsonb_build_object('billing_responsible',null,'is_billing_responsible',false,'total_monthly_amount',0,'members','[]'::jsonb) end
$$;

-- Read-only projection for an authorized administrator, with no session switch.
create or replace function public.admin_get_client_area_context(p_client_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
 if (select auth.uid()) is null or not public.has_club_permission('clients.read') or not public.has_club_permission('finance.read') then
   raise exception 'Acesso administrativo necessário.' using errcode='42501';
 end if;
 if not exists(select 1 from public.app_clients where id=p_client_id) then
   raise exception 'Cadastro não encontrado.' using errcode='22023';
 end if;
 return jsonb_build_object(
   'family',private.client_family_summary_data(p_client_id),
   'dismissals',case when public.has_club_permission('communication') then coalesce((
     select jsonb_agg(jsonb_build_object('source_type',d.source_type,'source_id',d.source_id))
     from public.app_notification_dismissals d where d.user_id=p_client_id
   ),'[]'::jsonb) else '[]'::jsonb end,
   'challenges',coalesce((
     select jsonb_agg(jsonb_build_object('id',b.id,'client_id',b.client_id,'client_name',b.client_name,'opponent_client_id',b.opponent_client_id,'opponent_name',b.opponent_name,'booking_date',b.booking_date,'starts_at',b.starts_at,'court_name',b.court_name,'notes',b.notes,'challenge_kind',b.challenge_kind,'challenge_expires_at',b.challenge_expires_at,'is_owner',b.client_id=p_client_id,'is_invited',b.opponent_client_id=p_client_id,'can_accept',b.client_id<>p_client_id and (b.challenge_kind='ABERTO' or b.opponent_client_id=p_client_id)) order by b.booking_date,b.starts_at,b.created_at)
     from public.app_court_bookings b where b.status='PENDENTE' and b.challenge_expires_at>now()
       and b.booking_date between (now() at time zone 'America/Sao_Paulo')::date and (now() at time zone 'America/Sao_Paulo')::date+45
       and (b.client_id=p_client_id or b.opponent_client_id=p_client_id or b.challenge_kind='ABERTO')
   ),'[]'::jsonb),
   'lessons',case when public.has_club_permission('classes') then coalesce((
     select jsonb_agg(jsonb_build_object('id',s.id,'day',s.day,'time',s.time,'court_name',s.court_name,'teacher_name',s.teacher_name,'level',s.level,'enrollment_type',e.type) order by s.day,s.time)
     from public.students student
     join public.lesson_enrollments e on e.student_id=student.id and e.active
     join public.lesson_slots s on s.id=e.slot_id and s.active
     where student.app_client_id=p_client_id
   ),'[]'::jsonb) else '[]'::jsonb end
 );
end
$$;
revoke all on function public.admin_get_client_area_context(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_client_area_context(uuid) to authenticated;
comment on function public.admin_get_client_area_context(uuid) is 'Read-only ADM preview context. Explicit client/finance authorization; no credentials, impersonation or writes.';
