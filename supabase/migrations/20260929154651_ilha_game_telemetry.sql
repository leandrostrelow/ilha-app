create table public.arcade_telemetry_events (
  event_id uuid primary key,
  event_name text not null check (event_name in (
    'game_opened',
    'campaign_started',
    'match_started',
    'match_finished',
    'campaign_completed'
  )),
  player_hash text not null check (player_hash ~ '^[a-f0-9]{64}$'),
  ip_hash text not null check (ip_hash ~ '^[a-f0-9]{64}$'),
  game_version text not null check (char_length(game_version) between 1 and 40),
  properties jsonb not null default '{}'::jsonb check (
    jsonb_typeof(properties) = 'object'
    and pg_column_size(properties) <= 1024
  ),
  occurred_at timestamptz not null default now()
);

comment on table public.arcade_telemetry_events is
  'Eventos anonimizados do Ilha Tenis Legado; sem nome, apelido ou endereco IP em texto puro.';

create index arcade_telemetry_events_name_time_idx
  on public.arcade_telemetry_events (event_name, occurred_at desc);

create index arcade_telemetry_events_player_time_idx
  on public.arcade_telemetry_events (player_hash, occurred_at desc);

create index arcade_telemetry_events_ip_time_idx
  on public.arcade_telemetry_events (ip_hash, occurred_at desc);

alter table public.arcade_telemetry_events enable row level security;

revoke all on table public.arcade_telemetry_events from public, anon, authenticated;
grant select, insert on table public.arcade_telemetry_events to service_role;
