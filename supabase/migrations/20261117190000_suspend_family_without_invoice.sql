begin;
-- A temporary absence does not require a debt or cancellation of a paid invoice.
create table private.family_enrollment_suspensions (
 id uuid primary key default gen_random_uuid(),
 family_member_id uuid not null references public.app_family_members(id),
 actor_id uuid not null references auth.users(id),
 reason text not null,
 before_state jsonb not null,
 created_at timestamptz not null default now()
);
revoke all on private.family_enrollment_suspensions from public,anon,authenticated,service_role;

create function public.admin_suspend_family_enrollment(p_member_id uuid,p_expected_updated_at timestamptz,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.app_family_members%rowtype; c public.app_clients%rowtype; student_ids uuid[]; snapshot jsonb;
begin
 if auth.uid() is null or not coalesce(public.has_club_permission('clients.write'),false)
 or not coalesce(public.has_club_permission('finance.write'),false) or not coalesce(public.has_club_permission('classes'),false) then
   raise exception 'Sem permissão para suspender aulas.' using errcode='42501';
 end if;
 if length(trim(coalesce(p_reason,''))) not between 5 and 500 then
   raise exception 'Informe um motivo de 5 a 500 caracteres.' using errcode='22023';
 end if;
 select * into m from public.app_family_members where id=p_member_id for update;
 if not found or m.status<>'ATIVO' then
   raise exception 'O vínculo familiar precisa estar ativo.' using errcode='22023';
 end if;
 if m.classes_suspended then return jsonb_build_object('state','COMPLETED'); end if;
 if p_expected_updated_at is null or m.updated_at is distinct from p_expected_updated_at then
   raise exception 'O cadastro mudou. Reabra a ficha antes de continuar.' using errcode='40001';
 end if;
 if m.member_client_id is not null then
   select * into strict c from public.app_clients where id=m.member_client_id for update;
   if c.status<>'ATIVO' then raise exception 'Aprove o cadastro antes de suspender a inscrição.' using errcode='22023';end if;
 end if;
 select coalesce(array_agg(id),'{}'::uuid[]) into student_ids from public.students
 where id=m.student_id or app_client_id=m.member_client_id;
 perform 1 from public.students where id=any(student_ids) order by id for update;
 snapshot:=jsonb_build_object('member',to_jsonb(m),'client',to_jsonb(c),
 'billing',(select to_jsonb(e) from public.app_monthly_billing_enrollments e where client_id=m.member_client_id),
 'students',(select jsonb_agg(to_jsonb(s)) from public.students s where id=any(student_ids)),
 'lessons',(select jsonb_agg(to_jsonb(e)) from public.lesson_enrollments e where student_id=any(student_ids)));
 insert into private.family_enrollment_suspensions(family_member_id,actor_id,reason,before_state)
 values(m.id,auth.uid(),trim(p_reason),snapshot);
 if m.member_client_id is not null then
   perform public.admin_set_app_monthly_billing_enrollment(m.member_client_id,false,
     coalesce((select billing_method from public.app_monthly_billing_enrollments where client_id=m.member_client_id),'ASAAS_PIX'));
   update public.app_clients set status='SUSPENSO',notes=concat_ws(E'\n',nullif(notes,''),'Inscrição suspensa: '||trim(p_reason)),updated_at=now()
   where id=m.member_client_id;
 end if;
 update public.app_family_members set billing_paused=true,billing_pause_reason=trim(p_reason),classes_suspended=true where id=m.id;
 update public.lesson_enrollments set active=false,updated_at=now() where student_id=any(student_ids) and active;
 update public.students set status='INATIVO',relationship_status='INATIVO',updated_at=now() where id=any(student_ids);
 return jsonb_build_object('state','COMPLETED');
end;$$;
revoke all on function public.admin_suspend_family_enrollment(uuid,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_suspend_family_enrollment(uuid,timestamptz,text) to authenticated;
commit;
