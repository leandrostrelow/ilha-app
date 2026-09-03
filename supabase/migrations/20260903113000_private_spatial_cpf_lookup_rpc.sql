begin;

-- Keep sensitive CPF values out of PostgREST query strings and access logs.
-- The Edge Function calls this RPC with a POST body and receives only the
-- athlete identifiers needed to continue the already-authorized lookup.
create or replace function public.lookup_private_tournament_spatial_addon_athlete_ids(
  p_tournament_id uuid,
  p_cpf text
)
returns table (athlete_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_cpf text := pg_catalog.regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;

  if p_tournament_id is null or normalized_cpf !~ '^[0-9]{11}$' then
    raise exception using errcode = '22023', message = 'Consulta de inscrição inválida.';
  end if;

  return query
  select matched.athlete_id
  from (
    -- Adult/direct registration: CPF belongs to the athlete.
    select athlete.id as athlete_id
    from public.tournament_athletes as athlete
    join public.tournament_registrations as registration
      on registration.athlete_id = athlete.id
     and registration.tournament_id = p_tournament_id
    where pg_catalog.regexp_replace(athlete.cpf, '[^0-9]', '', 'g') = normalized_cpf
      and athlete.active = true
      and athlete.status = 'ACTIVE'

    union

    -- Family registration: CPF belongs to the payer/responsible adult. The
    -- tournament scope prevents a payer CPF from exposing unrelated events.
    select registration.athlete_id
    from public.tournament_registration_groups as registration_group
    join public.tournament_registrations as registration
      on registration.registration_group_id = registration_group.id
     and registration.tournament_id = registration_group.tournament_id
    where registration_group.tournament_id = p_tournament_id
      and registration_group.payer_cpf = normalized_cpf
      and registration.athlete_id is not null
  ) as matched
  where matched.athlete_id is not null;
end;
$$;

revoke all on function public.lookup_private_tournament_spatial_addon_athlete_ids(uuid, text)
  from public, anon, authenticated;
grant execute on function public.lookup_private_tournament_spatial_addon_athlete_ids(uuid, text)
  to service_role;

commit;
