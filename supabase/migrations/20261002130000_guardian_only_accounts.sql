-- A responsible account owns the payments, but is not itself a student.
create or replace function private.normalize_guardian_only_account()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.client_type = 'responsavel' then
    new.plan_amount := 0;
    new.weekly_lessons := 0;
    new.official_plan_id := null;
    new.official_plan_code := '';
    new.official_plan_name := '';
    new.preferred_days := '[]'::jsonb;
  end if;
  return new;
end;
$$;
create trigger z_normalize_guardian_only_account before insert or update on public.app_clients
for each row execute function private.normalize_guardian_only_account();

-- Retain the historical student record; never delete a child's linked record.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.sync_app_client_lesson_student()'::regprocedure);
  if position('  if coalesce(new.weekly_lessons, 0) <= 0' in definition)=0 then
    raise exception 'Unexpected student sync definition';
  end if;
  definition := replace(definition, '  if coalesce(new.weekly_lessons, 0) <= 0', $body$
  if new.client_type = 'responsavel' then
    update public.lesson_enrollments e set active=false,updated_at=now()
      from public.students s where s.app_client_id=new.id and e.student_id=s.id and e.active;
    update public.students set status='INATIVO',relationship_status='INATIVO',
      weekly_lessons=0,monthly_value=0,updated_at=now() where app_client_id=new.id;
    return new;
  end if;
  if coalesce(new.weekly_lessons, 0) <= 0$body$);
  execute definition;
end;
$$;
drop trigger sync_app_client_lesson_student on public.app_clients;
create trigger sync_app_client_lesson_student after update of client_type,official_plan_id,
official_plan_code,official_plan_name,plan_amount,weekly_lessons,status on public.app_clients
for each row execute function public.sync_app_client_lesson_student();

create or replace function private.guard_guardian_student()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.app_clients c where c.id=new.app_client_id and c.client_type='responsavel') then
    new.status := 'INATIVO'; new.relationship_status := 'INATIVO';
    new.weekly_lessons := 0; new.monthly_value := 0;
  end if;
  return new;
end;
$$;
create trigger guard_guardian_student before insert or update on public.students
for each row execute function private.guard_guardian_student();

create or replace function private.guard_guardian_enrollment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.active and exists(select 1 from public.students s join public.app_clients c on c.id=s.app_client_id
    where s.id=new.student_id and c.client_type='responsavel') then
    raise exception 'Responsável não participa das aulas. Selecione o filho na família.' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger guardian_enrollment_guard before insert or update on public.lesson_enrollments
for each row execute function private.guard_guardian_enrollment();

alter table public.app_court_bookings add column family_member_id uuid
references public.app_family_members(id) on delete restrict;
create index app_court_bookings_family_member_idx on public.app_court_bookings(family_member_id)
where family_member_id is not null;

-- Reuse the existing court locks, availability checks and daily limits.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.book_my_app_court(date,time,text,text,text,uuid)'::regprocedure);
  if position('  if p_booking_date < v_today' in definition)=0 or position('v_client.id, trim(v_client.full_name)' in definition)=0 then
    raise exception 'Unexpected court booking definition';
  end if;
  definition := replace(definition,'public.book_my_app_court(', 'private.book_my_app_court_for_member(');
  definition := replace(definition,'p_opponent_client_id uuid DEFAULT NULL::uuid)',
    'p_opponent_client_id uuid DEFAULT NULL::uuid, p_family_member_id uuid DEFAULT NULL::uuid)');
  definition := replace(definition,'  v_client public.app_clients%rowtype;',
    '  v_client public.app_clients%rowtype; v_member public.app_family_members%rowtype;');
  definition := replace(definition,'  if p_booking_date < v_today', $body$
  if p_family_member_id is not null then
    select * into v_member from public.app_family_members
      where id=p_family_member_id and billing_responsible_id=v_client.id and status='ATIVO' for share;
    if v_member.id is null then
      raise exception 'Selecione um membro ativo da sua família.' using errcode='42501';
    end if;
  elsif v_client.client_type='responsavel' then
    raise exception 'Selecione o filho para quem deseja reservar.' using errcode='22023';
  end if;
  if p_booking_date < v_today$body$);
  definition := replace(definition,'client_id, client_name, opponent_client_id, opponent_name,',
    'client_id, client_name, family_member_id, opponent_client_id, opponent_name,');
  definition := replace(definition,'v_client.id, trim(v_client.full_name), v_opponent.id, v_opponent_name,',
    'v_client.id, coalesce(v_member.full_name,trim(v_client.full_name)), v_member.id, v_opponent.id, v_opponent_name,');
  execute definition;
end;
$$;
revoke all on function private.book_my_app_court_for_member(date,time,text,text,text,uuid,uuid) from public,anon,authenticated;

create or replace function public.book_my_app_court(p_booking_date date,p_starts_at time,p_court_name text,
p_opponent_name text,p_notes text default null,p_opponent_client_id uuid default null)
returns public.app_court_bookings language sql security definer set search_path = '' as $$
 select private.book_my_app_court_for_member(p_booking_date,p_starts_at,p_court_name,p_opponent_name,p_notes,p_opponent_client_id,null);
$$;
create or replace function public.book_my_family_court(p_family_member_id uuid,p_booking_date date,p_starts_at time,
p_court_name text,p_opponent_name text,p_notes text default null,p_opponent_client_id uuid default null)
returns public.app_court_bookings language plpgsql security definer set search_path = '' as $$
begin
  if p_family_member_id is null then raise exception 'Selecione um membro da família.' using errcode='22023'; end if;
  return private.book_my_app_court_for_member(p_booking_date,p_starts_at,p_court_name,p_opponent_name,p_notes,p_opponent_client_id,p_family_member_id);
end;
$$;
revoke all on function public.book_my_family_court(uuid,date,time,text,text,text,uuid) from public,anon;
grant execute on function public.book_my_family_court(uuid,date,time,text,text,text,uuid) to authenticated,service_role;

create or replace function private.guard_guardian_court_booking()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status='CANCELADO' then return new; end if;
  if new.family_member_id is not null then
    if not exists(select 1 from public.app_family_members m where m.id=new.family_member_id
      and m.billing_responsible_id=new.client_id and m.status='ATIVO') then
      raise exception 'O membro não pertence a esta conta familiar.' using errcode='42501';
    end if;
  elsif exists(select 1 from public.app_clients c where c.id=new.client_id and c.client_type='responsavel') then
    raise exception 'Reserve em nome de um filho, não do responsável.' using errcode='23514';
  end if;
  if exists(select 1 from public.app_clients c where c.id=new.opponent_client_id and c.client_type='responsavel') then
    raise exception 'Selecione um jogador, não uma conta de responsável.' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger guard_guardian_court_booking before insert or update on public.app_court_bookings
for each row execute function private.guard_guardian_court_booking();

do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.get_active_court_opponents()'::regprocedure);
  if position('and client.id <> auth.uid()' in definition)=0 then raise exception 'Unexpected opponent query'; end if;
  execute replace(definition,'and client.id <> auth.uid()', 'and client.id <> auth.uid() and client.client_type <> ''responsavel''');
end;
$$;

revoke all on function private.normalize_guardian_only_account(),private.guard_guardian_student(),
private.guard_guardian_enrollment(),private.guard_guardian_court_booking() from public,anon,authenticated;
