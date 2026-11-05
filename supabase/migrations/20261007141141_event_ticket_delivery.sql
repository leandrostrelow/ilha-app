begin;
create table public.bar_event_email_deliveries (
 order_id uuid primary key references public.bar_event_orders(id) on delete cascade,
 status text not null default 'PENDING' check(status in ('PENDING','SENDING','SENT','FAILED','REVIEW','CANCELLED')),
 attempts integer not null default 0,
 first_attempt_at timestamptz, next_attempt_at timestamptz not null default now(),
 lease_token uuid, lease_until timestamptz, payload jsonb,
 provider_message_id text, error_code text, sent_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.bar_event_email_deliveries enable row level security;
revoke all on public.bar_event_email_deliveries from anon, authenticated;
grant all on public.bar_event_email_deliveries to service_role;
create index event_email_pending on public.bar_event_email_deliveries(next_attempt_at) where status in ('PENDING','FAILED','SENDING');

create table public.bar_event_delivery_config (
 id boolean primary key default true check(id),
 dispatch_secret text not null default encode(extensions.gen_random_bytes(32),'hex')
);
alter table public.bar_event_delivery_config enable row level security;
revoke all on public.bar_event_delivery_config from anon, authenticated;
grant select on public.bar_event_delivery_config to service_role;
insert into public.bar_event_delivery_config(id) values(true);

create function public.event_email_dispatch_allowed(p_token text) returns boolean
language sql security definer set search_path='' as $$
 select length(coalesce(p_token,''))=64 and exists(select 1 from public.bar_event_delivery_config where dispatch_secret=p_token);
$$;

create function public.invoke_event_ticket_delivery() returns bigint
language plpgsql security definer set search_path='' as $$
declare v_url text; v_key text; v_token text;
begin
 if not exists(select 1 from public.bar_event_email_deliveries where status in ('PENDING','FAILED','SENDING') and next_attempt_at<=now() and coalesce(lease_until,now())<=now()) then return null; end if;
 select decrypted_secret into v_url from vault.decrypted_secrets where name='court_dispatch_url';
 select decrypted_secret into v_key from vault.decrypted_secrets where name='court_dispatch_publishable_key';
 select dispatch_secret into v_token from public.bar_event_delivery_config where id;
 if v_url !~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/client-notification-dispatch$' or v_key is null or v_url is null then return null; end if;
 return net.http_post(url:=replace(v_url,'/client-notification-dispatch','/event-ticketing'),headers:=jsonb_build_object('Content-Type','application/json','apikey',v_key,'x-event-dispatch-token',v_token),body:='{"action":"dispatch_emails"}'::jsonb,timeout_milliseconds:=5000);
end; $$;

create function public.queue_event_ticket_email() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='PAID' then
  insert into public.bar_event_email_deliveries(order_id) values(new.id) on conflict do nothing;
  perform public.invoke_event_ticket_delivery();
 end if;
 return new;
end; $$;
create trigger event_paid_ticket_email after insert or update of status on public.bar_event_orders for each row execute function public.queue_event_ticket_email();

create function public.event_claim_ticket_email(p_order uuid) returns setof public.bar_event_email_deliveries
language plpgsql security definer set search_path='' as $$
declare v public.bar_event_email_deliveries;
begin
 select * into v from public.bar_event_email_deliveries where order_id=p_order for update skip locked;
 if not found or v.status not in ('PENDING','FAILED','SENDING') or v.next_attempt_at>now() or v.lease_until>now() then return; end if;
 if not exists(select 1 from public.bar_event_orders where id=p_order and status='PAID') then
  update public.bar_event_email_deliveries set status='CANCELLED',payload=null where order_id=p_order; return;
 end if;
 -- Resend idempotency keys expire at 24h. Stop before then, even on ambiguous timeouts.
 if v.first_attempt_at<now()-interval '23 hours' or v.attempts>=12 then
  update public.bar_event_email_deliveries set status='REVIEW',error_code='retry_window_exhausted',payload=null where order_id=p_order; return;
 end if;
 return query update public.bar_event_email_deliveries set status='SENDING',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()),lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes' where order_id=p_order returning *;
end; $$;

create function public.event_finish_ticket_email(p_order uuid,p_lease uuid,p_provider text,p_error text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update public.bar_event_email_deliveries set
  status=case when p_provider is not null then 'SENT' else 'FAILED' end,
  provider_message_id=p_provider,error_code=left(p_error,100),
  sent_at=case when p_provider is not null then now() else null end,
  payload=case when p_provider is not null then null else payload end,
  next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,least(attempts,6)))::int),
  lease_until=null,lease_token=null
 where order_id=p_order and lease_token=p_lease and status='SENDING';
 return found;
end; $$;

revoke all on function public.event_email_dispatch_allowed(text),public.invoke_event_ticket_delivery(),public.queue_event_ticket_email(),public.event_claim_ticket_email(uuid),public.event_finish_ticket_email(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.event_email_dispatch_allowed(text),public.invoke_event_ticket_delivery(),public.event_claim_ticket_email(uuid),public.event_finish_ticket_email(uuid,uuid,text,text) to service_role;
select cron.schedule('ilha-event-ticket-emails','* * * * *','select public.invoke_event_ticket_delivery();');
commit;
