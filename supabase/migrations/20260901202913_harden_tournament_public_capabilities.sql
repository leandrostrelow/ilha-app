begin;

-- The reusable courtesy link was replaced by single-use invitations. Remove
-- the legacy capability from both storage locations so stale administrative
-- payloads cannot make it public again.
update public.tournaments
set settings = coalesce(settings, '{}'::jsonb) - 'courtesy_registration_token',
    updated_at = now()
where coalesce(settings, '{}'::jsonb) ? 'courtesy_registration_token';

alter table public.tournaments
  drop constraint if exists tournaments_settings_without_legacy_courtesy_check;
alter table public.tournaments
  add constraint tournaments_settings_without_legacy_courtesy_check
  check (not (coalesce(settings, '{}'::jsonb) ? 'courtesy_registration_token'))
  not valid;
alter table public.tournaments
  validate constraint tournaments_settings_without_legacy_courtesy_check;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournaments'
      and column_name = 'courtesy_registration_token'
  ) then
    execute $statement$
      update public.tournaments
      set courtesy_registration_token = null,
          updated_at = now()
      where courtesy_registration_token is not null
    $statement$;
  end if;
end;
$$;

alter table public.tournaments
  drop constraint if exists tournaments_without_legacy_courtesy_token_check;
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournaments'
      and column_name = 'courtesy_registration_token'
  ) then
    alter table public.tournaments
      add constraint tournaments_without_legacy_courtesy_token_check
      check (courtesy_registration_token is null)
      not valid;
    alter table public.tournaments
      validate constraint tournaments_without_legacy_courtesy_token_check;
  end if;
end;
$$;

-- Preserve the complete snapshot implementation behind a private, fully
-- revoked function. The public wrapper below only returns explicitly approved
-- presentation settings, so adding a new key to tournaments.settings never
-- makes it public by accident.
create schema if not exists private;

alter function public.tournament_public_snapshot(text)
  rename to tournament_public_snapshot_legacy_unsafe;
alter function public.tournament_public_snapshot_legacy_unsafe(text)
  set schema private;

revoke all on function private.tournament_public_snapshot_legacy_unsafe(text)
  from public, anon, authenticated, service_role;

