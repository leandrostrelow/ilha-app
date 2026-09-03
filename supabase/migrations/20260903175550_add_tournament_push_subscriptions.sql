create table if not exists public.tournament_push_subscriptions (
  id bigint generated always as identity primary key,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  endpoint text not null,
  endpoint_hash text not null,
  p256dh text not null,
  auth_key text not null,
  subscription_token_hash text not null,
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_push_subscriptions_endpoint_hash_key unique (tournament_id, endpoint_hash),
  constraint tournament_push_subscriptions_endpoint_length check (char_length(endpoint) between 20 and 4000),
  constraint tournament_push_subscriptions_endpoint_hash_format check (endpoint_hash ~ '^[0-9a-f]{64}$'),
  constraint tournament_push_subscriptions_p256dh_length check (char_length(p256dh) between 20 and 500),
  constraint tournament_push_subscriptions_auth_key_length check (char_length(auth_key) between 8 and 200),
  constraint tournament_push_subscriptions_token_hash_format check (subscription_token_hash ~ '^[0-9a-f]{64}$'),
  constraint tournament_push_subscriptions_user_agent_length check (user_agent is null or char_length(user_agent) <= 500)
);

create index if not exists tournament_push_subscriptions_tournament_enabled_idx
  on public.tournament_push_subscriptions (tournament_id, updated_at desc)
  where enabled = true;

alter table public.tournament_push_subscriptions enable row level security;
alter table public.tournament_push_subscriptions force row level security;

revoke all on table public.tournament_push_subscriptions from anon, authenticated;
revoke all on sequence public.tournament_push_subscriptions_id_seq from anon, authenticated;
grant all on table public.tournament_push_subscriptions to service_role;
grant usage, select on sequence public.tournament_push_subscriptions_id_seq to service_role;

comment on table public.tournament_push_subscriptions is
  'Web Push subscriptions for the public tournament PWA. Only Edge Functions using service_role may access these endpoints.';
