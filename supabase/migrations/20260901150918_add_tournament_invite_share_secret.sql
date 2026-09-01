begin;

alter table public.tournament_registration_invites
  add column if not exists token_ciphertext text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tournament_registration_invites_token_ciphertext_check'
      and conrelid = 'public.tournament_registration_invites'::regclass
  ) then
    alter table public.tournament_registration_invites
      add constraint tournament_registration_invites_token_ciphertext_check
      check (
        token_ciphertext is null
        or token_ciphertext ~ '^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{60,120}$'
      );
  end if;
end;
$$;

-- O segredo permanece inacessível pela Data API; somente a Edge Function
-- administrativa, já protegida pela allowlist, pode decifrá-lo sob demanda.
revoke all on table public.tournament_registration_invites from public, anon, authenticated;

commit;
