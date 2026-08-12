-- Keep tournament RLS checks fast by avoiding an ALL policy that duplicates SELECT.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'tournaments', 'tournament_categories', 'tournament_athletes', 'tournament_registrations',
    'tournament_courts', 'tournament_matches', 'tournament_match_sets',
    'tournament_schedule_events', 'tournament_sponsors', 'tournament_live_state'
  ] loop
    execute format('drop policy if exists "tournament staff write" on public.%I', table_name);
    execute format('drop policy if exists "tournament staff insert" on public.%I', table_name);
    execute format('drop policy if exists "tournament staff update" on public.%I', table_name);
    execute format('drop policy if exists "tournament staff delete" on public.%I', table_name);
    execute format('create policy "tournament staff insert" on public.%I for insert to authenticated with check ((select public.has_tournament_permission(''tournaments.write'')))', table_name);
    execute format('create policy "tournament staff update" on public.%I for update to authenticated using ((select public.has_tournament_permission(''tournaments.write''))) with check ((select public.has_tournament_permission(''tournaments.write'')))', table_name);
    execute format('create policy "tournament staff delete" on public.%I for delete to authenticated using ((select public.has_tournament_permission(''tournaments.write'')))', table_name);
  end loop;
end
$$;

drop policy if exists "tournament finance write" on public.tournament_payments;
drop policy if exists "tournament finance insert" on public.tournament_payments;
drop policy if exists "tournament finance update" on public.tournament_payments;
drop policy if exists "tournament finance delete" on public.tournament_payments;
create policy "tournament finance insert" on public.tournament_payments for insert to authenticated with check ((select public.has_tournament_permission('tournaments.finance')));
create policy "tournament finance update" on public.tournament_payments for update to authenticated using ((select public.has_tournament_permission('tournaments.finance'))) with check ((select public.has_tournament_permission('tournaments.finance')));
create policy "tournament finance delete" on public.tournament_payments for delete to authenticated using ((select public.has_tournament_permission('tournaments.finance')));
