-- One operational student per family member, even before personal details are
-- confirmed. No auth accounts, invoices, enrollments or payment links are created.
create or replace function private.sync_app_family_member_student()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.app_clients%rowtype;
  s public.students%rowtype;
  minor boolean;
begin
  if new.status <> 'ATIVO' then return new; end if;
  minor := new.minor_without_cpf_declared or
    new.birth_date > ((now() at time zone 'America/Sao_Paulo')::date - interval '18 years')::date;
  if new.member_client_id is not null then
    select * into strict c from public.app_clients where id = new.member_client_id;
  end if;
  if new.student_id is not null then
    select * into s from public.students where id = new.student_id for update;
  end if;
  if s.id is null and new.member_client_id is not null then
    select * into s from public.students where app_client_id = new.member_client_id
      order by created_at, id limit 1 for update;
  end if;
  if s.id is null then
    insert into public.students(app_client_id,name,phone,email,birth_date,guardian_name,
      status,weekly_lessons,monthly_value,plan_name,financial_status,relationship_status)
    values(new.member_client_id,new.full_name,
      coalesce(new.phone,c.phone,new.contact_responsible_phone),nullif(c.email,''),new.birth_date,
      case when minor then new.contact_responsible_name end,'ATIVO',coalesce(c.weekly_lessons,0),
      new.monthly_amount,c.official_plan_name,'OK','ATIVO') returning * into s;
  else
    if s.app_client_id is not null and new.member_client_id is not null and s.app_client_id <> new.member_client_id then
      raise exception 'O aluno já está vinculado a outra conta.' using errcode='23505';
    end if;
    update public.students set app_client_id=coalesce(new.member_client_id,s.app_client_id),
      name=new.full_name,phone=coalesce(new.phone,c.phone,new.contact_responsible_phone),
      email=coalesce(nullif(c.email,''),s.email),birth_date=new.birth_date,
      guardian_name=case when minor then new.contact_responsible_name else s.guardian_name end,
      status='ATIVO',relationship_status='ATIVO',monthly_value=new.monthly_amount,updated_at=now()
      -- Plan and lesson frequency belong to this student's ficha, not the payer.
      where id=s.id;
  end if;
  new.student_id := s.id;
  return new;
end $$;

create or replace function private.sync_family_member_client_amount()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status='ATIVO' and new.member_client_id is not null and new.monthly_amount is not null then
    update public.app_clients set plan_amount=new.monthly_amount,updated_at=now()
      where id=new.member_client_id and plan_amount is distinct from new.monthly_amount;
  end if;
  return new;
end $$;
create trigger sync_family_member_client_amount
after insert or update of monthly_amount,member_client_id,status on public.app_family_members
for each row execute function private.sync_family_member_client_amount();

-- Match exact identities, never a shared family telephone number.
create or replace function public.sync_app_client_lesson_student()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target_student_id uuid;
  member public.app_family_members%rowtype;
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if new.client_type='responsavel' then
    update public.lesson_enrollments e set active=false,updated_at=now()
      from public.students s where s.app_client_id=new.id and e.student_id=s.id and e.active;
    update public.students set status='INATIVO',relationship_status='INATIVO',weekly_lessons=0,
      monthly_value=0,updated_at=now() where app_client_id=new.id;
    return new;
  end if;
  select * into member from public.app_family_members
    where member_client_id=new.id and status='ATIVO' for update;
  if member.id is not null then
    if new.plan_amount is distinct from old.plan_amount then
      update public.app_family_members set monthly_amount=new.plan_amount
        where id=member.id and monthly_amount is distinct from new.plan_amount;
      member.monthly_amount := new.plan_amount;
    end if;
    update public.students set plan_name=new.official_plan_name,weekly_lessons=new.weekly_lessons,
      monthly_value=member.monthly_amount,updated_at=now() where id=member.student_id;
    return new;
  end if;
  if coalesce(new.weekly_lessons,0)<=0 and coalesce(new.official_plan_code,'') not like 'aulas_%' then return new; end if;
  select id into target_student_id from public.students where app_client_id=new.id order by created_at,id limit 1;
  if target_student_id is null then
    -- A unique email may recover an old unlinked adult, but not a family student.
    select min(s.id::text)::uuid into target_student_id from public.students s
      where s.app_client_id is null and nullif(trim(new.email),'') is not null
      and lower(trim(s.email))=lower(trim(new.email))
      and not exists(select 1 from public.app_family_members f where f.student_id=s.id)
      having count(*)=1;
  end if;
  if target_student_id is null then
    insert into public.students(app_client_id,name,phone,email,status,weekly_lessons,monthly_value,
      plan_name,financial_status,relationship_status)
      values(new.id,new.full_name,new.phone,new.email,'ATIVO',new.weekly_lessons,new.plan_amount,
      new.official_plan_name,'OK','ATIVO');
  else
    update public.students set app_client_id=new.id,name=new.full_name,phone=new.phone,email=new.email,
      status=case when new.status='ATIVO' then 'ATIVO' else 'INATIVO' end,
      weekly_lessons=new.weekly_lessons,monthly_value=new.plan_amount,
      plan_name=new.official_plan_name,updated_at=now() where id=target_student_id;
  end if;
  return new;
end $$;

create or replace function private.sync_student_family_amount()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth()>1 or new.monthly_value is not distinct from old.monthly_value then return new; end if;
  if (select auth.uid()) is not null and not coalesce(public.has_club_permission('finance.write'),false) then
    raise exception 'Seu acesso não permite alterar o valor mensal.' using errcode='42501';
  end if;
  update public.app_family_members set monthly_amount=new.monthly_value
    where student_id=new.id and status='ATIVO' and monthly_amount is distinct from new.monthly_value;
  return new;
