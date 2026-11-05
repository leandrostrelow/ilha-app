begin;

-- A corrected, explicitly reviewed invoice gets a NEW identity. Keep the old
-- provider reference, cancelled amount, ledger and family snapshot untouched.
alter table public.app_payment_invoices add column superseded_at timestamptz,
  add column superseded_reason text,
  add constraint app_invoice_superseded_cancelled_check check (
    superseded_at is null or (status='CANCELADA' and paid_at is null
      and provider_status='CANCELLED' and length(trim(superseded_reason)) > 0));
drop index public.app_payment_invoices_client_month_idx;
drop index public.app_payment_invoices_client_competence_uidx;
create unique index app_payment_invoices_client_month_idx
  on public.app_payment_invoices(client_id,invoice_month) where superseded_at is null;

create function private.guard_invoice_supersession()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (tg_op='INSERT' and new.superseded_at is not null) or (tg_op='UPDATE' and
    (new.superseded_at is distinct from old.superseded_at or new.superseded_reason is distinct from old.superseded_reason)) then
    if coalesce(current_setting('ilha.monthly_reissue_write',true),'') <> '1'
      or coalesce((select auth.jwt()->>'role'),'') <> 'service_role'
      or (tg_op='UPDATE' and old.superseded_at is not null) then
      raise exception 'Substituição exige revisão financeira auditada.' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_invoice_supersession() from public,anon,authenticated,service_role;
create trigger guard_invoice_supersession before insert or update on public.app_payment_invoices
  for each row execute function private.guard_invoice_supersession();

-- Preserve all existing eligibility, immutable-snapshot and idempotency rules.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('private.monthly_billing_candidates(date,uuid)'::regprocedure);
  if position('where candidate_invoice.client_id = base.id' in definition)=0 then raise exception 'Unexpected candidates'; end if;
  execute replace(definition,'where candidate_invoice.client_id = base.id',
    'where candidate_invoice.superseded_at is null and candidate_invoice.client_id = base.id');
  definition:=pg_get_functiondef('public.admin_generate_family_invoice(uuid,date,date)'::regprocedure);
  definition:=replace(definition,'and invoice.invoice_month = month_start',
    'and invoice.invoice_month = month_start and invoice.superseded_at is null');
  definition:=replace(definition,'on conflict (client_id, invoice_month) do update',
    'on conflict (client_id, invoice_month) where superseded_at is null do update');
  execute definition;
end;
$$;

