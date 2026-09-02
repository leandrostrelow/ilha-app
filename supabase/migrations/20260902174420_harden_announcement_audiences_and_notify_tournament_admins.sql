begin;

-- Missing audience data must fail closed. A general announcement remains
-- available by explicitly storing target_type = 'todos'.
alter table public.app_announcements
  alter column target_type drop default;

alter table public.app_announcements
  drop constraint if exists app_announcements_target_type_check;
alter table public.app_announcements
  add constraint app_announcements_target_type_check
  check (target_type in ('todos', 'aluno', 'mensalista', 'avulso', 'plano'));

alter table public.app_announcements
  drop constraint if exists app_announcements_target_plan_required_check;
alter table public.app_announcements
  add constraint app_announcements_target_plan_required_check
  check (
    target_type <> 'plano'
    or nullif(btrim(coalesce(target_plan_code, '')), '') is not null
  );

-- Audience selection is an authorization boundary, not merely a presentation
-- filter in Ilha Play. Staff with the announcements permission can still
-- manage every row, while clients only receive active rows matching their own
-- server-managed plan/profile classification.
drop policy if exists "announcements read active or staff"
  on public.app_announcements;
drop policy if exists "announcements read active or permitted staff"
  on public.app_announcements;
create policy "announcements read own audience or permitted staff"
on public.app_announcements for select to authenticated
using (
  (select public.has_club_permission('announcements'))
  or (
    active is true
    and exists (
      select 1
      from public.app_clients as client
      where client.id = (select auth.uid())
        and upper(coalesce(client.status, '')) = 'ATIVO'
        and client.registration_completed_at is not null
        and (
          target_type = 'todos'
          or (
            target_type = 'plano'
            and nullif(btrim(coalesce(target_plan_code, '')), '') is not null
            and lower(coalesce(client.official_plan_code, '')) =
              lower(btrim(target_plan_code))
          )
          or (
            target_type = 'aluno'
            and (
              coalesce(client.weekly_lessons, 0) > 0
              or lower(coalesce(client.official_plan_code, '')) like 'aulas\_%' escape '\'
            )
          )
          or (
            target_type = 'mensalista'
            and coalesce(client.weekly_lessons, 0) <= 0
            and lower(coalesce(client.official_plan_code, '')) not like 'aulas\_%' escape '\'
            and (
              lower(coalesce(client.client_type, '')) = 'mensalista'
              or lower(coalesce(client.official_plan_code, '')) like '%jogar%'
            )
          )
          or (
            target_type = 'avulso'
            and lower(coalesce(client.client_type, '')) = 'avulso'
          )
        )
    )
  )
);

-- Keep the in-app and Push audiences identical. The function rejects a bulk
-- request without an explicit audience; a direct single-recipient delivery can
-- still omit it because p_user_id is itself the audience capability.
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
security definer
set search_path = ''
as $$
declare
  normalized_target_type text := lower(trim(coalesce(p_target_type, '')));
  normalized_target_plan_code text := trim(coalesce(p_target_plan_code, ''));
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;

  if p_user_id is null
     and normalized_target_type not in ('todos', 'plano', 'aluno', 'mensalista', 'avulso') then
    raise exception 'Público da notificação inválido.' using errcode = '22023';
  end if;

  if p_user_id is null
     and normalized_target_type = 'plano'
     and normalized_target_plan_code = '' then
    raise exception 'Escolha o plano da notificação.' using errcode = '22023';
  end if;

  if nullif(trim(coalesce(p_tag, '')), '') is null then
    raise exception 'Identificador da notificação inválido.' using errcode = '22023';
  end if;

  return query
  with targeted as materialized (
    select client.id
    from public.app_clients as client
    join auth.users as auth_user on auth_user.id = client.id
    where upper(coalesce(client.status, '')) = 'ATIVO'
      and client.registration_completed_at is not null
      and (
        (p_user_id is not null and client.id = p_user_id)
        or (
          p_user_id is null
          and (
            normalized_target_type = 'todos'
            or (
              normalized_target_type = 'plano'
              and lower(coalesce(client.official_plan_code, '')) =
                lower(normalized_target_plan_code)
            )
            or (
              normalized_target_type = 'aluno'
              and (
                coalesce(client.weekly_lessons, 0) > 0
                or lower(coalesce(client.official_plan_code, '')) like 'aulas\_%' escape '\'
              )
            )
            or (
              normalized_target_type = 'mensalista'
              and coalesce(client.weekly_lessons, 0) <= 0
              and lower(coalesce(client.official_plan_code, '')) not like 'aulas\_%' escape '\'
              and (
                lower(coalesce(client.client_type, '')) = 'mensalista'
                or lower(coalesce(client.official_plan_code, '')) like '%jogar%'
              )
            )
            or (
              normalized_target_type = 'avulso'
              and lower(coalesce(client.client_type, '')) = 'avulso'
            )
          )
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
      where subscription.enabled is true
        and subscription.app_surface = 'ILHA_PLAY'
    );
end;
$$;

alter function public.enqueue_app_client_broadcast(
  text, text, text, text, text, text, text, uuid
) owner to postgres;
revoke all on function public.enqueue_app_client_broadcast(
  text, text, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.enqueue_app_client_broadcast(
  text, text, text, text, text, text, text, uuid
) to service_role;

-- Tournament registrations are independent from Ilha Play client accounts.
-- Send one minimal event per checkout to trusted staff who can manage
-- tournaments. No athlete name, CPF, e-mail, phone or payment payload is copied
-- into the notification.
create or replace function public.notify_club_admins_about_tournament_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tournament_name text;
  notification_scope text;
begin
  if new.parent_registration_id is not null then
    return new;
  end if;

  select tournament.name
    into tournament_name
  from public.tournaments as tournament
  where tournament.id = new.tournament_id;

  if tournament_name is null then
    return new;
  end if;

  notification_scope := coalesce(new.registration_group_id::text, new.id::text);

  insert into public.app_client_notifications (
    user_id,
    title,
    body,
    link_url,
    event_type,
    dedupe_key
  )
  select
    profile.id,
    'Nova inscrição no torneio',
    'Uma nova inscrição foi recebida no ' || left(tournament_name, 120) ||
      '. Abra o torneio para conferir.',
    '/adm',
    'TORNEIO_INSCRICAO',
    'tournament-registration:' || notification_scope || ':adm:' || profile.id::text
  from public.profiles as profile
  join auth.users as auth_user
    on auth_user.id = profile.id
  join public.protected_access_accounts as protected_account
    on protected_account.email = lower(trim(auth_user.email))
   and protected_account.role = profile.role
   and protected_account.active is true
  where profile.active is true
    and (
      profile.role = 'admin'
      or (
        coalesce(profile.permissions, '[]'::jsonb) ? 'tournaments'
        and coalesce(protected_account.permissions, '[]'::jsonb) ? 'tournaments'
      )
    )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  return new;
end;
$$;

revoke all on function public.notify_club_admins_about_tournament_registration()
  from public, anon, authenticated, service_role;

drop trigger if exists notify_club_admins_about_tournament_registration
  on public.tournament_registrations;
create trigger notify_club_admins_about_tournament_registration
after insert on public.tournament_registrations
for each row execute function public.notify_club_admins_about_tournament_registration();

commit;