end $$;
create trigger sync_student_family_amount after update of monthly_value on public.students
for each row execute function private.sync_student_family_amount();

create or replace function private.admin_update_family_student_impl(p_family_member_id uuid,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  f public.app_family_members%rowtype;
  s public.students%rowtype;
  plan public.app_plans%rowtype;
  frequency integer;
  amount numeric;
begin
  if (select auth.uid()) is null or not coalesce(public.has_club_permission('clients.write'),false) then
    raise exception 'Seu acesso não permite editar alunos.' using errcode='42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch)<>'object' or exists(
    select 1 from jsonb_object_keys(p_patch) k where k not in
    ('full_name','phone','cpf','birth_date','contact_responsible_name','contact_responsible_phone','notes','monthly_amount','plan_id','weekly_lessons')) then
    raise exception 'Campos inválidos para a ficha do dependente.' using errcode='22023';
  end if;
  if p_patch ?| array['monthly_amount','plan_id'] and not coalesce(public.has_club_permission('finance.write'),false) then
    raise exception 'Seu acesso não permite editar valores ou planos.' using errcode='42501';
  end if;
  if p_patch ? 'weekly_lessons' and not (coalesce(public.has_club_permission('classes'),false) or coalesce(public.has_club_permission('finance.write'),false)) then
    raise exception 'Seu acesso não permite editar aulas.' using errcode='42501';
  end if;
  select * into strict f from public.app_family_members where id=p_family_member_id and status='ATIVO' for update;
  select * into strict s from public.students where id=f.student_id for update;
  frequency := case when p_patch ? 'weekly_lessons' then (p_patch->>'weekly_lessons')::integer else coalesce(s.weekly_lessons,0) end;
  amount := case when p_patch ? 'monthly_amount' then (p_patch->>'monthly_amount')::numeric else f.monthly_amount end;
  if frequency is null or frequency<0 or frequency>7 or amount<0 or amount='NaN'::numeric then
    raise exception 'Confira o valor mensal e a quantidade de aulas.' using errcode='22023';
  end if;
  if frequency < (select count(*) from public.lesson_enrollments e join public.lesson_slots l on l.id=e.slot_id where e.student_id=s.id and e.active and l.active) then
    raise exception 'Remova aulas da grade antes de reduzir a quantidade semanal.' using errcode='22023';
  end if;
  if p_patch ? 'plan_id' and nullif(p_patch->>'plan_id','') is not null then
    select * into strict plan from public.app_plans where id=(p_patch->>'plan_id')::uuid;
  end if;
  update public.app_family_members set
    full_name=case when p_patch ? 'full_name' then p_patch->>'full_name' else f.full_name end,
    phone=case when p_patch ? 'phone' then nullif(p_patch->>'phone','') else f.phone end,
    cpf=case when p_patch ? 'cpf' then nullif(p_patch->>'cpf','') else f.cpf end,
    birth_date=case when p_patch ? 'birth_date' then nullif(p_patch->>'birth_date','')::date else f.birth_date end,
    contact_responsible_name=case when p_patch ? 'contact_responsible_name' then p_patch->>'contact_responsible_name' else f.contact_responsible_name end,
    contact_responsible_phone=case when p_patch ? 'contact_responsible_phone' then nullif(p_patch->>'contact_responsible_phone','') else f.contact_responsible_phone end,
    notes=case when p_patch ? 'notes' then p_patch->>'notes' else f.notes end,
    monthly_amount=amount where id=f.id returning * into f;
  update public.students set weekly_lessons=frequency,
    plan_name=case when p_patch ? 'plan_id' then plan.name else s.plan_name end,updated_at=now() where id=s.id;
  if f.member_client_id is not null then
    update public.app_clients set full_name=f.full_name,phone=coalesce(f.phone,phone),cpf=f.cpf,birth_date=f.birth_date,
      weekly_lessons=frequency,
      official_plan_id=case when p_patch ? 'plan_id' then plan.id else official_plan_id end,
      official_plan_code=case when p_patch ? 'plan_id' then coalesce(plan.code,'') else official_plan_code end,
      official_plan_name=case when p_patch ? 'plan_id' then coalesce(plan.name,'') else official_plan_name end,
      updated_at=now() where id=f.member_client_id;
  end if;
  return jsonb_build_object('family_member_id',f.id,'student_id',s.id,'monthly_amount',f.monthly_amount);
end $$;
create or replace function public.admin_update_family_student(p_family_member_id uuid,p_patch jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.admin_update_family_student_impl(p_family_member_id,p_patch);
$$;
revoke all on function private.sync_app_family_member_student(),private.sync_family_member_client_amount(),
  private.sync_student_family_amount(),public.sync_app_client_lesson_student() from public,anon,authenticated,service_role;
revoke all on function private.admin_update_family_student_impl(uuid,jsonb),public.admin_update_family_student(uuid,jsonb) from public,anon;
grant execute on function private.admin_update_family_student_impl(uuid,jsonb),public.admin_update_family_student(uuid,jsonb) to authenticated;

-- Reconcile only known family prices; NULL remains explicitly undefined.
-- Preserve existing IDs, plans, lessons, confirmation flags and invoice history.
update public.app_clients c set plan_amount=f.monthly_amount,updated_at=now()
from public.app_family_members f where f.member_client_id=c.id and f.status='ATIVO'
  and f.monthly_amount is not null and c.plan_amount is distinct from f.monthly_amount;
update public.app_family_members set full_name=full_name where status='ATIVO' and student_id is null;
