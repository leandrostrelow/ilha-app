begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- A cortesia Espacial referencia a categoria da inscrição utilizada. Ao mover
-- a mesma inscrição entre Espacial A e B, mantenha o convite histórico
-- sincronizado em vez de bloquear o UPDATE da inscrição.
alter table public.tournament_spatial_courtesy_invites
  drop constraint if exists tournament_spatial_courtesy_invites_used_scope_fk;

alter table public.tournament_spatial_courtesy_invites
  add constraint tournament_spatial_courtesy_invites_used_scope_fk
  foreign key (used_registration_id, tournament_id, athlete_id, target_category_id)
  references public.tournament_registrations(id, tournament_id, athlete_id, category_id)
  on update cascade
  on delete restrict;

commit;