create function public.tournament_public_snapshot(p_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  snapshot jsonb;
  stored_settings jsonb;
  stored_theme jsonb;
  public_settings jsonb;
  public_theme jsonb;
begin
  snapshot := private.tournament_public_snapshot_legacy_unsafe(p_slug);
  if snapshot is null or not (snapshot ? 'tournament') then
    return snapshot;
  end if;

  stored_settings := coalesce(snapshot #> '{tournament,settings}', '{}'::jsonb);
  -- registration_mode, registration_function and the legacy flat fee fields
  -- are deliberately omitted: their only consumer is the retired internal
  -- registration route, which is separately disabled by default.
  public_settings := jsonb_strip_nulls(jsonb_build_object(
    'public_tabs', stored_settings -> 'public_tabs',
    'about_event', stored_settings -> 'about_event',
    'registration_pricing', stored_settings -> 'registration_pricing',
    'spatial_addon_fee', stored_settings -> 'spatial_addon_fee',
    'spatial_addons', stored_settings -> 'spatial_addons',
    'spatial_event_period_label', stored_settings -> 'spatial_event_period_label'
  ));

  stored_theme := coalesce(snapshot #> '{tournament,theme}', '{}'::jsonb);
  public_theme := jsonb_strip_nulls(jsonb_build_object(
    'primary', stored_theme -> 'primary',
    'accent', stored_theme -> 'accent',
    'surface', stored_theme -> 'surface',
    'background', stored_theme -> 'background',
    'text', stored_theme -> 'text'
  ));

  snapshot := jsonb_set(
    snapshot,
    '{tournament}',
    coalesce(snapshot -> 'tournament', '{}'::jsonb) - 'courtesy_registration_token',
    true
  );
  snapshot := jsonb_set(snapshot, '{tournament,settings}', public_settings, true);
  snapshot := jsonb_set(snapshot, '{tournament,theme}', public_theme, true);
  return snapshot;
end;
$$;

alter function public.tournament_public_snapshot(text) owner to postgres;

comment on function public.tournament_public_snapshot(text) is
  'Public tournament projection with allow-listed settings and theme fields.';

revoke all on function public.tournament_public_snapshot(text)
  from public, anon, authenticated, service_role;
grant execute on function public.tournament_public_snapshot(text)
  to anon, authenticated, service_role;

-- Raw tournament relations are never part of the anonymous API. Authenticated
-- staff receive only the DML needed by the RLS policies; schema-changing and
-- trigger privileges are intentionally absent.
revoke all on table
  public.tournaments,
  public.tournament_categories,
  public.tournament_athletes,
  public.tournament_registrations,
  public.tournament_payments,
  public.asaas_webhook_events,
  public.tournament_courts,
  public.tournament_matches,
  public.tournament_match_sets,
  public.tournament_schedule_events,
  public.tournament_sponsors,
  public.tournament_live_state,
  public.tournament_audit_log,
  public.tournament_registration_orders,
  public.tournament_registration_groups,
  public.tournament_registration_invites,
  public.public_registration_rate_limits
from public, anon, authenticated, service_role;

grant select, insert, update, delete on table
  public.tournaments,
  public.tournament_categories,
  public.tournament_athletes,
  public.tournament_registrations,
  public.tournament_payments,
  public.tournament_courts,
  public.tournament_matches,
  public.tournament_match_sets,
  public.tournament_schedule_events,
  public.tournament_sponsors,
  public.tournament_live_state
to authenticated;

grant select, insert on table public.tournament_audit_log to authenticated;

grant select, insert, update, delete on table
  public.tournaments,
  public.tournament_categories,
  public.tournament_athletes,
  public.tournament_registrations,
  public.tournament_payments,
  public.asaas_webhook_events,
  public.tournament_courts,
  public.tournament_matches,
  public.tournament_match_sets,
  public.tournament_schedule_events,
  public.tournament_sponsors,
  public.tournament_live_state,
  public.tournament_registration_orders,
  public.tournament_registration_groups,
  public.tournament_registration_invites,
  public.public_registration_rate_limits
to service_role;

grant select, insert on table public.tournament_audit_log to service_role;

revoke all on sequence public.tournament_audit_log_id_seq
  from public, anon, authenticated, service_role;
grant usage on sequence public.tournament_audit_log_id_seq to authenticated;
grant usage, select on sequence public.tournament_audit_log_id_seq to service_role;

-- Foreign-key lookup indexes used by deletion checks, staff joins and payment
-- reconciliation. Partial indexes avoid indexing absent optional identities.
create index if not exists tournament_athletes_auth_user_id_idx
  on public.tournament_athletes(auth_user_id)
  where auth_user_id is not null;
create index if not exists tournament_athletes_app_client_id_idx
  on public.tournament_athletes(app_client_id)
  where app_client_id is not null;
create index if not exists tournament_athletes_created_by_idx
  on public.tournament_athletes(created_by)
  where created_by is not null;
create index if not exists tournament_athletes_updated_by_idx
  on public.tournament_athletes(updated_by)
  where updated_by is not null;
create index if not exists tournament_registrations_category_tournament_idx
  on public.tournament_registrations(category_id, tournament_id);
create index if not exists tournament_payments_tournament_status_idx
  on public.tournament_payments(tournament_id, status, created_at desc);
create index if not exists tournament_audit_log_tournament_created_idx
  on public.tournament_audit_log(tournament_id, created_at desc)
  where tournament_id is not null;
create index if not exists tournament_audit_log_actor_id_idx
  on public.tournament_audit_log(actor_id)
  where actor_id is not null;
create index if not exists tournament_registration_orders_athlete_id_idx
  on public.tournament_registration_orders(athlete_id);
create index if not exists tournament_registration_orders_app_client_id_idx
  on public.tournament_registration_orders(app_client_id)
  where app_client_id is not null;
create index if not exists tournament_registration_invites_created_by_idx
  on public.tournament_registration_invites(created_by)
  where created_by is not null;

commit;
