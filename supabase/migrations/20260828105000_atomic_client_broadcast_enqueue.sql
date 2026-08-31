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
    );
end;
$$;

revoke all on function public.enqueue_app_client_broadcast(
  text, text, text, text, text, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.enqueue_app_client_broadcast(
  text, text, text, text, text, text, text, uuid
) to service_role;

comment on function public.enqueue_app_client_broadcast(
  text, text, text, text, text, text, text, uuid
) is 'Enfileira um comunicado em uma única operação atômica, restrita ao service_role.';
