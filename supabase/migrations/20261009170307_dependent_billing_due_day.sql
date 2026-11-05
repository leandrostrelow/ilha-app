-- Edit the shared family due day from a dependent profile, atomically and with
-- the same explicit finance permission and optimistic concurrency checks.
create or replace function private.admin_update_family_student_impl(p_family_member_id uuid,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  f public.app_family_members%rowtype;
  s public.students%rowtype;
  plan public.app_plans%rowtype;
  frequency integer;
  amount numeric;
  payer public.app_clients%rowtype;
  due_day_value integer;
begin
  if (select auth.uid()) is null or not coalesce(public.has_club_permission('clients.write'),false) then
    raise exception 'Seu acesso não permite editar alunos.' using errcode='42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch)<>'object' or exists(
    select 1 from jsonb_object_keys(p_patch) k where k not in
    ('full_name','phone','cpf','birth_date','contact_responsible_name','contact_responsible_phone','notes','monthly_amount','plan_id','weekly_lessons','billing_due_day','expected_billing_due_day')) then
    raise exception 'Campos inválidos para a ficha do dependente.' using errcode='22023';
  end if;
  if p_patch ?| array['monthly_amount','plan_id','billing_due_day','expected_billing_due_day'] and not coalesce(public.has_club_permission('finance.write'),false) then
    raise exception 'Seu acesso não permite editar valores, planos ou vencimentos.' using errcode='42501';
  end if;
  if p_patch ? 'weekly_lessons' and not (coalesce(public.has_club_permission('classes'),false) or coalesce(public.has_club_permission('finance.write'),false)) then
    raise exception 'Seu acesso não permite editar aulas.' using errcode='42501';
  end if;
  select * into strict f from public.app_family_members where id=p_family_member_id and status='ATIVO' for update;
  select * into strict s from public.students where id=f.student_id for update;
  if p_patch ? 'billing_due_day' then
    if jsonb_typeof(p_patch->'billing_due_day') is distinct from 'number'
      or (p_patch->>'billing_due_day') !~ '^[0-9]{1,2}$'
      or not (p_patch ? 'expected_billing_due_day') then
      raise exception 'Informe um dia de vencimento entre 1 e 31 e recarregue a ficha.' using errcode='22023';
    end if;
    due_day_value := (p_patch->>'billing_due_day')::integer;
    if due_day_value < 1 or due_day_value > 31 then
      raise exception 'Informe um dia de vencimento entre 1 e 31.' using errcode='22023';
    end if;
    select * into strict payer from public.app_clients where id=f.billing_responsible_id for update;
    if payer.due_day is distinct from (p_patch->>'expected_billing_due_day')::integer then
      raise exception 'O vencimento da família foi alterado. Feche e reabra a ficha antes de salvar.' using errcode='40001';
    end if;
    -- Only the canonical payer schedule changes. Existing invoices, receipts,
    -- billing enrollment and payment provider records are deliberately untouched.
    update public.app_clients set due_day=due_day_value,updated_at=now() where id=payer.id;
  elsif p_patch ? 'expected_billing_due_day' then
    raise exception 'Informe o novo dia de vencimento.' using errcode='22023';
  end if;
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
  return jsonb_build_object('family_member_id',f.id,'student_id',s.id,'monthly_amount',f.monthly_amount,
    'billing_responsible_id',f.billing_responsible_id,'billing_due_day',coalesce(due_day_value,(select due_day from public.app_clients where id=f.billing_responsible_id)));
end $$;

revoke all on function private.admin_update_family_student_impl(uuid,jsonb) from public,anon;
grant execute on function private.admin_update_family_student_impl(uuid,jsonb) to authenticated;
