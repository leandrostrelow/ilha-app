-- Run as one transaction. All fixture edits, audit events and notifications roll back.
begin;
set local statement_timeout = '20s';
do $$
declare
  admin_id uuid;
  payer_id uuid;
  nina public.app_family_members%rowtype;
  linked public.app_family_members%rowtype;
  ledger jsonb;
  custom_plan uuid;
  created public.app_family_members%rowtype;
begin
  select p.id into strict admin_id from public.profiles p join public.protected_access_accounts a
    on lower(p.email)=a.email and a.role='admin' and a.active
    where p.role='admin' and p.active order by p.id limit 1;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  select id into strict payer_id from public.app_clients where lower(full_name)='leonardo lobato';
  select * into strict nina from public.app_family_members where billing_responsible_id=payer_id and full_name ilike 'Nina%' and status='ATIVO';
  select jsonb_agg(to_jsonb(i) order by id) into ledger from public.app_payment_invoices i where client_id=payer_id;
  if (private.client_family_summary_data(payer_id)->>'total_monthly_amount')::numeric<>600 then raise exception 'Initial total must be 600'; end if;
  select id into strict custom_plan from public.app_plans where code='personalizado';
  perform public.admin_update_family_student(nina.id,jsonb_build_object('monthly_amount',360,'plan_id',custom_plan,'weekly_lessons',1));
  if not exists(select 1 from public.students where id=nina.student_id and monthly_value=360 and weekly_lessons=1 and plan_name='Plano personalizado') then raise exception 'Own profile not synced'; end if;
  if (private.client_family_summary_data(payer_id)->>'total_monthly_amount')::numeric<>610 then raise exception 'Responsible total not synced'; end if;
  if not exists(select 1 from public.app_family_members where id=nina.id and responsible_confirmation_required=nina.responsible_confirmation_required) then raise exception 'Confirmation changed'; end if;
  update public.app_family_members set monthly_amount=375 where id=nina.id;
  if not exists(select 1 from public.students where id=nina.student_id and monthly_value=375 and weekly_lessons=1) then raise exception 'Family to student not synced'; end if;
  update public.students set monthly_value=355 where id=nina.student_id;
  if (private.client_family_summary_data(payer_id)->>'total_monthly_amount')::numeric<>605 then raise exception 'Student to family not synced'; end if;
  select * into strict linked from public.app_family_members where status='ATIVO' and member_client_id is not null and monthly_amount is not null order by id limit 1;
  update public.app_clients set plan_amount=linked.monthly_amount+1 where id=linked.member_client_id;
  if not exists(select 1 from public.app_family_members where id=linked.id and monthly_amount=linked.monthly_amount+1) then raise exception 'Client to family not synced'; end if;
  update public.app_family_members set monthly_amount=linked.monthly_amount+2 where id=linked.id;
  if not exists(select 1 from public.app_clients where id=linked.member_client_id and plan_amount=linked.monthly_amount+2) then raise exception 'Family to client not synced'; end if;
  if (select jsonb_agg(to_jsonb(i) order by id) from public.app_payment_invoices i where client_id=payer_id) is distinct from ledger then raise exception 'Invoice history mutated'; end if;
  if exists(select 1 from public.app_family_members where status='ATIVO' and student_id is null) then raise exception 'Active family member without student'; end if;
  select * into created from public.admin_create_family_member(payer_id,'Teste reversível de dependente','FILHO',null,null,null,100,'ATIVO',null,null);
  if created.student_id is null or created.member_client_id is not null or not created.responsible_confirmation_required then raise exception 'Name-only student creation failed'; end if;
  perform public.admin_update_family_student(created.id,'{"monthly_amount":110,"weekly_lessons":1}');
  if (select count(*) from public.students where id=created.student_id and monthly_value=110)<>1 then raise exception 'New student missing or duplicated'; end if;
  perform set_config('request.jwt.claim.sub',payer_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',payer_id,'role','authenticated')::text,true);
  begin
    perform public.admin_update_family_student(nina.id,'{"monthly_amount":1}');
    raise exception 'Non-admin changed price';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
