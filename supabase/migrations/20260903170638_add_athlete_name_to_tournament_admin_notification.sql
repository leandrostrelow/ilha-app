begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Tournament notifications are visible only to protected ADM accounts with
-- tournament access. Include the athlete's public tournament name so the
-- team can identify the registration without copying CPF, phone, e-mail or
-- payment details into the notification stream.
create or replace function public.notify_club_admins_about_tournament_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tournament_name text;
  athlete_name text;
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

  athlete_name := left(
    trim(regexp_replace(coalesce(new.public_name, ''), '\s+', ' ', 'g')),
    120
  );
  if athlete_name = '' then
    athlete_name := 'Novo atleta';
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
    'Nova inscrição · ' || athlete_name,
    'Inscrição recebida no ' || left(tournament_name, 120) ||
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

alter function public.notify_club_admins_about_tournament_registration()
  owner to postgres;
revoke all on function public.notify_club_admins_about_tournament_registration()
  from public, anon, authenticated, service_role;

-- Enrich existing tournament notifications as well. The UUID stored in the
-- dedupe key is an internal registration/group reference; it is never shown
-- to the user and is resolved only inside this migration.
with notification_scopes as (
  select
    notification.id,
    split_part(notification.dedupe_key, ':', 2)::uuid as scope_id
  from public.app_client_notifications as notification
  where notification.event_type = 'TORNEIO_INSCRICAO'
    and notification.dedupe_key ~
      '^tournament-registration:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:adm:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
), resolved_notifications as (
  select
    notification_scope.id,
    left(trim(regexp_replace(registration.public_name, '\s+', ' ', 'g')), 120) as athlete_name,
    left(tournament.name, 120) as tournament_name
  from notification_scopes as notification_scope
  join lateral (
    select candidate.public_name, candidate.tournament_id
    from public.tournament_registrations as candidate
    where candidate.id = notification_scope.scope_id
       or (
         candidate.registration_group_id = notification_scope.scope_id
         and candidate.parent_registration_id is null
       )
    order by (candidate.id = notification_scope.scope_id) desc, candidate.created_at, candidate.id
    limit 1
  ) as registration on true
  join public.tournaments as tournament
    on tournament.id = registration.tournament_id
)
update public.app_client_notifications as notification
set
  title = 'Nova inscrição · ' || resolved.athlete_name,
  body = 'Inscrição recebida no ' || resolved.tournament_name ||
    '. Abra o torneio para conferir.'
from resolved_notifications as resolved
where notification.id = resolved.id;

commit;
