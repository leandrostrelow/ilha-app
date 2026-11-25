begin;

-- The app owns its own reminder calendar. Do not modify the Asaas WhatsApp
-- policy, enrollment, invoices or receipts when changing notification timing.
create or replace function private.monthly_payment_reminder_targets(p_today date)
returns table(invoice_id uuid,client_id uuid,due_date date,amount numeric,invoice_month date)
language sql stable security definer set search_path='' as $$
 select i.id,i.client_id,i.due_date,i.amount,i.invoice_month
 from public.app_payment_invoices i
 join public.app_monthly_billing_enrollments e
   on e.client_id=i.client_id and e.enabled and e.billing_method='ASAAS_PIX'
 join public.app_clients c on c.id=i.client_id and c.status='ATIVO'
 where i.superseded_at is null and i.status in ('ABERTA','AGUARDANDO','VENCIDA')
   and i.amount>0 and i.paid_at is null and i.received_on is null
   and i.provider_status in ('PENDING','OVERDUE')
   and nullif(trim(i.pix_payload),'') is not null
   and (i.pix_expires_at is null or i.pix_expires_at>now())
   and i.due_date-p_today in (-3,-1,0,1,3)
   and not exists(select 1 from public.app_family_members f
     where f.member_client_id=i.client_id and f.billing_responsible_id<>i.client_id
       and f.status in ('ATIVO','PENDENTE'))
   -- A manual receipt claim or a provider reconciliation under review must
   -- suppress reminders even while the invoice snapshot is being updated.
   and not exists(select 1 from private.monthly_invoice_receipts r
     where r.invoice_id=i.id and r.reversed_at is null)
   and not exists(select 1 from public.app_invoice_provider_payments p
     where p.invoice_id=i.id and p.status not in ('PENDING','OVERDUE'));
$$;
revoke all on function private.monthly_payment_reminder_targets(date) from public,anon,authenticated,service_role;

create function private.monthly_payment_reminder_message(p_due_date date,p_amount numeric,p_today date)
returns table(title text,body text)
language sql immutable security invoker set search_path='' as $$
 select case p_due_date-p_today
   when 3 then 'Sua mensalidade vence em 3 dias'
   when 1 then 'Sua mensalidade vence amanhã'
   when 0 then 'Sua mensalidade vence hoje'
   when -1 then 'Sua mensalidade venceu ontem'
   when -3 then 'Sua mensalidade venceu há 3 dias' end,
   'Mensalidade de R$ '||replace(to_char(p_amount,'FM999999990.00'),'.',',')
     ||' · vencimento '||to_char(p_due_date,'DD/MM')||'. '
     ||case when p_due_date<p_today
       then 'O pagamento ainda está em aberto. Abra o app para conferir e pagar por Pix.'
       else 'Abra o app para conferir e pagar por Pix.' end
 where p_due_date-p_today in (-3,-1,0,1,3);
$$;
revoke all on function private.monthly_payment_reminder_message(date,numeric,date) from public,anon,authenticated,service_role;

create or replace function public.enqueue_due_monthly_payment_reminders()
returns integer language plpgsql security definer set search_path='' as $$
declare inserted integer; today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
  with added as (
    insert into public.app_client_notifications(user_id,title,body,link_url,event_type,dedupe_key)
    select t.client_id,m.title,m.body,
      '/?view=payments&invoice='||t.invoice_id::text,'FATURA_MENSAL_LEMBRETE',
      'monthly-reminder:'||t.client_id::text||':'||t.invoice_month::text||':'||today::text
    from private.monthly_payment_reminder_targets(today) t
    cross join lateral private.monthly_payment_reminder_message(t.due_date,t.amount,today) m
    on conflict(dedupe_key) where dedupe_key is not null do nothing returning 1
  ) select count(*) into inserted from added;
  return inserted;
end;
$$;
revoke all on function public.enqueue_due_monthly_payment_reminders() from public,anon,authenticated,service_role;
grant execute on function public.enqueue_due_monthly_payment_reminders() to service_role;

-- Preserve the later public wrapper that separately validates manual reminders.
-- Recheck the date, amount and message as well as payment state before push,
-- so an edited invoice cannot deliver a now-incorrect queued reminder.
create or replace function public.scheduled_monthly_payment_notification_is_current(p_notification_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
   select 1 from public.app_client_notifications n
   join private.monthly_payment_reminder_targets((now() at time zone 'America/Sao_Paulo')::date) t
     on n.user_id=t.client_id and n.link_url='/?view=payments&invoice='||t.invoice_id::text
   cross join lateral private.monthly_payment_reminder_message(
     t.due_date,t.amount,(now() at time zone 'America/Sao_Paulo')::date) m
   where n.id=p_notification_id and n.event_type='FATURA_MENSAL_LEMBRETE'
     and n.title=m.title and n.body=m.body
     and n.dedupe_key='monthly-reminder:'||t.client_id::text||':'||t.invoice_month::text||':'
       ||(now() at time zone 'America/Sao_Paulo')::date::text
 );
$$;
revoke all on function public.scheduled_monthly_payment_notification_is_current(uuid) from public,anon,authenticated,service_role;

-- The existing daily 09:30 America/Sao_Paulo cron remains unchanged. There is
-- no retroactive enqueue here and no client notification is sent by migration.
commit;
