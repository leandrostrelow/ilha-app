begin;

alter table public.app_push_subscriptions
  add column if not exists app_surface text not null default 'ILHA_PLAY';

alter table public.app_push_subscriptions
  drop constraint if exists app_push_subscriptions_surface_check;
alter table public.app_push_subscriptions
  add constraint app_push_subscriptions_surface_check
  check (app_surface in ('ILHA_PLAY', 'ADM'));

create index if not exists app_push_subscriptions_user_surface_idx
  on public.app_push_subscriptions(user_id, app_surface, enabled);

create or replace function public.upsert_current_app_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth_key text,
  p_user_agent text default null
)
returns table (
  subscription_id uuid,
  owner_user_id uuid,
  enabled boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Faça login para ativar as notificações.' using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.app_clients as client
     where client.id = v_user_id
       and upper(coalesce(client.status, '')) = 'ATIVO'
       and client.registration_completed_at is not null
  ) then
    raise exception 'Seu acesso precisa estar ativo para receber notificações.' using errcode = '42501';
  end if;

  if p_endpoint is null
     or length(p_endpoint) > 4096
     or p_endpoint !~ '^https://[^[:space:]]+$' then
    raise exception 'Assinatura de notificações inválida.' using errcode = '22023';
  end if;

  if p_p256dh is null
     or length(p_p256dh) not between 32 and 512
     or p_p256dh !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Chave de notificações inválida.' using errcode = '22023';
  end if;

  if p_auth_key is null
     or length(p_auth_key) not between 8 and 256
     or p_auth_key !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Autenticação de notificações inválida.' using errcode = '22023';
  end if;

  return query
  insert into public.app_push_subscriptions as subscription (
    user_id,
    endpoint,
    p256dh,
    auth_key,
    user_agent,
    app_surface,
    enabled,
    updated_at
  ) values (
    v_user_id,
    p_endpoint,
    p_p256dh,
    p_auth_key,
    left(nullif(trim(coalesce(p_user_agent, '')), ''), 1000),
    'ILHA_PLAY',
    true,
    now()
  )
  on conflict (endpoint) do update
     set user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth_key = excluded.auth_key,
         user_agent = excluded.user_agent,
         app_surface = 'ILHA_PLAY',
         enabled = true,
         updated_at = now()
  returning subscription.id, subscription.user_id, subscription.enabled;
end;
$$;

revoke all on function public.upsert_current_app_push_subscription(text, text, text, text)
  from public, anon;
grant execute on function public.upsert_current_app_push_subscription(text, text, text, text)
  to authenticated;

create or replace function public.enqueue_app_client_broadcast(
  p_title text,
  p_body text,
  p_link_url text,
  p_event_type text,
  p_tag text,
  p_target_type text,
  p_target_plan_code text,
  p_user_id uuid
)
returns table (
  queued integer,
  recipients integer,
  push_enabled_recipients integer
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;

  return query
  with targeted as materialized (
    select client.id
    from public.app_clients as client
    join auth.users as auth_user on auth_user.id = client.id
    where
      (
        p_user_id is not null
        and client.id = p_user_id
      )
      or (
        p_user_id is null
        and client.status = 'ATIVO'
        and (
          p_target_type = 'todos'
          or (p_target_type = 'plano' and client.official_plan_code = p_target_plan_code)
          or (
            p_target_type = 'aluno'
            and (
              coalesce(client.weekly_lessons, 0) > 0
              or lower(coalesce(client.official_plan_code, '')) like 'aulas\_%' escape '\'
            )
          )
          or (
            p_target_type = 'mensalista'
            and (
              lower(coalesce(client.client_type, '')) = 'mensalista'
              or lower(coalesce(client.official_plan_code, '')) like '%jogar%'
            )
          )
          or (p_target_type = 'avulso' and lower(coalesce(client.client_type, '')) = 'avulso')
        )
      )
  ),
  inserted as (
    insert into public.app_client_notifications (
      user_id,
      title,
      body,
      link_url,
      event_type,
      dedupe_key
    )
    select
      targeted.id,
      left(p_title, 90),
      left(p_body, 280),
      left(p_link_url, 1000),
      left(p_event_type, 50),
      left('client-broadcast:' || p_tag || ':' || targeted.id::text, 500)
    from targeted
    on conflict (dedupe_key) where dedupe_key is not null do nothing
    returning user_id
  )
  select
    (select count(*)::integer from inserted),
    (select count(*)::integer from targeted),
    (
      select count(distinct subscription.user_id)::integer
      from public.app_push_subscriptions as subscription
      join targeted on targeted.id = subscription.user_id
      where subscription.enabled = true
        and subscription.app_surface = 'ILHA_PLAY'
    );
end;
$$;

revoke all on function public.enqueue_app_client_broadcast(
  text, text, text, text, text, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.enqueue_app_client_broadcast(
  text, text, text, text, text, text, text, uuid
) to service_role;

commit;
