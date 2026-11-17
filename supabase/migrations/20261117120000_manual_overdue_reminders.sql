begin;
create table private.manual_overdue_reminders (
 request_id uuid primary key,
 invoice_id uuid not null references public.app_payment_invoices(id),
 notification_id uuid not null references public.app_client_notifications(id),
 actor_id uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
revoke all on private.manual_overdue_reminders from public,anon,authenticated,service_role;

create function private.overdue_invoice_is_payable(p_invoice_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.app_payment_invoices i
 join public.app_clients c on c.id=i.client_id and c.status='ATIVO'
 join public.app_monthly_billing_enrollments e on e.client_id=c.id and e.enabled
 where i.id=p_invoice_id and i.due_date<(now() at time zone 'America/Sao_Paulo')::date
 and i.amount>0 and i.superseded_at is null and i.paid_at is null and i.received_on is null
 and i.status in ('ABERTA','AGUARDANDO','VENCIDA')
 and ((i.payment_method in ('CLUB_PIX','CASH') and coalesce(i.provider_status,'') not in ('CONFIRMED','RECEIVED','RECEIVED_IN_CASH','CANCELLED'))
 or (i.provider_status in ('PENDING','OVERDUE') and nullif(trim(i.pix_payload),'') is not null
 and (i.pix_expires_at is null or i.pix_expires_at>now())))
 and not exists(select 1 from public.app_family_members m where m.member_client_id=i.client_id and m.billing_responsible_id<>i.client_id and m.status in ('ATIVO','PENDENTE'))
 and not exists(select 1 from private.monthly_invoice_receipts r where r.invoice_id=i.id and r.reversed_at is null));
$$;
revoke all on function private.overdue_invoice_is_payable(uuid) from public,anon,authenticated,service_role;

create function public.admin_resend_overdue_reminder(p_invoice_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.app_payment_invoices%rowtype; n uuid; previous private.manual_overdue_reminders%rowtype;
begin
 if auth.uid() is null or not coalesce(public.has_club_permission('finance.write'),false) then
 raise exception 'Seu acesso não permite reenviar cobranças.' using errcode='42501';end if;
 if p_request_id is null then raise exception 'Identificador do reenvio obrigatório.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
 select * into previous from private.manual_overdue_reminders where request_id=p_request_id;
 if found then
 if previous.invoice_id<>p_invoice_id or previous.actor_id<>auth.uid() then raise exception 'Reenvio divergente.';end if;
 return jsonb_build_object('state','QUEUED','notificationId',previous.notification_id);end if;
 select * into strict i from public.app_payment_invoices where id=p_invoice_id for update;
 if not private.overdue_invoice_is_payable(i.id) then raise exception 'A fatura não está disponível para cobrança. Atualize e confira a ficha.';end if;
 if exists(select 1 from private.manual_overdue_reminders where invoice_id=i.id and created_at>now()-interval '5 minutes') then
 raise exception 'Um aviso já foi solicitado nos últimos cinco minutos.';end if;
 insert into public.app_client_notifications(user_id,title,body,link_url,event_type,dedupe_key)
 values(i.client_id,'Mensalidade em aberto','Mensalidade de R$ '||replace(to_char(i.amount,'FM999999990.00'),'.',',')||' · vencimento '||to_char(i.due_date,'DD/MM/YYYY')||'. Abra o financeiro do app para conferir.',
 '/?view=payments&invoice='||i.id::text,'FATURA_MENSAL_LEMBRETE','monthly-manual:'||p_request_id::text) returning id into n;
 insert into private.manual_overdue_reminders values(p_request_id,i.id,n,auth.uid(),now());
 return jsonb_build_object('state','QUEUED','notificationId',n);
end;$$;
revoke all on function public.admin_resend_overdue_reminder(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_resend_overdue_reminder(uuid,uuid) to authenticated;

-- Keep the scheduled reminder policy intact; additionally validate explicitly
-- requested reminders at dispatch time, including debts older than five days.
alter function public.monthly_payment_notification_is_current(uuid) rename to scheduled_monthly_payment_notification_is_current;
revoke all on function public.scheduled_monthly_payment_notification_is_current(uuid) from public,anon,authenticated,service_role;
create function public.monthly_payment_notification_is_current(p_notification_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.scheduled_monthly_payment_notification_is_current(p_notification_id) or exists(
 select 1 from private.manual_overdue_reminders r join public.app_client_notifications n on n.id=r.notification_id
 join public.app_payment_invoices i on i.id=r.invoice_id
 where r.notification_id=p_notification_id and r.created_at>now()-interval '1 day'
 and n.user_id=i.client_id and n.event_type='FATURA_MENSAL_LEMBRETE'
 and n.link_url='/?view=payments&invoice='||i.id::text
 and private.overdue_invoice_is_payable(i.id));
$$;
revoke all on function public.monthly_payment_notification_is_current(uuid) from public,anon,authenticated,service_role;
grant execute on function public.monthly_payment_notification_is_current(uuid) to service_role;
commit;
