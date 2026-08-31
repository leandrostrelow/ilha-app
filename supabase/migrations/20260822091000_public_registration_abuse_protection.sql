begin;

create table if not exists public.public_registration_rate_limits (
  scope_key text not null,
  window_started_at timestamptz not null,
  attempts integer not null default 1 check (attempts > 0),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (scope_key, window_started_at),
  check (scope_key ~ '^(global|ip:[a-f0-9]{64}|identity:[a-f0-9]{64})$')
);

create index if not exists public_registration_rate_limits_expiry_idx
  on public.public_registration_rate_limits(expires_at);

alter table public.public_registration_rate_limits enable row level security;
revoke all on table public.public_registration_rate_limits from public, anon, authenticated;
grant all on table public.public_registration_rate_limits to service_role;

-- Consume network-wide buckets before CAPTCHA. The identity bucket is kept in
-- a separate RPC and is consumed only after CAPTCHA succeeds, preventing a bot
-- from locking out a victim by submitting that person's email/phone.
create or replace function public.consume_tournament_registration_network_rate_limits(
  p_ip_hash text
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_allowed boolean := true;
  v_retry_after integer := 0;
  v_scope_key text;
  v_window_seconds integer;
  v_max_attempts integer;
  v_window_started_at timestamptz;
  v_attempts integer;
begin
  if p_ip_hash is not null and p_ip_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Identificador de limite inválido.';
  end if;

  delete from public.public_registration_rate_limits rate_limit
  where rate_limit.expires_at < v_now - interval '1 day';

  for v_scope_key, v_window_seconds, v_max_attempts in
    select limits.scope_key, limits.window_seconds, limits.max_attempts
    from (values
      ('global'::text, 60, 300),
      ('ip:' || p_ip_hash, 600, 30)
    ) as limits(scope_key, window_seconds, max_attempts)
    where limits.scope_key is not null
  loop
    v_window_started_at := to_timestamp(
      floor(extract(epoch from v_now) / v_window_seconds) * v_window_seconds
    );

    insert into public.public_registration_rate_limits as rate_limit (
      scope_key,
      window_started_at,
      attempts,
      expires_at,
      updated_at
    ) values (
      v_scope_key,
      v_window_started_at,
      1,
      v_window_started_at + make_interval(secs => v_window_seconds),
      v_now
    )
    on conflict (scope_key, window_started_at) do update
      set attempts = rate_limit.attempts + 1,
          updated_at = excluded.updated_at
    returning rate_limit.attempts into v_attempts;

    if v_attempts > v_max_attempts then
      v_allowed := false;
      v_retry_after := greatest(
        v_retry_after,
        ceil(extract(epoch from (
          v_window_started_at + make_interval(secs => v_window_seconds) - v_now
        )))::integer
      );
    end if;
  end loop;

  return query select v_allowed, greatest(v_retry_after, 0);
end;
$$;

revoke all on function public.consume_tournament_registration_network_rate_limits(text)
  from public, anon, authenticated;
grant execute on function public.consume_tournament_registration_network_rate_limits(text)
  to service_role;

create or replace function public.consume_tournament_registration_identity_rate_limit(
  p_identity_hash text
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_seconds integer := 1800;
  v_window_started_at timestamptz;
  v_attempts integer;
begin
  if coalesce(p_identity_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Identificador de limite inválido.';
  end if;

  v_window_started_at := to_timestamp(
    floor(extract(epoch from v_now) / v_window_seconds) * v_window_seconds
  );

  insert into public.public_registration_rate_limits as rate_limit (
    scope_key,
    window_started_at,
    attempts,
    expires_at,
    updated_at
  ) values (
    'identity:' || p_identity_hash,
    v_window_started_at,
    1,
    v_window_started_at + make_interval(secs => v_window_seconds),
    v_now
  )
  on conflict (scope_key, window_started_at) do update
    set attempts = rate_limit.attempts + 1,
        updated_at = excluded.updated_at
  returning rate_limit.attempts into v_attempts;

  return query
  select
    v_attempts <= 5,
    case
      when v_attempts <= 5 then 0
      else greatest(
        1,
        ceil(extract(epoch from (
          v_window_started_at + make_interval(secs => v_window_seconds) - v_now
        )))::integer
      )
    end;
end;
$$;

revoke all on function public.consume_tournament_registration_identity_rate_limit(text)
  from public, anon, authenticated;
grant execute on function public.consume_tournament_registration_identity_rate_limit(text)
  to service_role;

commit;
