begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- The single-column UNIQUE index guarantees the invitation state machine, but
-- the composite foreign key also needs a matching child-side access path for
-- parent updates/deletes and for the Supabase unindexed-FK advisor.
create index if not exists tournament_spatial_courtesy_invites_used_scope_idx
  on public.tournament_spatial_courtesy_invites(
    used_registration_id,
    tournament_id,
    athlete_id,
    target_category_id
  );

commit;
