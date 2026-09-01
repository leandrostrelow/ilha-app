begin;

create index if not exists tournament_registration_groups_primary_registration_idx
  on public.tournament_registration_groups(primary_registration_id)
  where primary_registration_id is not null;

commit;
