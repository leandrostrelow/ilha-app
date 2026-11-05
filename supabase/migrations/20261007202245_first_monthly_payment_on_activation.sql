begin;

-- Only NEW first activations receive this date. Existing enrollments/invoices
-- are deliberately not backfilled; reactivation is not a second enrollment fee.
alter table public.app_monthly_billing_enrollments add column first_due_date date;
comment on column public.app_monthly_billing_enrollments.first_due_date is
  'First monthly installment due on initial billing activation; recurring due_day is unchanged.';

create function private.set_first_monthly_due_date() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' then new.first_due_date:=old.first_due_date; end if;
  if new.enabled and new.first_due_date is null
    and (tg_op='INSERT' or not old.enabled)
    and not exists(select 1 from public.app_payment_invoices where client_id=new.client_id)
    and not exists(select 1 from public.app_monthly_billing_enrollment_audit where client_id=new.client_id and enabled)
  then new.first_due_date:=(now() at time zone 'America/Sao_Paulo')::date;
  end if;
  return new;
end;
$$;
revoke all on function private.set_first_monthly_due_date() from public,anon,authenticated,service_role;
create trigger set_first_monthly_due_date before insert or update on public.app_monthly_billing_enrollments
  for each row execute function private.set_first_monthly_due_date();

create function private.first_monthly_due_date(p_client_id uuid,p_invoice_month date)
returns date language sql stable security invoker set search_path='' as $$
  select first_due_date from public.app_monthly_billing_enrollments
  where client_id=p_client_id
    and first_due_date>=date_trunc('month',p_invoice_month::timestamp)::date
    and first_due_date<(date_trunc('month',p_invoice_month::timestamp)+interval '1 month')::date;
$$;
revoke all on function private.first_monthly_due_date(uuid,date) from public,anon,authenticated,service_role;

-- Reuse all existing eligibility, family, immutable snapshot and reissue guards.
do $$
declare definition text; needle text;
begin
  definition:=pg_get_functiondef('private.monthly_billing_candidates_ignoring(date,uuid,uuid)'::regprocedure);
  needle:=E'      case\n        when date_trunc(''month'', p_invoice_month::timestamp)::date =';
  if position(needle in definition)=0 then raise exception 'Unexpected candidate due-date definition'; end if;
  definition:=replace(definition,needle,E'      coalesce(private.first_monthly_due_date(base.id,p_invoice_month), case\n        when date_trunc(''month'', p_invoice_month::timestamp)::date =');
  definition:=replace(definition,'end as calculated_due_date,','end) as calculated_due_date,');
  execute definition;

  definition:=pg_get_functiondef('private.client_monthly_payment_options(uuid)'::regprocedure);
  needle:='private.monthly_billing_due_date(m::date,coalesce(c.due_day,p.default_due_day,10)) as due';
  if position(needle in definition)=0 then raise exception 'Unexpected self-service due-date definition'; end if;
  execute replace(definition,needle,'coalesce(private.first_monthly_due_date(c.id,m::date),private.monthly_billing_due_date(m::date,coalesce(c.due_day,p.default_due_day,10))) as due');

  definition:=pg_get_functiondef('private.monthly_billing_advance_targets(date)'::regprocedure);
  needle:='private.monthly_billing_due_date(cycle.month_start::date,coalesce(c.due_day,plan.default_due_day,10))';
  -- Normalize whitespace only within the known due-date expression.
  if definition !~ 'private.monthly_billing_due_date\(\s*cycle.month_start::date,\s*coalesce\(c.due_day,\s*plan.default_due_day,\s*10\)\s*\)' then
    raise exception 'Unexpected automatic due-date definition';
  end if;
  execute regexp_replace(definition,
    'private.monthly_billing_due_date\(\s*cycle.month_start::date,\s*coalesce\(c.due_day,\s*plan.default_due_day,\s*10\)\s*\)',
    'coalesce(private.first_monthly_due_date(c.id,cycle.month_start::date),'||needle||')');

  definition:=pg_get_functiondef('public.admin_set_app_monthly_billing_enrollment(uuid,boolean,text)'::regprocedure);
  needle:=E'  ) + interval ''1 month'')::date;';
  if position(needle in definition)=0 then raise exception 'Unexpected activation validation month'; end if;
  execute replace(definition,needle,E'  ))::date;');
end;
$$;

-- Queue ONLY this account after commit. Never invoke the all-account scheduler.
-- Clone the already pinned Vault URL/key validation, without exposing secrets.
do $$
declare definition text; needle text;
begin
  definition:=pg_get_functiondef('private.invoke_app_monthly_billing_action(text)'::regprocedure);
  definition:=replace(definition,'private.invoke_app_monthly_billing_action(p_action text)',
    'private.invoke_first_monthly_payment(p_client_id uuid)');
  needle:=E'  if p_action not in (''scheduled'', ''reconcile'') then\n    raise exception ''A ação interna de cobrança mensal é inválida.''\n      using errcode = ''22023'';\n  end if;';
  if position(needle in definition)=0 then raise exception 'Unexpected internal worker validation'; end if;
  definition:=replace(definition,needle,$guard$
  if not exists(select 1 from public.app_monthly_billing_enrollments e
    where e.client_id=p_client_id and e.enabled and e.billing_method='ASAAS_PIX'
      and e.first_due_date=(now() at time zone 'America/Sao_Paulo')::date)
    or not exists(select 1 from private.monthly_billing_candidates(
      date_trunc('month',now() at time zone 'America/Sao_Paulo')::date,p_client_id)
      where state in ('ELIGIBLE','ELIGIBLE_WITH_WARNING') and invoice_id is null)
  then return null; end if;
$guard$);
  needle:='body := jsonb_build_object(''action'', p_action)';
  if position(needle in definition)=0 then raise exception 'Unexpected internal worker payload'; end if;
  definition:=replace(definition,needle,'body := jsonb_build_object(''action'', ''activation_generate'', ''clientId'', p_client_id)');
  execute definition;
end;
$$;
revoke all on function private.invoke_first_monthly_payment(uuid) from public,anon,authenticated,service_role;

create function private.queue_first_monthly_payment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.enabled and new.billing_method='ASAAS_PIX' and new.first_due_date is not null
    and (tg_op='INSERT' or not old.enabled or old.billing_method is distinct from new.billing_method)
  then
    -- If the async worker is temporarily unavailable, keep self-service enabled.
    begin perform private.invoke_first_monthly_payment(new.client_id);
    exception when others then raise warning 'First monthly Pix could not be queued; self-service remains available.';
    end;
  end if;
  return new;
end;
$$;
revoke all on function private.queue_first_monthly_payment() from public,anon,authenticated,service_role;
create trigger queue_first_monthly_payment after insert or update on public.app_monthly_billing_enrollments
  for each row execute function private.queue_first_monthly_payment();

commit;
