begin;

alter table public.tournament_payments
  add column if not exists expires_at timestamptz;

update public.tournament_payments
set expires_at = now() + interval '2 hours'
where expires_at is null
  and status in ('CREATED', 'PENDING', 'FAILED', 'OVERDUE');

alter table public.tournament_payments
  alter column expires_at set default (now() + interval '2 hours');

create index if not exists tournament_payments_expiry_idx
  on public.tournament_payments(expires_at, id)
  where status in ('CREATED', 'PENDING', 'FAILED', 'OVERDUE');

create schema if not exists private;

create table if not exists private.tournament_expired_registration_attempts (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null,
  athlete_id uuid,
  primary_registration_id uuid not null,
  payment_id uuid not null unique,
  registration_snapshot jsonb not null default '[]'::jsonb,
  payment_snapshot jsonb not null default '{}'::jsonb,
  expired_at timestamptz not null default now()
);

revoke all on table private.tournament_expired_registration_attempts from public, anon, authenticated;
grant select, insert on table private.tournament_expired_registration_attempts to service_role;

create or replace function public.archive_expired_tournament_payment(
  p_payment_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.tournament_payments%rowtype;
  primary_registration_id uuid;
  athlete_id uuid;
  registration_snapshot jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;

  select payment.*
    into payment_row
  from public.tournament_payments as payment
  where payment.id = p_payment_id
  for update;

  if not found
     or payment_row.status in ('RECEIVED', 'CONFIRMED', 'REFUNDED', 'CHARGEBACK')
     or payment_row.expires_at is null
     or payment_row.expires_at > now() then
    return false;
  end if;

  select coalesce(registration.parent_registration_id, registration.id), registration.athlete_id
    into primary_registration_id, athlete_id
  from public.tournament_registrations as registration
  where registration.id = payment_row.registration_id
  for update;

  if primary_registration_id is null then
    delete from public.tournament_payments where id = payment_row.id;
    return true;
  end if;

  select coalesce(jsonb_agg(to_jsonb(registration) order by registration.parent_registration_id nulls first), '[]'::jsonb)
    into registration_snapshot
  from public.tournament_registrations as registration
  where registration.id = primary_registration_id
     or registration.parent_registration_id = primary_registration_id;

  insert into private.tournament_expired_registration_attempts (
    tournament_id,
    athlete_id,
    primary_registration_id,
    payment_id,
    registration_snapshot,
    payment_snapshot,
    expired_at
  ) values (
    payment_row.tournament_id,
    athlete_id,
    primary_registration_id,
    payment_row.id,
    registration_snapshot,
    to_jsonb(payment_row) - 'raw_response' - 'pix_payload' - 'pix_encoded_image',
    now()
  ) on conflict (payment_id) do nothing;

  delete from public.tournament_registrations
  where id = primary_registration_id;

  return true;
end;
$$;

revoke all on function public.archive_expired_tournament_payment(uuid) from public, anon, authenticated;
grant execute on function public.archive_expired_tournament_payment(uuid) to service_role;

create or replace function public.invoke_tournament_payment_expiry()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  expiry_url text;
  publishable_key text;
begin
  select secret.decrypted_secret
    into expiry_url
  from vault.decrypted_secrets as secret
  where secret.name = 'tournament_payment_expiry_url'
  limit 1;

  select secret.decrypted_secret
    into publishable_key
  from vault.decrypted_secrets as secret
  where secret.name = 'tournament_payment_expiry_publishable_key'
  limit 1;

  if expiry_url is null
     or expiry_url !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*/functions/v1/tournament-payment-expiry$'
     or publishable_key is null
     or publishable_key !~ '^sb_publishable_[A-Za-z0-9_-]{20,}$' then
    return null;
  end if;

  return net.http_post(
    url := expiry_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', publishable_key,
      'Authorization', 'Bearer ' || publishable_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
end;
$$;

revoke all on function public.invoke_tournament_payment_expiry() from public, anon, authenticated;
grant execute on function public.invoke_tournament_payment_expiry() to service_role;

do $$
declare
  job_id bigint;
begin
  for job_id in
    select job.jobid from cron.job as job
    where job.jobname = 'ilha-open-expire-unpaid-registrations'
  loop
    perform cron.unschedule(job_id);
  end loop;
end;
$$;

select cron.schedule(
  'ilha-open-expire-unpaid-registrations',
  '*/5 * * * *',
  $cron$select public.invoke_tournament_payment_expiry();$cron$
);

commit;
