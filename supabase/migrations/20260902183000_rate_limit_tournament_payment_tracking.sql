begin;

-- Payment tracking is a public capability URL backed by an unguessable token.
-- Keep both the token and the caller IP out of storage by persisting only
-- server-side HMACs, and give status polling a larger budget than an explicit
-- provider retry.
alter table public.public_registration_rate_limits
  drop constraint if exists public_registration_rate_limits_scope_key_check;
alter table public.public_registration_rate_limits
  add constraint public_registration_rate_limits_scope_key_check
  check (
    scope_key ~ '^(global|ip:[a-f0-9]{64}|identity:[a-f0-9]{64}|tracking-token:[a-f0-9]{64}|tracking-ip:[a-f0-9]{64})$'
  );

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
  v_allowed boolean := true;
  v_retry_after integer := 0;
  v_scope_key text;
  v_window_seconds integer;
  v_max_attempts integer;
  v_window_started_at timestamptz;
  v_attempts integer;
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

  for v_scope_key, v_window_seconds, v_max_attempts in
    select limits.scope_key, limits.window_seconds, limits.max_attempts
    from (values
      (
        'tracking-token:' || p_tracking_hash,
        case when v_action = 'payment_status' then 60 else 600 end,
        case when v_action = 'payment_status' then 30 else 5 end
      ),
      (
        case when p_ip_hash is null then null else 'tracking-ip:' || p_ip_hash end,
        case when v_action = 'payment_status' then 60 else 600 end,
        case when v_action = 'payment_status' then 180 else 20 end
      )
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

revoke all on function public.consume_tournament_payment_tracking_rate_limits(text, text, text)
  from public, anon, authenticated;
grant execute on function public.consume_tournament_payment_tracking_rate_limits(text, text, text)
  to service_role;

commit;
