begin;
-- Pure selection helper accepts a date for boundary tests. The public worker
-- always supplies the current Sao Paulo date, never a date from the caller.
create function private.monthly_billing_advance_targets(p_today date)
returns table(client_id uuid, invoice_month date, due_date date)
language sql stable security invoker set search_path='' as $$
  select c.id, cycle.month_start::date, due.value
  from public.app_monthly_billing_enrollments e
  join public.app_clients c on c.id=e.client_id
  left join public.app_plans plan on plan.id=c.official_plan_id
  cross join lateral generate_series(date_trunc('month',p_today::timestamp),
    date_trunc('month',p_today::timestamp)+interval '1 month',interval '1 month') cycle(month_start)
  cross join lateral (select private.monthly_billing_due_date(cycle.month_start::date,
    coalesce(c.due_day,plan.default_due_day,10)) as value) due
  where e.enabled and e.billing_method='ASAAS_PIX' and due.value <= p_today + 15
  order by cycle.month_start,c.id;
$$;
revoke all on function private.monthly_billing_advance_targets(date) from public,anon,authenticated,service_role;

create function public.generate_due_app_monthly_pix_billing(p_provider_environment text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target record; generated jsonb; results jsonb := '[]'::jsonb;
begin
  if coalesce((select auth.jwt()->>'role'),'') <> 'service_role' then
    raise exception 'Esta operação exige a função de serviço.' using errcode='42501';
  end if;
  perform 1 from public.app_monthly_billing_settings where singleton and enabled for share;
  if not found then return jsonb_build_object('results',results,'paused',true); end if;
  for target in select * from private.monthly_billing_advance_targets((now() at time zone 'America/Sao_Paulo')::date) loop
    -- Existing per-client/month locks and immutable snapshots remain authoritative.
    -- A manual invoice must never be replaced by an automatic Pix.
    if exists(select 1 from public.app_payment_invoices where client_id=target.client_id
      and invoice_month=target.invoice_month and payment_method in ('CLUB_PIX','CASH')) then continue; end if;
    generated := public.generate_enrolled_app_monthly_pix_billing(target.invoice_month,target.client_id,p_provider_environment);
    results := results || coalesce(generated->'results','[]'::jsonb);
  end loop;
  return jsonb_build_object('results',results,'advanceDays',15);
end;
$$;
revoke all on function public.generate_due_app_monthly_pix_billing(text) from public,anon,authenticated,service_role;
grant execute on function public.generate_due_app_monthly_pix_billing(text) to service_role;
commit;
