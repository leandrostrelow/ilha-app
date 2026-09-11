begin;

create table public.tournament_prediction_campaigns (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null unique references public.tournaments(id) on delete restrict,
  title text not null default 'Palpite Ilha',
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'OPEN', 'LOCKED', 'FINISHED', 'ARCHIVED')),
  published boolean not null default false,
  opens_at timestamptz,
  closes_at timestamptz,
  rules_version integer not null default 1 check (rules_version > 0),
  rules_text text not null default
    'Cada palpite correto vale pontos. Fases iniciais valem 1 ponto, semifinais valem 2 e finais valem 3. Em caso de empate, vence quem tiver mais partidas apuradas e, depois, quem entrou primeiro.',
  initial_round_points smallint not null default 1 check (initial_round_points between 1 and 20),
  semifinal_points smallint not null default 2 check (semifinal_points between 1 and 20),
  final_points smallint not null default 3 check (final_points between 1 and 20),
  prize_enabled boolean not null default false,
  prize_description text,
  authorization_reference text,
  winner_entry_id uuid,
  finalized_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_prediction_campaign_title_check
    check (char_length(trim(title)) between 3 and 120),
  constraint tournament_prediction_campaign_rules_check
    check (char_length(trim(rules_text)) between 20 and 4000),
  constraint tournament_prediction_campaign_dates_check
    check (closes_at is null or opens_at is null or closes_at > opens_at),
  constraint tournament_prediction_campaign_prize_check
    check (
      not prize_enabled
      or (
        prize_description is not null
        and char_length(trim(prize_description)) between 3 and 240
        and authorization_reference is not null
        and char_length(trim(authorization_reference)) between 3 and 160
      )
    )
);

comment on table public.tournament_prediction_campaigns is
  'Configuração privada do Palpite Ilha, sempre vinculado a um torneio real.';
comment on column public.tournament_prediction_campaigns.authorization_reference is
  'Referência administrativa de revisão/autorização exigida antes de divulgar prêmio promocional.';

create table public.tournament_prediction_entries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.tournament_prediction_campaigns(id) on delete cascade,
  registration_request_id uuid not null unique,
  full_name text not null,
  public_name text not null,
  email text not null,
  phone text not null,
  access_code_hash text not null,
  rules_version integer not null check (rules_version > 0),
  consent_at timestamptz not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'BLOCKED')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_prediction_entry_name_check
    check (char_length(trim(full_name)) between 3 and 120),
  constraint tournament_prediction_entry_public_name_check
    check (char_length(trim(public_name)) between 2 and 80),
  constraint tournament_prediction_entry_email_check
    check (char_length(email) between 5 and 254 and email = lower(trim(email)) and position('@' in email) > 1),
  constraint tournament_prediction_entry_phone_check
    check (phone ~ '^[0-9]{10,13}$'),
  constraint tournament_prediction_entry_access_hash_check
    check (access_code_hash ~ '^[a-f0-9]{64}$')
);

comment on table public.tournament_prediction_entries is
  'Participantes e contatos privados do Palpite Ilha; nunca expostos diretamente ao navegador.';

create unique index tournament_prediction_entries_campaign_email_key
  on public.tournament_prediction_entries(campaign_id, lower(email));
create unique index tournament_prediction_entries_campaign_phone_key
  on public.tournament_prediction_entries(campaign_id, phone);
create index tournament_prediction_entries_campaign_status_idx
  on public.tournament_prediction_entries(campaign_id, status, created_at);

create table public.tournament_predictions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.tournament_prediction_campaigns(id) on delete cascade,
  entry_id uuid not null references public.tournament_prediction_entries(id) on delete cascade,
  match_id uuid not null references public.tournament_matches(id) on delete restrict,
  predicted_winner_athlete_id uuid not null references public.tournament_athletes(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entry_id, match_id)
);

comment on table public.tournament_predictions is
  'Um palpite gratuito por participante e partida, editável somente antes do início real do jogo.';

create index tournament_predictions_campaign_match_idx
  on public.tournament_predictions(campaign_id, match_id);
create index tournament_predictions_entry_updated_idx
  on public.tournament_predictions(entry_id, updated_at desc);
create index tournament_predictions_winner_athlete_idx
  on public.tournament_predictions(predicted_winner_athlete_id);