create function public.prepare_cancelled_monthly_invoice_reissue(p_invoice_id uuid,p_expected_amount numeric,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old_invoice public.app_payment_invoices%rowtype; payment public.app_invoice_provider_payments%rowtype;
  candidate record; result jsonb;
begin
  if coalesce((select auth.jwt()->>'role'),'') <> 'service_role' then raise exception 'Acesso negado.' using errcode='42501'; end if;
  select * into strict old_invoice from public.app_payment_invoices where id=p_invoice_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ilha-monthly-billing:'||old_invoice.invoice_month::text,0));
  select * into strict payment from public.app_invoice_provider_payments where invoice_id=p_invoice_id for update;
  select * into strict old_invoice from public.app_payment_invoices where id=p_invoice_id for update;
  if old_invoice.status <> 'CANCELADA' or old_invoice.provider_status <> 'CANCELLED'
    or old_invoice.paid_at is not null or old_invoice.superseded_at is not null or payment.status <> 'CANCELLED'
    or not (coalesce(payment.safe_snapshot#>>'{payment,deleted}','false')='true'
      or coalesce(payment.safe_snapshot#>>'{payment,status}','') in ('DELETED','CANCELLED'))
    or length(trim(coalesce(p_reason,''))) < 10 then
    raise exception 'Cancelamento remoto não comprovado ou substituição inválida.' using errcode='23514';
  end if;
  if not exists(select 1 from private.monthly_billing_advance_targets((now() at time zone 'America/Sao_Paulo')::date)
    where client_id=old_invoice.client_id and invoice_month=old_invoice.invoice_month) then
    raise exception 'Conta desativada ou fora da janela de 15 dias.' using errcode='23514';
  end if;
  perform pg_catalog.set_config('ilha.monthly_reissue_write','1',true);
  update public.app_payment_invoices set superseded_at=now(),superseded_reason=left(trim(p_reason),1000) where id=p_invoice_id;
  select * into strict candidate from private.monthly_billing_candidates(old_invoice.invoice_month,old_invoice.client_id);
  if candidate.state not in ('ELIGIBLE','ELIGIBLE_WITH_WARNING') or candidate.amount is distinct from p_expected_amount then
    raise exception 'Revise o valor e a elegibilidade atual antes da substituição: %.',candidate.reason using errcode='23514';
  end if;
  result:=public.generate_enrolled_app_monthly_pix_billing(old_invoice.invoice_month,old_invoice.client_id,payment.provider_environment);
  if jsonb_array_length(coalesce(result->'results','[]'::jsonb))<>1 or result#>>'{results,0,state}'<>'READY' then
    raise exception 'A nova fatura não ficou pronta; substituição revertida.' using errcode='23514';
  end if;
  return result;
end;
$$;
revoke all on function public.prepare_cancelled_monthly_invoice_reissue(uuid,numeric,text) from public,anon,authenticated,service_role;
grant execute on function public.prepare_cancelled_monthly_invoice_reissue(uuid,numeric,text) to service_role;

create function private.client_monthly_payment_options(p_client_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare today date:=(now() at time zone 'America/Sao_Paulo')::date;
  enrollment public.app_monthly_billing_enrollments%rowtype; cycle record; candidate record;
  invoice public.app_payment_invoices%rowtype; result jsonb:='[]'::jsonb; state text; due date;
begin
  select * into enrollment from public.app_monthly_billing_enrollments where client_id=p_client_id and enabled and billing_method='ASAAS_PIX';
  if not found or exists(select 1 from public.app_family_members where member_client_id=p_client_id
    and billing_responsible_id<>p_client_id and status in ('ATIVO','PENDENTE')) then return result; end if;
  for cycle in
    select m::date as month,private.monthly_billing_due_date(m::date,coalesce(c.due_day,p.default_due_day,10)) as due
    from public.app_clients c left join public.app_plans p on p.id=c.official_plan_id
    cross join generate_series(date_trunc('month',today::timestamp),date_trunc('month',today::timestamp)+interval '1 month',interval '1 month') m
    where c.id=p_client_id and c.status='ATIVO'
  loop
    select * into candidate from private.monthly_billing_candidates(cycle.month,p_client_id);
    select * into invoice from public.app_payment_invoices where id=candidate.invoice_id;
    due:=coalesce(invoice.due_date,cycle.due);
    state:=case
      when candidate.state='PAID' then 'PAID'
      when due>today+15 then 'TOO_EARLY'
      when candidate.state='SKIPPED' or candidate.provider_status in ('REVIEW_REQUIRED','REFUND_PENDING','REFUNDED','PARTIALLY_REFUNDED','DISPUTED','CHARGEBACK','CANCELLED') then 'BLOCKED'
      when candidate.provider_status='CONFIRMED' then 'CONFIRMED'
      when candidate.provider_status in ('PENDING','OVERDUE') and nullif(trim(invoice.pix_payload),'') is not null
        and (invoice.pix_expires_at is null or invoice.pix_expires_at>now()) then 'PAYABLE'
      when candidate.state in ('ELIGIBLE','ELIGIBLE_WITH_WARNING','READY','EXISTING','RECONCILING','OVERDUE') then 'AVAILABLE'
      else 'BLOCKED' end;
    result:=result||jsonb_build_array(jsonb_build_object('invoice_month',cycle.month,'invoice_id',candidate.invoice_id,
      'amount',candidate.amount,'due_date',coalesce(invoice.due_date,candidate.due_date),'scheduled_due_date',due,
      'available_on',due-15,'state',state,'reason',candidate.reason));
  end loop;
  return result;
end;
$$;
revoke all on function private.client_monthly_payment_options(uuid) from public,anon,authenticated,service_role;

create function public.get_my_monthly_payment_options()
returns jsonb language sql stable security definer set search_path='' as $$
  select private.client_monthly_payment_options((select auth.uid()));
$$;
revoke all on function public.get_my_monthly_payment_options() from public,anon,authenticated,service_role;
grant execute on function public.get_my_monthly_payment_options() to authenticated;

create function public.admin_get_client_monthly_payment_options(p_client_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not coalesce(public.has_club_permission('finance.read'),false) then
    raise exception 'Acesso negado.' using errcode='42501'; end if;
  return private.client_monthly_payment_options(p_client_id);
end;
$$;
revoke all on function public.admin_get_client_monthly_payment_options(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_client_monthly_payment_options(uuid) to authenticated;

-- Only the authenticated edge handler supplies p_client_id, from verified JWT.
-- Caller cannot submit an amount, due date or responsible/dependent identity.
create function public.prepare_client_monthly_pix(p_client_id uuid,p_invoice_month date,p_provider_environment text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare option jsonb; generated jsonb; invoice_id uuid;
begin
  if coalesce((select auth.jwt()->>'role'),'') <> 'service_role' then raise exception 'Acesso negado.' using errcode='42501'; end if;
  perform 1 from public.app_monthly_billing_enrollments where client_id=p_client_id and enabled and billing_method='ASAAS_PIX' for share;
  if not found then return jsonb_build_object('state','BLOCKED','error','Cobrança Pix não ativada. Fale com o clube.'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ilha-monthly-billing:'||p_invoice_month::text,0));
  select value into option from jsonb_array_elements(private.client_monthly_payment_options(p_client_id))
    where value->>'invoice_month'=p_invoice_month::text;
  if option is null or option->>'state' not in ('AVAILABLE','PAYABLE') then
    return jsonb_build_object('state',coalesce(option->>'state','BLOCKED'),
      'error',case when option->>'state'='TOO_EARLY' then 'O Pix é liberado 15 dias antes do vencimento.'
      when option->>'state' in ('PAID','CONFIRMED') then 'Este pagamento já foi identificado.'
      else 'Esta mensalidade precisa de revisão do clube antes da emissão.' end);
  end if;
  invoice_id:=(option->>'invoice_id')::uuid;
  if invoice_id is null then
    generated:=public.generate_enrolled_app_monthly_pix_billing(p_invoice_month,p_client_id,p_provider_environment);
    invoice_id:=(generated#>>'{results,0,invoiceId}')::uuid;
  end if;
  if invoice_id is null then return jsonb_build_object('state','BLOCKED','error','Não foi possível preparar a mensalidade. Fale com o clube.'); end if;
  return jsonb_build_object('state',option->>'state','invoiceId',invoice_id);
end;
$$;
revoke all on function public.prepare_client_monthly_pix(uuid,date,text) from public,anon,authenticated,service_role;
grant execute on function public.prepare_client_monthly_pix(uuid,date,text) to service_role;

-- One in-app reminder per payer/cycle/day, only while actually payable.
create function private.monthly_payment_reminder_targets(p_today date)
returns table(invoice_id uuid,client_id uuid,due_date date,amount numeric,invoice_month date)
language sql stable security definer set search_path='' as $$
 select i.id,i.client_id,i.due_date,i.amount,i.invoice_month from public.app_payment_invoices i
 join public.app_monthly_billing_enrollments e on e.client_id=i.client_id and e.enabled and e.billing_method='ASAAS_PIX'
 join public.app_clients c on c.id=i.client_id and c.status='ATIVO'
 where i.superseded_at is null and i.status in ('ABERTA','AGUARDANDO','VENCIDA') and i.paid_at is null
   and i.provider_status in ('PENDING','OVERDUE') and nullif(trim(i.pix_payload),'') is not null
   and (i.pix_expires_at is null or i.pix_expires_at>now())
   and p_today between i.due_date-5 and i.due_date+5
   and not exists(select 1 from public.app_family_members f where f.member_client_id=i.client_id
     and f.billing_responsible_id<>i.client_id and f.status in ('ATIVO','PENDENTE'));
$$;
revoke all on function private.monthly_payment_reminder_targets(date) from public,anon,authenticated,service_role;

create function public.enqueue_due_monthly_payment_reminders()
returns integer language plpgsql security definer set search_path='' as $$
declare inserted integer; today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
  with added as (
    insert into public.app_client_notifications(user_id,title,body,link_url,event_type,dedupe_key)
    select t.client_id,case when t.due_date<today then 'Mensalidade em aberto' when t.due_date=today then 'Sua mensalidade vence hoje' else 'Lembrete da mensalidade' end,
      'Mensalidade de R$ '||replace(to_char(t.amount,'FM999999990.00'),'.',',')||' · vencimento '||to_char(t.due_date,'DD/MM')||'. Abra o app para pagar por Pix.',
      '/?view=payments&invoice='||t.invoice_id::text,'FATURA_MENSAL_LEMBRETE',
      'monthly-reminder:'||t.client_id::text||':'||t.invoice_month::text||':'||today::text
    from private.monthly_payment_reminder_targets(today) t
    on conflict(dedupe_key) where dedupe_key is not null do nothing returning 1
  ) select count(*) into inserted from added;
  return inserted;
end;
$$;
revoke all on function public.enqueue_due_monthly_payment_reminders() from public,anon,authenticated,service_role;
grant execute on function public.enqueue_due_monthly_payment_reminders() to service_role;

-- Issuance at D-15 is silent. Daily reminders own billing notifications now;
-- payment receipts and finance-team failure alerts are unaffected.
create function private.suppress_monthly_issued_notification()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.event_type='FATURA_MENSAL_DISPONIVEL' then return null; end if;
  return new;
end;
$$;
revoke all on function private.suppress_monthly_issued_notification() from public,anon,authenticated,service_role;
create trigger suppress_monthly_issued_notification before insert on public.app_client_notifications
  for each row execute function private.suppress_monthly_issued_notification();

-- Recheck immediately before sending a queued push: a payment/disable/date
-- change after enqueue must stop delivery (including stale previous-day jobs).
create function public.monthly_payment_notification_is_current(p_notification_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.app_client_notifications n
   join private.monthly_payment_reminder_targets((now() at time zone 'America/Sao_Paulo')::date) t
   on n.user_id=t.client_id and n.link_url='/?view=payments&invoice='||t.invoice_id::text
   where n.id=p_notification_id and n.event_type='FATURA_MENSAL_LEMBRETE'
   and n.dedupe_key='monthly-reminder:'||t.client_id::text||':'||t.invoice_month::text||':'||(now() at time zone 'America/Sao_Paulo')::date::text);
$$;
revoke all on function public.monthly_payment_notification_is_current(uuid) from public,anon,authenticated,service_role;
grant execute on function public.monthly_payment_notification_is_current(uuid) to service_role;

-- Scheduling is activated operationally after deployment and verification.
commit;
