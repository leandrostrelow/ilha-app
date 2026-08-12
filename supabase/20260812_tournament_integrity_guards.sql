-- Keep tournament-scoped references inside the same tournament.
-- This migration is idempotent because production may already have part of the
-- constraints created by a previous deploy.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tournament_registrations'::regclass
      and contype = 'u'
      and conkey = array[
        (select attnum from pg_attribute where attrelid = 'public.tournament_registrations'::regclass and attname = 'id'),
        (select attnum from pg_attribute where attrelid = 'public.tournament_registrations'::regclass and attname = 'tournament_id')
      ]::smallint[]
  ) then
    alter table public.tournament_registrations
      add constraint tournament_registrations_id_tournament_uq unique (id, tournament_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tournament_matches'::regclass
      and contype = 'u'
      and conkey = array[
        (select attnum from pg_attribute where attrelid = 'public.tournament_matches'::regclass and attname = 'id'),
        (select attnum from pg_attribute where attrelid = 'public.tournament_matches'::regclass and attname = 'tournament_id')
      ]::smallint[]
  ) then
    alter table public.tournament_matches
      add constraint tournament_matches_id_tournament_uq unique (id, tournament_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tournament_payments'::regclass
      and conname = 'tournament_payment_registration_scope_fk'
  ) then
    alter table public.tournament_payments
      add constraint tournament_payment_registration_scope_fk
      foreign key (registration_id, tournament_id)
      references public.tournament_registrations(id, tournament_id)
      on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tournament_live_state'::regclass
      and conname = 'tournament_live_match_scope_fk'
  ) then
    alter table public.tournament_live_state
      add constraint tournament_live_match_scope_fk
      foreign key (match_id, tournament_id)
      references public.tournament_matches(id, tournament_id)
      on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tournament_live_state'::regclass
      and conname = 'tournament_live_category_scope_fk'
  ) then
    alter table public.tournament_live_state
      add constraint tournament_live_category_scope_fk
      foreign key (category_id, tournament_id)
      references public.tournament_categories(id, tournament_id)
      on delete cascade;
  end if;
end $$;
