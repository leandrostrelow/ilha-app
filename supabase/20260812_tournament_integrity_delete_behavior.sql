-- Live score is ephemeral. Deleting/regenerating its match or category should
-- discard the live row instead of blocking the administrative operation.

alter table public.tournament_live_state
  drop constraint if exists tournament_live_match_scope_fk;

alter table public.tournament_live_state
  add constraint tournament_live_match_scope_fk
  foreign key (match_id, tournament_id)
  references public.tournament_matches(id, tournament_id)
  on delete cascade;

alter table public.tournament_live_state
  drop constraint if exists tournament_live_category_scope_fk;

alter table public.tournament_live_state
  add constraint tournament_live_category_scope_fk
  foreign key (category_id, tournament_id)
  references public.tournament_categories(id, tournament_id)
  on delete cascade;
