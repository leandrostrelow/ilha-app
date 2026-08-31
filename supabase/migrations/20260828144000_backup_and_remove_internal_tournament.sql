create table if not exists private.tournament_deletion_backups (
  id bigint generated always as identity primary key,
  tournament_id uuid not null,
  tournament_slug text not null,
  tournament_name text not null,
  reason text not null,
  snapshot jsonb not null,
  backed_up_at timestamptz not null default now(),
  unique (tournament_id)
);

revoke all on table private.tournament_deletion_backups from public, anon, authenticated;

do $$
declare
  target public.tournaments%rowtype;
  target_count integer;
begin
  select count(*) into target_count
  from public.tournaments
  where slug = 'ilha-open-interno-2026';

  if target_count = 0 then
    return;
  end if;

  if target_count <> 1 then
    raise exception 'Esperado exatamente um torneio interno; encontrados %.', target_count;
  end if;

  select * into strict target
  from public.tournaments
  where slug = 'ilha-open-interno-2026';

  if target.slug = 'ilha-open-2026' or target.name = 'Ilha Open 2026' then
    raise exception 'Proteção acionada: o Ilha Open principal não pode ser removido.';
  end if;

  insert into private.tournament_deletion_backups (
    tournament_id,
    tournament_slug,
    tournament_name,
    reason,
    snapshot
  ) values (
    target.id,
    target.slug,
    target.name,
    'Torneio interno removido por solicitação administrativa; foco mantido no Ilha Open principal.',
    jsonb_build_object(
      'tournament', to_jsonb(target),
      'categories', coalesce((select jsonb_agg(to_jsonb(row_data)) from public.tournament_categories row_data where row_data.tournament_id = target.id), '[]'::jsonb),
      'registrations', coalesce((select jsonb_agg(to_jsonb(row_data)) from public.tournament_registrations row_data where row_data.tournament_id = target.id), '[]'::jsonb),
      'registration_orders', coalesce((select jsonb_agg(to_jsonb(row_data)) from public.tournament_registration_orders row_data where row_data.tournament_id = target.id), '[]'::jsonb),
      'payments', coalesce((select jsonb_agg(to_jsonb(row_data)) from public.tournament_payments row_data where row_data.tournament_id = target.id), '[]'::jsonb),
      'courts', coalesce((select jsonb_agg(to_jsonb(row_data)) from public.tournament_courts row_data where row_data.tournament_id = target.id), '[]'::jsonb),
      'matches', coalesce((select jsonb_agg(to_jsonb(row_data)) from public.tournament_matches row_data where row_data.tournament_id = target.id), '[]'::jsonb),
      'match_sets', coalesce((
        select jsonb_agg(to_jsonb(row_data))
        from public.tournament_match_sets row_data
        join public.tournament_matches tournament_match on tournament_match.id = row_data.match_id
        where tournament_match.tournament_id = target.id
      ), '[]'::jsonb),
      'schedule_events', coalesce((select jsonb_agg(to_jsonb(row_data)) from public.tournament_schedule_events row_data where row_data.tournament_id = target.id), '[]'::jsonb),
      'sponsors', coalesce((select jsonb_agg(to_jsonb(row_data)) from public.tournament_sponsors row_data where row_data.tournament_id = target.id), '[]'::jsonb),
      'live_state', coalesce((select jsonb_agg(to_jsonb(row_data)) from public.tournament_live_state row_data where row_data.tournament_id = target.id), '[]'::jsonb),
      'audit_log', coalesce((select jsonb_agg(to_jsonb(row_data)) from public.tournament_audit_log row_data where row_data.tournament_id = target.id), '[]'::jsonb)
    )
  )
  on conflict (tournament_id) do nothing;

  if not exists (
    select 1 from private.tournament_deletion_backups
    where tournament_id = target.id and snapshot -> 'tournament' ->> 'slug' = target.slug
  ) then
    raise exception 'O backup privado do torneio interno não foi confirmado.';
  end if;

  delete from public.tournaments where id = target.id;

  if exists (select 1 from public.tournaments where id = target.id) then
    raise exception 'O torneio interno ainda existe após a exclusão.';
  end if;

  if not exists (select 1 from public.tournaments where slug = 'ilha-open-2026') then
    raise exception 'Proteção acionada: o Ilha Open principal precisa permanecer disponível.';
  end if;
end
$$;
