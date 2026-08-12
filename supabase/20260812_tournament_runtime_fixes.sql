alter table public.tournament_live_state
  add column if not exists payload jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tournament_payments'::regclass
      and conname = 'tournament_payments_registration_id_key'
  ) then
    alter table public.tournament_payments
      add constraint tournament_payments_registration_id_key unique (registration_id);
  end if;
end
$$;
