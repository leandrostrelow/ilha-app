-- Integration checks against known family; caller must BEGIN and ROLLBACK.
-- No provider API is invoked and no lasting invoice is created.
do $$
declare
  payer uuid := '653dd131-7f62-4ddb-aa84-348ff44f7a74';
  dependent uuid := '388ff4bc-3bbe-487f-b5ae-adb037091ea8';
  candidate record;
  invoices_before jsonb;
  members_before jsonb;
  test_month date := (date_trunc('month',now()) + interval '2 months')::date;
begin
  select jsonb_agg(to_jsonb(i) order by id) into invoices_before from public.app_payment_invoices i where client_id in (payer,dependent);
  select jsonb_agg(to_jsonb(m) order by id) into members_before from public.app_family_members m where billing_responsible_id=payer;
  select * into candidate from private.monthly_billing_candidates(test_month,payer);
  if candidate.amount is distinct from 350::numeric then raise exception 'Expected guardian total 350'; end if;
  select * into candidate from private.monthly_billing_candidates(test_month,dependent);
  if candidate.reason is distinct from 'FAMILY_DEPENDENT' then raise exception 'Dependent eligible for separate billing'; end if;
  begin
    insert into public.app_payment_invoices(client_id,invoice_month,amount) values(dependent,test_month,350);
    raise exception 'Dependent invoice was accepted';
  exception when check_violation then
    if sqlerrm not like 'Este aluno é membro de uma família%' then raise; end if;
  end;
  update public.app_clients set client_type='aluno',plan_amount=170,weekly_lessons=0 where id=payer;
  select * into candidate from private.monthly_billing_candidates(test_month,payer);
  if candidate.amount is distinct from 520::numeric then raise exception 'Expected own 170 + dependent 350 = 520'; end if;
  update public.app_clients set client_type='responsavel',plan_amount=170 where id=payer;
  select * into candidate from private.monthly_billing_candidates(test_month,payer);
  if candidate.amount is distinct from 350::numeric then raise exception 'Guardian individual value not cleared'; end if;
  if invoices_before is distinct from (select jsonb_agg(to_jsonb(i) order by id) from public.app_payment_invoices i where client_id in (payer,dependent)) then raise exception 'Invoice history changed'; end if;
  if members_before is distinct from (select jsonb_agg(to_jsonb(m) order by id) from public.app_family_members m where billing_responsible_id=payer) then raise exception 'Family member changed'; end if;
end;
$$;
