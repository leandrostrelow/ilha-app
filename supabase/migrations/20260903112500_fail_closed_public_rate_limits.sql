begin;

-- Reject an abusive IP before consuming the shared global bucket. A blocked
-- caller must not be able to exhaust the one-minute allowance for every other
-- athlete by continuing to send requests from the same network.
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
  v_window_started_at timestamptz;
  v_attempts integer;
  v_retry_after integer;
begin
  if p_ip_hash is not null and p_ip_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Identificador de limite inválido.';
  end if;

  delete from public.public_registration_rate_limits as rate_limit
  where rate_limit.expires_at < v_now - interval '1 day';

  if p_ip_hash is not null then
    v_window_started_at := to_timestamp(floor(extract(epoch from v_now) / 600) * 600);
    insert into public.public_registration_rate_limits as rate_limit (
      scope_key, window_started_at, attempts, expires_at, updated_at
    ) values (
      'ip:' || p_ip_hash,
      v_window_started_at,
      1,
      v_window_started_at + interval '10 minutes',
      v_now
    )
    on conflict (scope_key, window_started_at) do update
      set attempts = rate_limit.attempts + 1,
          updated_at = excluded.updated_at
    returning rate_limit.attempts into v_attempts;

    if v_attempts > 30 then
      v_retry_after := greatest(
        0,
        ceil(extract(epoch from (v_window_started_at + interval '10 minutes' - v_now)))::integer
      );
      return query select false, v_retry_after;
      return;
    end if;
  end if;

  v_window_started_at := to_timestamp(floor(extract(epoch from v_now) / 60) * 60);
  insert into public.public_registration_rate_limits as rate_limit (
    scope_key, window_started_at, attempts, expires_at, updated_at
  ) values (
    'global',
    v_window_started_at,
    1,
    v_window_started_at + interval '1 minute',
    v_now
  )
  on conflict (scope_key, window_started_at) do update
    set attempts = rate_limit.attempts + 1,
        updated_at = excluded.updated_at
  returning rate_limit.attempts into v_attempts;

  if v_attempts > 300 then
    v_retry_after := greatest(
      0,
      ceil(extract(epoch from (v_window_started_at + interval '1 minute' - v_now)))::integer
    );
    return query select false, v_retry_after;
    return;
  end if;

  return query select true, 0;
end;
$$;

revoke all on function public.consume_tournament_registration_network_rate_limits(text)
  from public, anon, authenticated;
grant execute on function public.consume_tournament_registration_network_rate_limits(text)
  to service_role;

-- Payment tracking uses an unguessable token, but an abusive IP must be
-- rejected before a token bucket is created. This prevents random UUIDs from
-- producing unbounded rate-limit rows after that network is already blocked.
create or replace function public.consume_tournament_payment_tracking_rate_limits(
  p_tracking_hash text,
  p_ip_hash text,
  p_action text
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_action text := lower(trim(coalesce(p_action, '')));
  v_window_seconds integer;
  v_ip_max_attempts integer;
  v_token_max_attempts integer;
  v_window_started_at timestamptz;
  v_attempts integer;
  v_retry_after integer;
begin
  if coalesce(p_tracking_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Identificador de acompanhamento inválido.';
  end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Identificador de rede inválido.';
  end if;
  if v_action not in ('payment_status', 'retry_payment') then
    raise exception using errcode = '22023', message = 'Ação de acompanhamento inválida.';
  end if;

  delete from public.public_registration_rate_limits as rate_limit
  where rate_limit.expires_at < v_now - interval '1 day';

  v_window_seconds := case when v_action = 'payment_status' then 60 else 600 end;
  v_ip_max_attempts := case when v_action = 'payment_status' then 180 else 20 end;
  v_token_max_attempts := case when v_action = 'payment_status' then 30 else 5 end;
  v_window_started_at := to_timestamp(
    floor(extract(epoch from v_now) / v_window_seconds) * v_window_seconds
  );

  if p_ip_hash is not null then
    insert into public.public_registration_rate_limits as rate_limit (
      scope_key, window_started_at, attempts, expires_at, updated_at
    ) values (
      'tracking-ip:' || p_ip_hash,
      v_window_started_at,
      1,
      v_window_started_at + make_interval(secs => v_window_seconds),
      v_now
    )
    on conflict (scope_key, window_started_at) do update
      set attempts = rate_limit.attempts + 1,
          updated_at = excluded.updated_at
    returning rate_limit.attempts into v_attempts;

    if v_attempts > v_ip_max_attempts then
      v_retry_after := greatest(
        0,
        ceil(extract(epoch from (
          v_window_started_at + make_interval(secs => v_window_seconds) - v_now
        )))::integer
      );
      return query select false, v_retry_after;
      return;
    end if;
  end if;

  insert into public.public_registration_rate_limits as rate_limit (
    scope_key, window_started_at, attempts, expires_at, updated_at
  ) values (
    'tracking-token:' || p_tracking_hash,
    v_window_started_at,
    1,
    v_window_started_at + make_interval(secs => v_window_seconds),
    v_now
  )
  on conflict (scope_key, window_started_at) do update
    set attempts = rate_limit.attempts + 1,
        updated_at = excluded.updated_at
  returning rate_limit.attempts into v_attempts;

  if v_attempts > v_token_max_attempts then
    v_retry_after := greatest(
      0,
      ceil(extract(epoch from (
        v_window_started_at + make_interval(secs => v_window_seconds) - v_now
      )))::integer
    );
    return query select false, v_retry_after;
    return;
  end if;

  return query select true, 0;
end;
$$;

revoke all on function public.consume_tournament_payment_tracking_rate_limits(text, text, text)
  from public, anon, authenticated;
grant execute on function public.consume_tournament_payment_tracking_rate_limits(text, text, text)
  to service_role;

commit;