create table public.tournament_prediction_requests (
  request_id uuid primary key,
  campaign_id uuid not null references public.tournament_prediction_campaigns(id) on delete cascade,
  entry_id uuid not null references public.tournament_prediction_entries(id) on delete cascade,
  match_id uuid not null references public.tournament_matches(id) on delete restrict,
  predicted_winner_athlete_id uuid not null references public.tournament_athletes(id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on table public.tournament_prediction_requests is
  'Ledger idempotente: uma request antiga nunca pode desfazer um palpite mais novo.';

create index tournament_prediction_requests_entry_created_idx
  on public.tournament_prediction_requests(entry_id, created_at desc);

alter table public.tournament_prediction_campaigns
  add constraint tournament_prediction_campaign_winner_fkey
  foreign key (winner_entry_id)
  references public.tournament_prediction_entries(id)
  on delete set null;

create table public.tournament_prediction_audit_log (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.tournament_prediction_campaigns(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_kind text not null check (actor_kind in ('ADMIN', 'PARTICIPANT', 'SYSTEM')),
  action text not null check (char_length(action) between 2 and 80),
  entity_type text not null check (char_length(entity_type) between 2 and 80),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.tournament_prediction_audit_log is
  'Trilha append-only sem e-mail ou telefone dos eventos administrativos e palpites.';

create index tournament_prediction_audit_campaign_created_idx
  on public.tournament_prediction_audit_log(campaign_id, created_at desc);
create index tournament_prediction_audit_actor_idx
  on public.tournament_prediction_audit_log(actor_id)
  where actor_id is not null;

create table public.tournament_prediction_rate_limits (
  scope_key text not null,
  window_started_at timestamptz not null,
  attempts integer not null default 1 check (attempts > 0),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (scope_key, window_started_at),
  constraint tournament_prediction_rate_scope_check
    check (scope_key ~ '^[a-z][a-z0-9_-]{1,31}:[a-f0-9]{64}$')
);

create index tournament_prediction_rate_expiry_idx
  on public.tournament_prediction_rate_limits(expires_at);

alter table public.tournament_prediction_campaigns enable row level security;
alter table public.tournament_prediction_campaigns force row level security;
alter table public.tournament_prediction_entries enable row level security;
alter table public.tournament_prediction_entries force row level security;
alter table public.tournament_predictions enable row level security;
alter table public.tournament_predictions force row level security;
alter table public.tournament_prediction_requests enable row level security;
alter table public.tournament_prediction_requests force row level security;
alter table public.tournament_prediction_audit_log enable row level security;
alter table public.tournament_prediction_audit_log force row level security;
alter table public.tournament_prediction_rate_limits enable row level security;
alter table public.tournament_prediction_rate_limits force row level security;

revoke all on table public.tournament_prediction_campaigns from public, anon, authenticated;
revoke all on table public.tournament_prediction_entries from public, anon, authenticated;
revoke all on table public.tournament_predictions from public, anon, authenticated;
revoke all on table public.tournament_prediction_requests from public, anon, authenticated;
revoke all on table public.tournament_prediction_audit_log from public, anon, authenticated;
revoke all on table public.tournament_prediction_rate_limits from public, anon, authenticated;
grant all on table public.tournament_prediction_campaigns to service_role;
grant all on table public.tournament_prediction_entries to service_role;
grant all on table public.tournament_predictions to service_role;
grant all on table public.tournament_prediction_requests to service_role;
grant all on table public.tournament_prediction_audit_log to service_role;
grant all on table public.tournament_prediction_rate_limits to service_role;

create or replace function private.touch_tournament_prediction_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.touch_tournament_prediction_updated_at()
  from public, anon, authenticated;

create trigger touch_tournament_prediction_campaign_updated_at
before update on public.tournament_prediction_campaigns
for each row execute function private.touch_tournament_prediction_updated_at();

create trigger touch_tournament_prediction_entry_updated_at
before update on public.tournament_prediction_entries
for each row execute function private.touch_tournament_prediction_updated_at();

create trigger touch_tournament_prediction_updated_at
before update on public.tournament_predictions
for each row execute function private.touch_tournament_prediction_updated_at();

create or replace function private.guard_tournament_prediction_campaign_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.tournament_id is distinct from old.tournament_id then
    raise exception using errcode = '23514', message = 'O torneio do Palpite Ilha não pode ser trocado.';
  end if;

  if exists (
    select 1
    from public.tournament_prediction_entries as entry
    where entry.campaign_id = old.id
  ) and (
    new.rules_version is distinct from old.rules_version
    or new.rules_text is distinct from old.rules_text
    or new.initial_round_points is distinct from old.initial_round_points
    or new.semifinal_points is distinct from old.semifinal_points
    or new.final_points is distinct from old.final_points
  ) then
    raise exception using errcode = '23514', message = 'As regras e a pontuação não podem mudar depois do primeiro cadastro.';
  end if;

  if new.status = 'FINISHED' and new.winner_entry_id is null then
    raise exception using errcode = '23514', message = 'Confirme o vencedor antes de finalizar o Palpite Ilha.';
  end if;

  if new.winner_entry_id is not null and not exists (
    select 1
    from public.tournament_prediction_entries as entry
    where entry.id = new.winner_entry_id
      and entry.campaign_id = new.id
      and entry.status = 'ACTIVE'
  ) then
    raise exception using errcode = '23514', message = 'O vencedor precisa pertencer ao próprio desafio e estar ativo.';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_tournament_prediction_campaign_update()
  from public, anon, authenticated;

create trigger guard_tournament_prediction_campaign_update
before update on public.tournament_prediction_campaigns
for each row execute function private.guard_tournament_prediction_campaign_update();

create or replace function private.guard_tournament_prediction_integrity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.tournament_prediction_entries as entry
    where entry.id = new.entry_id
      and entry.campaign_id = new.campaign_id
  ) or not exists (
    select 1
    from public.tournament_prediction_campaigns as campaign
    join public.tournament_matches as match
      on match.id = new.match_id
     and match.tournament_id = campaign.tournament_id
     and new.predicted_winner_athlete_id in (match.side1_athlete_id, match.side2_athlete_id)
    where campaign.id = new.campaign_id
  ) then
    raise exception using errcode = '23514', message = 'O palpite precisa pertencer ao participante e ao torneio da própria campanha.';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_tournament_prediction_integrity()
  from public, anon, authenticated;

create trigger guard_tournament_prediction_integrity
before insert or update on public.tournament_predictions
for each row execute function private.guard_tournament_prediction_integrity();

create trigger guard_tournament_prediction_request_integrity
before insert or update on public.tournament_prediction_requests
for each row execute function private.guard_tournament_prediction_integrity();

create or replace function public.consume_tournament_prediction_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_scope text := lower(trim(coalesce(p_scope, '')));
  v_window_started_at timestamptz;
  v_attempts integer;
  v_retry_after integer;
begin
  if v_scope not in ('snapshot', 'register', 'resume', 'state', 'predict')
     or coalesce(p_key_hash, '') !~ '^[a-f0-9]{64}$'
     or p_limit not between 1 and 500
     or p_window_seconds not between 10 and 3600 then
    raise exception using errcode = '22023', message = 'Limite de acesso inválido.';
  end if;

  delete from public.tournament_prediction_rate_limits as rate_limit
  where rate_limit.expires_at < v_now - interval '1 day';

  v_window_started_at := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );

  insert into public.tournament_prediction_rate_limits as rate_limit (
    scope_key,
    window_started_at,
    attempts,
    expires_at,
    updated_at
  ) values (
    v_scope || ':' || p_key_hash,
    v_window_started_at,
    1,
    v_window_started_at + make_interval(secs => p_window_seconds),
    v_now
  )
  on conflict (scope_key, window_started_at) do update
    set attempts = rate_limit.attempts + 1,
        updated_at = excluded.updated_at
  returning rate_limit.attempts into v_attempts;

  if v_attempts > p_limit then
    v_retry_after := greatest(
      0,
      ceil(extract(epoch from (
        v_window_started_at + make_interval(secs => p_window_seconds) - v_now
      )))::integer
    );
    return query select false, v_retry_after;
    return;
  end if;

  return query select true, 0;
end;
$$;

revoke all on function public.consume_tournament_prediction_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_tournament_prediction_rate_limit(text, text, integer, integer)
  to service_role;

create or replace function public.register_tournament_prediction_entry(
  p_campaign_id uuid,
  p_request_id uuid,
  p_full_name text,
  p_public_name text,
  p_email text,
  p_phone text,
  p_access_code_hash text
)
returns public.tournament_prediction_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.tournament_prediction_campaigns%rowtype;
  v_entry public.tournament_prediction_entries%rowtype;
  v_now timestamptz := clock_timestamp();
  v_created boolean := false;
begin
  select * into v_campaign
  from public.tournament_prediction_campaigns as campaign
  where campaign.id = p_campaign_id
  for share;

  if not found then
    raise exception using errcode = 'P0001', message = 'campaign_not_found';
  end if;
  if p_request_id is null
     or coalesce(p_access_code_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_registration';
  end if;

  select * into v_entry
  from public.tournament_prediction_entries as entry
  where entry.registration_request_id = p_request_id;

  if found then
    if v_entry.campaign_id is distinct from v_campaign.id
       or v_entry.full_name is distinct from trim(p_full_name)
       or v_entry.public_name is distinct from trim(p_public_name)
       or v_entry.email is distinct from lower(trim(p_email))
       or v_entry.phone is distinct from p_phone
       or v_entry.access_code_hash is distinct from p_access_code_hash then
      raise exception using errcode = '23505', message = 'registration_conflict';
    end if;
    return v_entry;
  end if;

  if v_campaign.status <> 'OPEN'
     or not v_campaign.published
     or (v_campaign.opens_at is not null and v_now < v_campaign.opens_at)
     or (v_campaign.closes_at is not null and v_now >= v_campaign.closes_at) then
    raise exception using errcode = 'P0001', message = 'campaign_closed';
  end if;

  insert into public.tournament_prediction_entries (
    campaign_id,
    registration_request_id,
    full_name,
    public_name,
    email,
    phone,
    access_code_hash,
    rules_version,
    consent_at,
    last_seen_at
  ) values (
    v_campaign.id,
    p_request_id,
    trim(p_full_name),
    trim(p_public_name),
    lower(trim(p_email)),
    p_phone,
    p_access_code_hash,
    v_campaign.rules_version,
    v_now,
    v_now
  )
  on conflict (registration_request_id) do nothing
  returning * into v_entry;

  v_created := found;

  if not v_created then
    select * into v_entry
    from public.tournament_prediction_entries as entry
    where entry.registration_request_id = p_request_id;
  end if;

  if v_entry.campaign_id <> v_campaign.id
     or v_entry.full_name <> trim(p_full_name)
     or v_entry.public_name <> trim(p_public_name)
     or v_entry.email <> lower(trim(p_email))
     or v_entry.phone <> p_phone
     or v_entry.access_code_hash <> p_access_code_hash then
    raise exception using errcode = '23505', message = 'registration_conflict';
  end if;

  if not v_created then
    return v_entry;
  end if;

  insert into public.tournament_prediction_audit_log (
    campaign_id, actor_kind, action, entity_type, entity_id, metadata
  ) values (
    v_campaign.id,
    'PARTICIPANT',
    'REGISTER',
    'entry',
    v_entry.id,
    jsonb_build_object('rules_version', v_entry.rules_version)
  );

  return v_entry;
end;
$$;

revoke all on function public.register_tournament_prediction_entry(uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.register_tournament_prediction_entry(uuid, uuid, text, text, text, text, text)
  to service_role;

create or replace function public.save_tournament_prediction(
  p_campaign_id uuid,
  p_entry_id uuid,
  p_access_code_hash text,
  p_match_id uuid,
  p_predicted_winner_athlete_id uuid,
  p_request_id uuid
)
returns public.tournament_predictions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.tournament_prediction_campaigns%rowtype;
  v_entry public.tournament_prediction_entries%rowtype;
  v_match public.tournament_matches%rowtype;
  v_tournament public.tournaments%rowtype;
  v_prediction public.tournament_predictions%rowtype;
  v_request public.tournament_prediction_requests%rowtype;
  v_now timestamptz := clock_timestamp();
  v_scheduled_at timestamptz;
begin
  select * into v_campaign
  from public.tournament_prediction_campaigns as campaign
  where campaign.id = p_campaign_id
  for share;

  if not found then
    raise exception using errcode = 'P0001', message = 'campaign_not_found';
  end if;
  select * into v_entry
  from public.tournament_prediction_entries as entry
  where entry.id = p_entry_id
    and entry.campaign_id = v_campaign.id
    and entry.access_code_hash = p_access_code_hash
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_access';
  end if;
  if v_entry.status <> 'ACTIVE' then
    raise exception using errcode = 'P0001', message = 'entry_blocked';
  end if;

  if p_request_id is null then
    raise exception using errcode = '22023', message = 'invalid_prediction';
  end if;

  select * into v_request
  from public.tournament_prediction_requests as request
  where request.request_id = p_request_id;

  if found then
    if v_request.campaign_id is distinct from v_campaign.id
       or v_request.entry_id is distinct from v_entry.id
       or v_request.match_id is distinct from p_match_id
       or v_request.predicted_winner_athlete_id is distinct from p_predicted_winner_athlete_id then
      raise exception using errcode = 'P0001', message = 'request_conflict';
    end if;
    select * into v_prediction
    from public.tournament_predictions as prediction
    where prediction.entry_id = v_entry.id
      and prediction.match_id = p_match_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'request_conflict';
    end if;
    return v_prediction;
  end if;

  if v_campaign.status <> 'OPEN'
     or not v_campaign.published
     or (v_campaign.opens_at is not null and v_now < v_campaign.opens_at)
     or (v_campaign.closes_at is not null and v_now >= v_campaign.closes_at) then
    raise exception using errcode = 'P0001', message = 'campaign_closed';
  end if;

  select * into v_match
  from public.tournament_matches as match
  where match.id = p_match_id
    and match.tournament_id = v_campaign.tournament_id
  for share;

  if not found or not v_match.published
     or v_match.side1_athlete_id is null
     or v_match.side2_athlete_id is null
     or p_predicted_winner_athlete_id not in (v_match.side1_athlete_id, v_match.side2_athlete_id) then
    raise exception using errcode = 'P0001', message = 'match_unavailable';
  end if;

  select * into v_tournament
  from public.tournaments as tournament
  where tournament.id = v_campaign.tournament_id;

  v_scheduled_at := coalesce(
    v_match.scheduled_at,
    case
      when v_match.match_date is not null and v_match.match_time is not null
      then (v_match.match_date + v_match.match_time) at time zone coalesce(v_tournament.timezone, 'America/Sao_Paulo')
      else null
    end
  );

  if upper(coalesce(v_match.status, '')) not in ('PENDING', 'SCHEDULED')
     or v_match.started_at is not null
     or v_match.finished_at is not null
     or v_match.winner_athlete_id is not null
     or (v_scheduled_at is not null and v_now >= v_scheduled_at) then
    raise exception using errcode = 'P0001', message = 'prediction_locked';
  end if;

  insert into public.tournament_prediction_requests (
    request_id,
    campaign_id,
    entry_id,
    match_id,
    predicted_winner_athlete_id
  ) values (
    p_request_id,
    v_campaign.id,
    v_entry.id,
    v_match.id,
    p_predicted_winner_athlete_id
  )
  on conflict (request_id) do nothing
  returning * into v_request;

  if not found then
    select * into v_request
    from public.tournament_prediction_requests as request
    where request.request_id = p_request_id;

    if v_request.campaign_id is distinct from v_campaign.id
       or v_request.entry_id is distinct from v_entry.id
       or v_request.match_id is distinct from v_match.id
       or v_request.predicted_winner_athlete_id is distinct from p_predicted_winner_athlete_id then
      raise exception using errcode = 'P0001', message = 'request_conflict';
    end if;

    select * into v_prediction
    from public.tournament_predictions as prediction
    where prediction.entry_id = v_entry.id
      and prediction.match_id = v_match.id;
    if not found then
      raise exception using errcode = 'P0001', message = 'request_conflict';
    end if;
    return v_prediction;
  end if;

  insert into public.tournament_predictions (
    campaign_id,
    entry_id,
    match_id,
    predicted_winner_athlete_id
  ) values (
    v_campaign.id,
    v_entry.id,
    v_match.id,
    p_predicted_winner_athlete_id
  )
  on conflict (entry_id, match_id) do update
    set predicted_winner_athlete_id = excluded.predicted_winner_athlete_id,
        updated_at = now()
  returning * into v_prediction;

  update public.tournament_prediction_entries
  set last_seen_at = v_now
  where id = v_entry.id;

  insert into public.tournament_prediction_audit_log (
    campaign_id, actor_kind, action, entity_type, entity_id, metadata
  ) values (
    v_campaign.id,
    'PARTICIPANT',
    'SAVE_PREDICTION',
    'prediction',
    v_prediction.id,
    jsonb_build_object('match_id', v_match.id)
  );

  return v_prediction;
end;
$$;

revoke all on function public.save_tournament_prediction(uuid, uuid, text, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.save_tournament_prediction(uuid, uuid, text, uuid, uuid, uuid)
  to service_role;

create or replace function public.admin_save_tournament_prediction_campaign(
  p_tournament_id uuid,
  p_actor_id uuid,
  p_title text,
  p_status text,
  p_published boolean,
  p_opens_at timestamptz,
  p_closes_at timestamptz,
  p_rules_text text,
  p_initial_round_points smallint,
  p_semifinal_points smallint,
  p_final_points smallint,
  p_prize_enabled boolean,
  p_prize_description text,
  p_authorization_reference text
)
returns public.tournament_prediction_campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_id uuid;
  v_saved public.tournament_prediction_campaigns%rowtype;
  v_status text := upper(trim(coalesce(p_status, '')));
begin
  if not exists (
    select 1 from public.tournaments as tournament
    where tournament.id = p_tournament_id
      and tournament.status <> 'ARCHIVED'
  ) then
    raise exception using errcode = 'P0001', message = 'tournament_not_found';
  end if;
  if v_status not in ('DRAFT', 'OPEN', 'LOCKED', 'ARCHIVED') then
    raise exception using errcode = '22023', message = 'invalid_campaign';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 3 and 120
     or char_length(trim(coalesce(p_rules_text, ''))) not between 20 and 4000
     or p_initial_round_points not between 1 and 20
     or p_semifinal_points not between 1 and 20
     or p_final_points not between 1 and 20 then
    raise exception using errcode = '22023', message = 'invalid_campaign';
  end if;
  if coalesce(p_prize_enabled, false) and (
    char_length(trim(coalesce(p_prize_description, ''))) not between 3 and 240
    or char_length(trim(coalesce(p_authorization_reference, ''))) not between 3 and 160
  ) then
    raise exception using errcode = '22023', message = 'prize_review_required';
  end if;

  select campaign.id into v_existing_id
  from public.tournament_prediction_campaigns as campaign
  where campaign.tournament_id = p_tournament_id
  for update;

  insert into public.tournament_prediction_campaigns (
    tournament_id, title, status, published, opens_at, closes_at, rules_text,
    initial_round_points, semifinal_points, final_points, prize_enabled,
    prize_description, authorization_reference, created_by, updated_by
  ) values (
    p_tournament_id, trim(p_title), v_status,
    case when v_status in ('DRAFT', 'ARCHIVED') then false else coalesce(p_published, false) end,
    p_opens_at, p_closes_at, trim(p_rules_text), p_initial_round_points,
    p_semifinal_points, p_final_points, coalesce(p_prize_enabled, false),
    nullif(trim(coalesce(p_prize_description, '')), ''),
    nullif(trim(coalesce(p_authorization_reference, '')), ''),
    p_actor_id, p_actor_id
  )
  on conflict (tournament_id) do update
    set title = excluded.title,
        status = excluded.status,
        published = excluded.published,
        opens_at = excluded.opens_at,
        closes_at = excluded.closes_at,
        rules_text = excluded.rules_text,
        initial_round_points = excluded.initial_round_points,
        semifinal_points = excluded.semifinal_points,
        final_points = excluded.final_points,
        prize_enabled = excluded.prize_enabled,
        prize_description = excluded.prize_description,
        authorization_reference = excluded.authorization_reference,
        updated_by = excluded.updated_by
  returning * into v_saved;

  insert into public.tournament_prediction_audit_log (
    campaign_id, actor_id, actor_kind, action, entity_type, entity_id, metadata
  ) values (
    v_saved.id, p_actor_id, 'ADMIN',
    case when v_existing_id is null then 'CREATE_CAMPAIGN' else 'UPDATE_CAMPAIGN' end,
    'campaign', v_saved.id,
    jsonb_build_object('status', v_saved.status, 'published', v_saved.published, 'prize_enabled', v_saved.prize_enabled)
  );
  return v_saved;
end;
$$;

revoke all on function public.admin_save_tournament_prediction_campaign(
  uuid, uuid, text, text, boolean, timestamptz, timestamptz, text,
  smallint, smallint, smallint, boolean, text, text
) from public, anon, authenticated;
grant execute on function public.admin_save_tournament_prediction_campaign(
  uuid, uuid, text, text, boolean, timestamptz, timestamptz, text,
  smallint, smallint, smallint, boolean, text, text
) to service_role;

create or replace function public.admin_set_tournament_prediction_entry_status(
  p_entry_id uuid,
  p_status text,
  p_actor_id uuid
)
returns public.tournament_prediction_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.tournament_prediction_entries%rowtype;
  v_campaign public.tournament_prediction_campaigns%rowtype;
  v_campaign_id uuid;
  v_status text := upper(trim(coalesce(p_status, '')));
  v_previous_status text;
begin
  if v_status not in ('ACTIVE', 'BLOCKED') then
    raise exception using errcode = '22023', message = 'invalid_entry_status';
  end if;
  select entry.campaign_id into v_campaign_id
  from public.tournament_prediction_entries as entry
  where entry.id = p_entry_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'entry_not_found';
  end if;
  select * into v_campaign
  from public.tournament_prediction_campaigns as campaign
  where campaign.id = v_campaign_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'campaign_not_found';
  end if;
  select * into v_entry
  from public.tournament_prediction_entries as entry
  where entry.id = p_entry_id
    and entry.campaign_id = v_campaign.id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'entry_not_found';
  end if;
  if v_campaign.status = 'FINISHED' then
    raise exception using errcode = 'P0001', message = 'campaign_finished';
  end if;

  v_previous_status := v_entry.status;
  update public.tournament_prediction_entries
  set status = v_status
  where id = v_entry.id
  returning * into v_entry;

  insert into public.tournament_prediction_audit_log (
    campaign_id, actor_id, actor_kind, action, entity_type, entity_id, metadata
  ) values (
    v_entry.campaign_id, p_actor_id, 'ADMIN', 'SET_ENTRY_STATUS', 'entry', v_entry.id,
    jsonb_build_object('from', v_previous_status, 'to', v_status, 'public_name', v_entry.public_name)
  );
  return v_entry;
end;
$$;

revoke all on function public.admin_set_tournament_prediction_entry_status(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_set_tournament_prediction_entry_status(uuid, text, uuid)
  to service_role;

create or replace function public.admin_delete_tournament_prediction_entry(
  p_entry_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.tournament_prediction_entries%rowtype;
  v_campaign public.tournament_prediction_campaigns%rowtype;
  v_campaign_id uuid;
begin
  select entry.campaign_id into v_campaign_id
  from public.tournament_prediction_entries as entry
  where entry.id = p_entry_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'entry_not_found';
  end if;
  select * into v_campaign
  from public.tournament_prediction_campaigns as campaign
  where campaign.id = v_campaign_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'campaign_not_found';
  end if;
  select * into v_entry
  from public.tournament_prediction_entries as entry
  where entry.id = p_entry_id
    and entry.campaign_id = v_campaign.id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'entry_not_found';
  end if;
  if v_campaign.status = 'FINISHED' then
    raise exception using errcode = 'P0001', message = 'campaign_finished';
  end if;

  delete from public.tournament_prediction_entries where id = v_entry.id;
  insert into public.tournament_prediction_audit_log (
    campaign_id, actor_id, actor_kind, action, entity_type, entity_id, metadata
  ) values (
    v_entry.campaign_id, p_actor_id, 'ADMIN', 'DELETE_ENTRY', 'entry', v_entry.id,
    jsonb_build_object('public_name', v_entry.public_name, 'previous_status', v_entry.status)
  );
  return v_entry.id;
end;
$$;

revoke all on function public.admin_delete_tournament_prediction_entry(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_delete_tournament_prediction_entry(uuid, uuid)
  to service_role;

create or replace function public.admin_finalize_tournament_prediction_campaign(
  p_tournament_id uuid,
  p_actor_id uuid
)
returns public.tournament_prediction_campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.tournament_prediction_campaigns%rowtype;
  v_tournament_status text;
  v_winner_id uuid;
  v_winner_score integer;
begin
  select * into v_campaign
  from public.tournament_prediction_campaigns as campaign
  where campaign.tournament_id = p_tournament_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'campaign_not_found';
  end if;
  if v_campaign.status <> 'LOCKED' then
    raise exception using errcode = 'P0001', message = 'campaign_must_be_locked';
  end if;

  select tournament.status into v_tournament_status
  from public.tournaments as tournament
  where tournament.id = p_tournament_id
  for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'tournament_not_found';
  end if;
  if v_tournament_status <> 'FINISHED' then
    raise exception using errcode = 'P0001', message = 'tournament_not_finished';
  end if;

  -- Tournament results are maintained outside this module. Hold the relevant
  -- match rows stable until the winner and final audit entry are committed.
  perform match.id
  from public.tournament_matches as match
  where match.tournament_id = p_tournament_id
    and match.published
  for share;

  if exists (
    select 1
    from public.tournament_matches as match
    where match.tournament_id = p_tournament_id
      and match.published
      and match.side1_athlete_id is not null
      and match.side2_athlete_id is not null
      and upper(coalesce(match.status, '')) <> 'CANCELLED'
      and (
        match.winner_athlete_id is null
        or upper(coalesce(match.status, '')) not in ('FINISHED', 'WALKOVER')
      )
  ) then
    raise exception using errcode = 'P0001', message = 'tournament_results_incomplete';
  end if;

  select entry.id,
         coalesce(sum(
           case when prediction.predicted_winner_athlete_id = match.winner_athlete_id then
             case
               when upper(coalesce(match.round_code, match.phase, '')) in ('FINAL', 'F') then v_campaign.final_points
               when upper(coalesce(match.round_code, match.phase, '')) in ('SF', 'SEMIFINAL', 'SEMI_FINAL') then v_campaign.semifinal_points
               else v_campaign.initial_round_points
             end
           else 0 end
         ), 0)::integer as score
  into v_winner_id, v_winner_score
  from public.tournament_prediction_entries as entry
  left join public.tournament_predictions as prediction on prediction.entry_id = entry.id
  left join public.tournament_matches as match
    on match.id = prediction.match_id
   and match.published
   and match.winner_athlete_id is not null
   and upper(coalesce(match.status, '')) in ('FINISHED', 'WALKOVER')
   and prediction.predicted_winner_athlete_id in (match.side1_athlete_id, match.side2_athlete_id)
  where entry.campaign_id = v_campaign.id
    and entry.status = 'ACTIVE'
  group by entry.id, entry.created_at
  having count(prediction.id) filter (where match.id is not null) > 0
  order by score desc,
           count(prediction.id) filter (where match.id is not null) desc,
           entry.created_at asc,
           entry.id asc
  limit 1;

  if v_winner_id is null then
    raise exception using errcode = 'P0001', message = 'no_winner';
  end if;
  update public.tournament_prediction_campaigns
  set winner_entry_id = v_winner_id,
      status = 'FINISHED',
      finalized_at = clock_timestamp(),
      updated_by = p_actor_id
  where id = v_campaign.id
  returning * into v_campaign;

  insert into public.tournament_prediction_audit_log (
    campaign_id, actor_id, actor_kind, action, entity_type, entity_id, metadata
  ) values (
    v_campaign.id, p_actor_id, 'ADMIN', 'FINALIZE_CAMPAIGN', 'campaign', v_campaign.id,
    jsonb_build_object('winner_entry_id', v_winner_id, 'score', v_winner_score)
  );
  return v_campaign;
end;
$$;

revoke all on function public.admin_finalize_tournament_prediction_campaign(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_finalize_tournament_prediction_campaign(uuid, uuid)
  to service_role;

create or replace function public.admin_reopen_tournament_prediction_campaign(
  p_tournament_id uuid,
  p_actor_id uuid
)
returns public.tournament_prediction_campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.tournament_prediction_campaigns%rowtype;
begin
  select * into v_campaign
  from public.tournament_prediction_campaigns as campaign
  where campaign.tournament_id = p_tournament_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'campaign_not_found';
  end if;
  if v_campaign.status <> 'FINISHED' then
    raise exception using errcode = 'P0001', message = 'campaign_not_finished';
  end if;
  update public.tournament_prediction_campaigns
  set winner_entry_id = null,
      finalized_at = null,
      status = 'OPEN',
      published = true,
      updated_by = p_actor_id
  where id = v_campaign.id
  returning * into v_campaign;

  insert into public.tournament_prediction_audit_log (
    campaign_id, actor_id, actor_kind, action, entity_type, entity_id, metadata
  ) values (
    v_campaign.id, p_actor_id, 'ADMIN', 'REOPEN_CAMPAIGN', 'campaign', v_campaign.id, '{}'::jsonb
  );
  return v_campaign;
end;
$$;

revoke all on function public.admin_reopen_tournament_prediction_campaign(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_reopen_tournament_prediction_campaign(uuid, uuid)
  to service_role;

insert into public.tournament_prediction_campaigns (
  tournament_id,
  title,
  status,
  published,
  opens_at,
  closes_at,
  prize_enabled,
  prize_description
)
select
  tournament.id,
  'Palpite Ilha · ' || tournament.name,
  'OPEN',
  true,
  now(),
  case
    when tournament.ends_on is not null
    then (tournament.ends_on + time '23:59:59') at time zone coalesce(tournament.timezone, 'America/Sao_Paulo')
    else now() + interval '30 days'
  end,
  false,
  'Uma camisa oficial do Ilha Tênis'
from public.tournaments as tournament
where tournament.slug = 'ilha-open-2026'
on conflict (tournament_id) do nothing;

commit;
