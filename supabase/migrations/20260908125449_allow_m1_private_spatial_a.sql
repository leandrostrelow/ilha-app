begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- The first-class exception belongs only to the private post-registration
-- portal. Keep settings.spatial_addons and the category's public
-- requires_existing_codes unchanged so neither public checkout path can offer
-- M1 -> ESP-A-M.
do $$
declare
  tournament_count integer;
  m1_count integer;
  spatial_a_count integer;
  tournament_settings jsonb;
begin
  select count(*)::integer
    into tournament_count
  from public.tournaments as tournament
  where lower(tournament.slug) = 'ilha-open-2026';

  if tournament_count <> 1 then
    raise exception 'Era esperado exatamente um torneio oficial ilha-open-2026.'
      using errcode = '55000';
  end if;

  select tournament.settings
    into tournament_settings
  from public.tournaments as tournament
  where lower(tournament.slug) = 'ilha-open-2026';

  if jsonb_typeof(coalesce(tournament_settings, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(tournament_settings -> 'spatial_addon_portal', '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(
       tournament_settings #> '{spatial_addon_portal,eligibility_overrides}',
       '{}'::jsonb
     )) <> 'object'
     or jsonb_typeof(coalesce(tournament_settings -> 'spatial_addons', '{}'::jsonb)) <> 'object' then
    raise exception 'As configurações da Classe Espacial não têm o formato esperado.'
      using errcode = '55000';
  end if;

  if tournament_settings #> '{spatial_addons,M1}' is not null then
    raise exception 'M1 já está configurada na oferta pública da Classe Espacial.'
      using errcode = '55000';
  end if;

  select count(*)::integer
    into m1_count
  from public.tournament_categories as category
  join public.tournaments as tournament on tournament.id = category.tournament_id
  where lower(tournament.slug) = 'ilha-open-2026'
    and category.code = 'M1'
    and category.active = true;

  select count(*)::integer
    into spatial_a_count
  from public.tournament_categories as category
  join public.tournaments as tournament on tournament.id = category.tournament_id
  where lower(tournament.slug) = 'ilha-open-2026'
    and category.code = 'ESP-A-M'
    and category.active = true;

  if m1_count <> 1 or spatial_a_count <> 1 then
    raise exception 'As categorias M1 e ESP-A-M ativas não correspondem ao torneio oficial.'
      using errcode = '55000';
  end if;
end;
$$;

update public.tournaments as tournament
set settings = jsonb_set(
      coalesce(tournament.settings, '{}'::jsonb),
      '{spatial_addon_portal}',
      coalesce(tournament.settings -> 'spatial_addon_portal', '{}'::jsonb)
        || jsonb_build_object(
          'eligibility_overrides',
          coalesce(
            tournament.settings #> '{spatial_addon_portal,eligibility_overrides}',
            '{}'::jsonb
          ) || jsonb_build_object(
            'M1',
            jsonb_build_object(
              'category_code', 'ESP-A-M',
              'label', 'Espacial A',
              'fee', 80
            )
          )
        ),
      true
    ),
    updated_at = now()
where lower(tournament.slug) = 'ilha-open-2026';

-- Upgrade only the reviewed private claim RPC. pg_get_functiondef preserves
-- subsequent security/payment fixes while these exact replacements fail
-- closed if the deployed function no longer has the expected shape.
do $$
declare
  function_oid regprocedure := to_regprocedure(
    'public.claim_private_tournament_spatial_addon_checkout(uuid,uuid,uuid,uuid,text,text)'
  );
  function_security_definer boolean;
  function_config text[];
  current_definition text;
  updated_definition text;
  public_rule_assignment text :=
    'addon_rule := tournament_row.settings -> ''spatial_addons'' -> primary_category.code;';
  private_rule_assignment text := E'addon_rule := coalesce(\n'
    || E'    tournament_row.settings -> ''spatial_addons'' -> primary_category.code,\n'
    || E'    (tournament_row.settings #> ''{spatial_addon_portal,eligibility_overrides}'')\n'
    || E'      -> primary_category.code\n'
    || E'  );';
  insert_anchor text := E'    insert into public.tournament_registrations (\n';
  guarded_insert text := E'    perform pg_catalog.set_config(\n'
    || E'      ''app.private_spatial_addon_claim'',\n'
    || E'      p_tournament_id::text || '':'' || p_athlete_id::text || '':'' || spatial_category.id::text,\n'
    || E'      true\n'
    || E'    );\n\n'
    || insert_anchor;
  returning_anchor text := E'    returning * into spatial_registration;\n';
  cleared_returning text := returning_anchor
    || E'    perform pg_catalog.set_config(''app.private_spatial_addon_claim'', '''', true);\n';
begin
  if function_oid is null then
    raise exception 'RPC privada de criação do adicional não encontrada.'
      using errcode = '55000';
  end if;

  select procedure.prosecdef, procedure.proconfig,
         pg_catalog.pg_get_functiondef(procedure.oid)
    into function_security_definer, function_config, current_definition
  from pg_catalog.pg_proc as procedure
  where procedure.oid = function_oid;

  if function_security_definer is distinct from true
     or not coalesce('search_path=""' = any(function_config), false)
     or current_definition not like '%auth.jwt() ->> ''role''%service_role%'
     or current_definition not like '%spatial_addon_portal,enabled%true%'
     or current_definition not like '%tournament.status in (''REGISTRATION_OPEN'', ''REGISTRATION_CLOSED'', ''IN_PROGRESS'')%'
     or current_definition like '%tournament.registration_open = true%'
     or current_definition like '%tournament.registration_opens_at is null%'
     or current_definition like '%tournament.registration_closes_at is null%'
     or current_definition not like '%pg_advisory_xact_lock%'
     or current_definition not like '%status in (''PENDING'', ''CONFIRMED'')%' then
    raise exception 'A proteção atual da RPC privada de criação está incompleta.'
      using errcode = '55000';
  end if;

  if pg_catalog.strpos(current_definition, public_rule_assignment) = 0
     or pg_catalog.strpos(current_definition, insert_anchor) = 0
     or pg_catalog.strpos(current_definition, returning_anchor) = 0
     or current_definition like '%app.private_spatial_addon_claim%'
     or current_definition like '%spatial_addon_portal,eligibility_overrides%' then
    raise exception 'A RPC privada de criação não corresponde à versão esperada.'
      using errcode = '55000';
  end if;

  updated_definition := replace(
    current_definition,
    public_rule_assignment,
    private_rule_assignment
  );
  updated_definition := replace(updated_definition, insert_anchor, guarded_insert);
  updated_definition := replace(updated_definition, returning_anchor, cleared_returning);

  if updated_definition = current_definition
     or updated_definition not like '%spatial_addon_portal,eligibility_overrides%'
     or updated_definition not like '%app.private_spatial_addon_claim%'
     or updated_definition not like '%set_config%'
     or updated_definition like '%' || public_rule_assignment || '%' then
    raise exception 'Não foi possível atualizar a RPC privada de criação com segurança.'
      using errcode = '55000';
  end if;

  execute updated_definition;
end;
$$;

alter function public.claim_private_tournament_spatial_addon_checkout(
  uuid, uuid, uuid, uuid, text, text
) owner to postgres;
revoke all on function public.claim_private_tournament_spatial_addon_checkout(
  uuid, uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.claim_private_tournament_spatial_addon_checkout(
  uuid, uuid, uuid, uuid, text, text
) to service_role;

-- Resume must validate the same private-only mapping as creation. It does not
-- need the insert capability marker because it only locks and returns an
-- existing standalone reservation.
do $$
declare
  function_oid regprocedure := to_regprocedure(
    'public.resume_private_tournament_spatial_addon_checkout(uuid,uuid,uuid,uuid,text)'
  );
  function_security_definer boolean;
  function_config text[];
  current_definition text;
  updated_definition text;
  public_rule_assignment text :=
    'addon_rule := tournament_row.settings -> ''spatial_addons'' -> primary_category.code;';
  private_rule_assignment text := E'addon_rule := coalesce(\n'
    || E'    tournament_row.settings -> ''spatial_addons'' -> primary_category.code,\n'
    || E'    (tournament_row.settings #> ''{spatial_addon_portal,eligibility_overrides}'')\n'
    || E'      -> primary_category.code\n'
    || E'  );';
begin
  if function_oid is null then
    raise exception 'RPC privada de retomada do adicional não encontrada.'
      using errcode = '55000';
  end if;

  select procedure.prosecdef, procedure.proconfig,
         pg_catalog.pg_get_functiondef(procedure.oid)
    into function_security_definer, function_config, current_definition
  from pg_catalog.pg_proc as procedure
  where procedure.oid = function_oid;

  if function_security_definer is distinct from true
     or not coalesce('search_path=""' = any(function_config), false)
     or current_definition not like '%auth.jwt() ->> ''role''%service_role%'
     or current_definition not like '%spatial_addon_portal,enabled%true%'
     or current_definition not like '%pg_advisory_xact_lock%'
     or current_definition not like '%tournament-spatial-addon:%'
     or current_definition not like '%payment_row.amount <> 80%' then
    raise exception 'A proteção atual da RPC privada de retomada está incompleta.'
      using errcode = '55000';
  end if;

  if pg_catalog.strpos(current_definition, public_rule_assignment) = 0
     or current_definition like '%spatial_addon_portal,eligibility_overrides%' then
    raise exception 'A RPC privada de retomada não corresponde à versão esperada.'
      using errcode = '55000';
  end if;

  updated_definition := replace(
    current_definition,
    public_rule_assignment,
    private_rule_assignment
  );

  if updated_definition = current_definition
     or updated_definition not like '%spatial_addon_portal,eligibility_overrides%'
     or updated_definition like '%' || public_rule_assignment || '%' then
    raise exception 'Não foi possível atualizar a RPC privada de retomada com segurança.'
      using errcode = '55000';
  end if;

  execute updated_definition;
end;
$$;

alter function public.resume_private_tournament_spatial_addon_checkout(
  uuid, uuid, uuid, uuid, text
) owner to postgres;
revoke all on function public.resume_private_tournament_spatial_addon_checkout(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.resume_private_tournament_spatial_addon_checkout(
  uuid, uuid, uuid, uuid, text
) to service_role;

-- The pre-existing public registration trigger is the second eligibility
-- guard. Permit M1 only when the service-role-only private claim RPC has set a
-- transaction-local, row-specific capability and all standalone R$ 80/paid
-- primary invariants are independently proven in the database.
create or replace function public.enforce_public_tournament_registration_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tournament_settings jsonb;
  category_settings jsonb;
  category_code text;
  required_codes jsonb;
  default_max integer;
  special_max integer;
  existing_count integer;
  private_claim_scope text;
  private_override_allowed boolean := false;
begin
  if new.source <> 'PUBLIC' then
    return new;
  end if;

  select tournament.settings, category.settings, category.code
    into tournament_settings, category_settings, category_code
  from public.tournaments as tournament
  join public.tournament_categories as category
    on category.tournament_id = tournament.id
   and category.id = new.category_id
  where tournament.id = new.tournament_id;

  if not found then
    return new;
  end if;

  if coalesce(tournament_settings #>> '{registration_limits,default_max_categories_per_athlete}', '') !~ '^[0-9]+$' then
    return new;
  end if;

  default_max := greatest(
    1,
    (tournament_settings #>> '{registration_limits,default_max_categories_per_athlete}')::integer
  );
  required_codes := category_settings #> '{registration_rule,requires_existing_codes}';
  special_max := case
    when coalesce(category_settings #>> '{registration_rule,max_total_registrations}', '') ~ '^[0-9]+$'
      then greatest(1, (category_settings #>> '{registration_rule,max_total_registrations}')::integer)
    else default_max
  end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.tournament_id::text || ':' || new.athlete_id::text, 20260831100000)
  );

  select count(*)::integer
    into existing_count
  from public.tournament_registrations as registration
  where registration.tournament_id = new.tournament_id
    and registration.athlete_id = new.athlete_id
    and registration.status in ('PENDING', 'CONFIRMED', 'WAITLIST');

  private_claim_scope := coalesce(
    pg_catalog.current_setting('app.private_spatial_addon_claim', true),
    ''
  );
  if private_claim_scope =
       new.tournament_id::text || ':' || new.athlete_id::text || ':' || new.category_id::text
     and new.status = 'PENDING'
     and new.payment_status = 'PENDING'
     and new.request_token is not null
     and new.parent_registration_id is null
     and new.registration_group_id is null
     and new.registration_order_id is null
     and new.total_amount = 80 then
    select exists (
      select 1
      from public.tournament_registrations as primary_registration
      join public.tournament_categories as primary_category
        on primary_category.id = primary_registration.category_id
       and primary_category.tournament_id = primary_registration.tournament_id
      where primary_registration.tournament_id = new.tournament_id
        and primary_registration.athlete_id = new.athlete_id
        and primary_registration.status = 'CONFIRMED'
        and primary_registration.payment_status in ('PAID', 'NOT_REQUIRED')
        and coalesce(
          (
            tournament_settings #> '{spatial_addon_portal,eligibility_overrides}'
          ) -> primary_category.code ->> 'category_code',
          ''
        ) = category_code
    ) into private_override_allowed;
  end if;

  if jsonb_typeof(required_codes) = 'array' and jsonb_array_length(required_codes) > 0 then
    if not private_override_allowed and not exists (
      select 1
      from public.tournament_registrations as registration
      join public.tournament_categories as existing_category
        on existing_category.id = registration.category_id
       and existing_category.tournament_id = registration.tournament_id
      where registration.tournament_id = new.tournament_id
        and registration.athlete_id = new.athlete_id
        and registration.status in ('PENDING', 'CONFIRMED', 'WAITLIST')
        and existing_category.code in (
          select jsonb_array_elements_text(required_codes)
        )
    ) then
      raise exception using
        errcode = 'P0001',
        message = case category_code
          when 'ESP-A-M' then 'A Espacial A é exclusiva para atletas inscritos na 2ª, 3ª ou 4ª Classe Masculina.'
          when 'ESP-B-M' then 'A Espacial B é exclusiva para atletas inscritos na 5ª, 6ª ou 7ª Classe Masculina.'
          else 'Esta Classe Espacial exige uma inscrição principal compatível.'
        end;
    end if;

    if existing_count >= special_max then
      raise exception using
        errcode = 'P0001',
        message = 'Este atleta já atingiu o limite de duas inscrições neste torneio.';
    end if;
  elsif existing_count >= default_max then
    raise exception using
      errcode = 'P0001',
      message = 'A segunda inscrição só é permitida na Espacial A para atletas da 2ª, 3ª e 4ª Classe Masculina ou na Espacial B para atletas da 5ª, 6ª e 7ª Classe Masculina.';
  end if;

  return new;
end;
$$;

alter function public.enforce_public_tournament_registration_limits()
  owner to postgres;
revoke all on function public.enforce_public_tournament_registration_limits()
  from public, anon, authenticated, service_role;

-- Fail closed if the new rule leaked into the public offer or if the snapshot
-- wrapper ever starts exposing the private portal subtree.
do $$
declare
  tournament_settings jsonb;
  wrapper_oid regprocedure := to_regprocedure('public.tournament_public_snapshot(text)');
  wrapper_security_definer boolean;
  wrapper_config text[];
  wrapper_definition text;
  public_snapshot jsonb;
begin
  select tournament.settings
    into strict tournament_settings
  from public.tournaments as tournament
  where lower(tournament.slug) = 'ilha-open-2026';

  if tournament_settings #>> '{spatial_addon_portal,eligibility_overrides,M1,category_code}' <> 'ESP-A-M'
     or tournament_settings #>> '{spatial_addon_portal,eligibility_overrides,M1,fee}' <> '80'
     or tournament_settings #> '{spatial_addons,M1}' is not null then
    raise exception 'A exceção privada M1 -> ESP-A-M não ficou isolada da oferta pública.'
      using errcode = '55000';
  end if;

  if wrapper_oid is null then
    raise exception 'A projeção pública protegida do torneio não foi encontrada.'
      using errcode = '55000';
  end if;

  select procedure.prosecdef, procedure.proconfig,
         pg_catalog.pg_get_functiondef(procedure.oid)
    into wrapper_security_definer, wrapper_config, wrapper_definition
  from pg_catalog.pg_proc as procedure
  where procedure.oid = wrapper_oid;

  if wrapper_security_definer is distinct from true
     or not coalesce('search_path=""' = any(wrapper_config), false)
     or lower(wrapper_definition) not like '%private.tournament_public_snapshot_legacy_unsafe(p_slug)%'
     or lower(wrapper_definition) not like '%public_settings := jsonb_strip_nulls%'
     or lower(wrapper_definition) like '%spatial_addon_portal%' then
    raise exception 'A allow-list da projeção pública expõe configuração privada.'
      using errcode = '55000';
  end if;

  public_snapshot := public.tournament_public_snapshot('ilha-open-2026');
  if coalesce(public_snapshot #> '{tournament,settings}' ? 'spatial_addon_portal', false) then
    raise exception 'O snapshot público expôs a configuração privada da Classe Espacial.'
      using errcode = '55000';
  end if;
end;
$$;

commit;
