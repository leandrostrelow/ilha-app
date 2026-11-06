begin;

-- Keep first_due_date as historical activation metadata. Never use the
-- activation day as a replacement for the student's agreed recurring day.
create or replace function private.first_monthly_due_date(p_client_id uuid, p_invoice_month date)
returns date language sql stable security invoker set search_path = '' as $$
  select private.monthly_billing_due_date(p_invoice_month, coalesce(c.due_day, p.default_due_day, 10))
  from public.app_monthly_billing_enrollments e
  join public.app_clients c on c.id = e.client_id
  left join public.app_plans p on p.id = c.official_plan_id
  where e.client_id = p_client_id
    and e.first_due_date >= date_trunc('month', p_invoice_month::timestamp)::date
    and e.first_due_date < (date_trunc('month', p_invoice_month::timestamp) + interval '1 month')::date;
$$;
revoke all on function private.first_monthly_due_date(uuid,date) from public,anon,authenticated,service_role;

-- A missed due date must be reported as past due, not silently moved to
-- tomorrow. Existing invoices remain immutable and retain their own dates.
do $$
declare definition text; original text; replacement text;
begin
  definition := pg_get_functiondef('private.monthly_billing_candidates_ignoring(date,uuid,uuid)'::regprocedure);
  original := $old$coalesce(private.first_monthly_due_date(base.id,p_invoice_month), case
        when date_trunc('month', p_invoice_month::timestamp)::date =
          date_trunc(
            'month',
            now() at time zone 'America/Sao_Paulo'
          )::date then greatest(
            private.monthly_billing_due_date(
              p_invoice_month,
              coalesce(base.due_day, base.default_due_day, 10)
            ),
            (now() at time zone 'America/Sao_Paulo')::date + 1
          )
        else private.monthly_billing_due_date(
          p_invoice_month,
          coalesce(base.due_day, base.default_due_day, 10)
        )
      end) as calculated_due_date$old$;
  replacement := 'private.monthly_billing_due_date(p_invoice_month, coalesce(base.due_day, base.default_due_day, 10)) as calculated_due_date';
  if position(original in definition) = 0 then
    raise exception 'Unexpected monthly due-date definition; review remote history before applying';
  end if;
  execute replace(definition, original, replacement);
end;
$$;

-- No invoice, provider payment, receipt or enrollment is updated here.
-- Existing issued invoices need separately audited provider reconciliation.
commit;
