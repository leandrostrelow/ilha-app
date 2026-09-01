begin;

alter table public.tournament_registration_invites
  add column if not exists recipient_name text,
  add column if not exists recipient_phone text;

-- Convites anteriores continuam válidos e aparecem identificados no histórico.
update public.tournament_registration_invites
set recipient_name = 'Convite anterior'
where recipient_name is null or trim(recipient_name) = '';

alter table public.tournament_registration_invites
  alter column recipient_name set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tournament_registration_invites_recipient_name_check'
      and conrelid = 'public.tournament_registration_invites'::regclass
  ) then
    alter table public.tournament_registration_invites
      add constraint tournament_registration_invites_recipient_name_check
      check (length(trim(recipient_name)) between 2 and 120);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tournament_registration_invites_recipient_phone_check'
      and conrelid = 'public.tournament_registration_invites'::regclass
  ) then
    alter table public.tournament_registration_invites
      add constraint tournament_registration_invites_recipient_phone_check
      check (recipient_phone is null or recipient_phone ~ '^[0-9]{10,13}$');
  end if;
end;
$$;

-- A listagem administrativa filtra pelo torneio e já chega na ordem exibida.
create index if not exists tournament_registration_invites_tournament_created_idx
  on public.tournament_registration_invites(tournament_id, created_at desc);

commit;
