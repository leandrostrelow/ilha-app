alter table public.tournament_prediction_entries
  add constraint tournament_prediction_entries_campaign_id_id_key unique (campaign_id, id);

create table public.tournament_prediction_access_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.tournament_prediction_campaigns(id) on delete cascade,
  entry_id uuid not null references public.tournament_prediction_entries(id) on delete cascade,
  status text not null default 'SENDING' check (status in ('SENDING', 'SENT', 'FAILED')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  provider_message_id text,
  last_error_code text,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entry_id),
  constraint tournament_prediction_access_email_campaign_entry_key
    foreign key (campaign_id, entry_id)
    references public.tournament_prediction_entries(campaign_id, id)
    on delete cascade,
  constraint tournament_prediction_access_email_provider_id_check
    check (provider_message_id is null or char_length(provider_message_id) between 3 and 160),
  constraint tournament_prediction_access_email_error_check
    check (last_error_code is null or last_error_code ~ '^[a-z0-9_.-]{2,80}$')
);

comment on table public.tournament_prediction_access_email_deliveries is
  'Ledger privado e idempotente dos e-mails que guardam o código de acesso do Ilha Bet.';

create index tournament_prediction_access_email_campaign_status_idx
  on public.tournament_prediction_access_email_deliveries(campaign_id, status, updated_at desc);

alter table public.tournament_prediction_access_email_deliveries enable row level security;
alter table public.tournament_prediction_access_email_deliveries force row level security;

revoke all on table public.tournament_prediction_access_email_deliveries from public, anon, authenticated;
grant all on table public.tournament_prediction_access_email_deliveries to service_role;

create trigger touch_tournament_prediction_access_email_updated_at
before update on public.tournament_prediction_access_email_deliveries
for each row execute function private.touch_tournament_prediction_updated_at();

create or replace function public.claim_tournament_prediction_access_email(p_entry_id uuid)
returns table(delivery_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign_id uuid;
begin
  select entry.campaign_id
  into v_campaign_id
  from public.tournament_prediction_entries as entry
  where entry.id = p_entry_id;

  if v_campaign_id is null then
    raise exception using errcode = 'P0001', message = 'entry_not_found';
  end if;

  return query
  insert into public.tournament_prediction_access_email_deliveries as delivery (
    campaign_id,
    entry_id,
    status,
    attempt_count,
    claimed_at
  ) values (
    v_campaign_id,
    p_entry_id,
    'SENDING',
    1,
    clock_timestamp()
  )
  on conflict (entry_id) do update
    set status = 'SENDING',
        attempt_count = delivery.attempt_count + 1,
        provider_message_id = null,
        last_error_code = null,
        claimed_at = clock_timestamp(),
        sent_at = null,
        updated_at = clock_timestamp()
    where delivery.status = 'FAILED'
       or (delivery.status = 'SENDING' and delivery.claimed_at < clock_timestamp() - interval '10 minutes')
  returning delivery.id;
end;
$$;

revoke all on function public.claim_tournament_prediction_access_email(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_tournament_prediction_access_email(uuid)
  to service_role;

create or replace function public.complete_tournament_prediction_access_email(
  p_delivery_id uuid,
  p_sent boolean,
  p_provider_message_id text default null,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_count integer;
begin
  update public.tournament_prediction_access_email_deliveries
  set status = case when p_sent then 'SENT' else 'FAILED' end,
      provider_message_id = case when p_sent then nullif(left(trim(coalesce(p_provider_message_id, '')), 160), '') else null end,
      last_error_code = case when p_sent then null else coalesce(
        nullif(left(regexp_replace(lower(coalesce(p_error_code, '')), '[^a-z0-9_.-]+', '_', 'g'), 80), ''),
        'provider_error'
      ) end,
      sent_at = case when p_sent then clock_timestamp() else null end,
      updated_at = clock_timestamp()
  where id = p_delivery_id
    and status = 'SENDING';

  get diagnostics v_updated_count = row_count;
  return v_updated_count = 1;
end;
$$;

revoke all on function public.complete_tournament_prediction_access_email(uuid,boolean,text,text)
  from public, anon, authenticated;
grant execute on function public.complete_tournament_prediction_access_email(uuid,boolean,text,text)
  to service_role;
