begin;

create or replace function public.claim_public_tournament_registration_bundle(
  p_tournament_id uuid,
  p_primary_category_id uuid,
  p_additional_category_id uuid,
  p_athlete_id uuid,
  p_public_name text,
  p_public_city text default null,
  p_public_club text default null,
  p_partner_name text default null,
  p_shirt_size text default null,
  p_primary_amount numeric default 0,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tournament_row public.tournaments%rowtype;
  primary_category public.tournament_categories%rowtype;
  additional_category public.tournament_categories%rowtype;
  primary_registration public.tournament_registrations%rowtype;
  additional_registration public.tournament_registrations%rowtype;
  addon_rule jsonb;
  addon_fee numeric := 0;
  primary_occupied integer := 0;
  additional_occupied integer := 0;
  primary_status text := 'PENDING';
  primary_payment_status text := 'PENDING';
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;
  if length(trim(coalesce(p_public_name, ''))) < 2 then
    raise exception using errcode = '22023', message = 'Nome inválido.';
  end if;
  if greatest(coalesce(p_primary_amount, 0), 0) <> coalesce(p_primary_amount, 0) then
    raise exception using errcode = '22023', message = 'Valor inválido.';
  end if;

  select tournament.*
    into tournament_row
  from public.tournaments as tournament
  where tournament.id = p_tournament_id
    and tournament.is_published = true
    and tournament.status = 'REGISTRATION_OPEN'
    and tournament.registration_open = true
    and (tournament.registration_opens_at is null or tournament.registration_opens_at <= now())
    and (tournament.registration_closes_at is null or tournament.registration_closes_at >= now());
  if not found then
    raise exception using errcode = 'P0002', message = 'Torneio indisponível para inscrição.';
  end if;

  if not exists (
    select 1 from public.tournament_athletes as athlete
    where athlete.id = p_athlete_id and athlete.active = true
  ) then
    raise exception using errcode = 'P0002', message = 'Atleta inválido.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tournament_id::text || ':' || p_athlete_id::text, 20260831110000)
  );

  perform 1
  from public.tournament_categories as category
  where category.tournament_id = p_tournament_id
    and category.id in (p_primary_category_id, p_additional_category_id)
  order by category.id
  for update;

  select category.*
    into primary_category
  from public.tournament_categories as category
  where category.id = p_primary_category_id
    and category.tournament_id = p_tournament_id
    and category.active = true
    and category.registration_open = true;
  if not found then
    raise exception using errcode = 'P0002', message = 'Categoria principal indisponível para inscrição.';
  end if;
  if primary_category.settings #> '{registration_rule,requires_existing_codes}' is not null then
    raise exception using errcode = 'P0001', message = 'Escolha primeiro sua classe principal e use a opção de Classe Espacial.';
  end if;

  addon_rule := tournament_row.settings -> 'spatial_addons' -> primary_category.code;
  if p_additional_category_id is not null then
    if addon_rule is null or coalesce(addon_rule ->> 'category_code', '') = '' then
      raise exception using errcode = 'P0001', message = 'Esta classe não permite inscrição adicional na Classe Espacial.';
    end if;

    select category.*
      into additional_category
    from public.tournament_categories as category
    where category.id = p_additional_category_id
      and category.tournament_id = p_tournament_id
      and category.code = addon_rule ->> 'category_code'
      and category.active = true
      and category.registration_open = true;
    if not found then
      raise exception using errcode = 'P0001', message = 'A Classe Espacial selecionada não corresponde à sua classe principal.';
    end if;

    addon_fee := case
      when greatest(coalesce(p_primary_amount, 0), 0) = 0 then 0
      else coalesce((addon_rule ->> 'fee')::numeric, additional_category.registration_fee)
    end;
    if addon_fee < 0 then
      raise exception using errcode = '22023', message = 'Valor adicional inválido.';
    end if;

    select count(*)::integer
      into additional_occupied
    from public.tournament_registrations as registration
    where registration.category_id = additional_category.id
      and registration.status in ('PENDING', 'CONFIRMED');
    if additional_category.max_entries is not null
       and additional_occupied >= additional_category.max_entries then
      raise exception using errcode = 'P0001', message = 'A Classe Espacial selecionada atingiu o limite de vagas.';
    end if;
  end if;

  select registration.*
    into primary_registration
  from public.tournament_registrations as registration
  where registration.tournament_id = p_tournament_id
    and registration.category_id = p_primary_category_id
    and registration.athlete_id = p_athlete_id;

  if not found then
    if primary_category.max_entries is not null then
      select count(*)::integer
        into primary_occupied
      from public.tournament_registrations as registration
      where registration.category_id = primary_category.id
        and registration.status in ('PENDING', 'CONFIRMED');
      if primary_occupied >= primary_category.max_entries then
        primary_status := 'WAITLIST';
        primary_payment_status := 'NOT_REQUIRED';
      end if;
    end if;
    if greatest(coalesce(p_primary_amount, 0), 0) = 0 and primary_status <> 'WAITLIST' then
      primary_status := 'CONFIRMED';
      primary_payment_status := 'NOT_REQUIRED';
    end if;

    insert into public.tournament_registrations (
      tournament_id, category_id, athlete_id, public_name, public_city, public_club,
      partner_name, shirt_size, status, payment_status, total_amount, source,
      published, notes, terms_accepted_at, confirmed_at
    ) values (
      p_tournament_id, p_primary_category_id, p_athlete_id, trim(p_public_name),
      nullif(trim(p_public_city), ''), nullif(trim(p_public_club), ''),
      nullif(trim(p_partner_name), ''), nullif(trim(p_shirt_size), ''),
      primary_status, primary_payment_status, greatest(coalesce(p_primary_amount, 0), 0),
      'PUBLIC', true, nullif(trim(p_notes), ''), now(),
      case when primary_status = 'CONFIRMED' then now() else null end
    )
    returning * into primary_registration;
  end if;

  if primary_registration.status <> 'WAITLIST' and p_additional_category_id is not null then
    select registration.*
      into additional_registration
    from public.tournament_registrations as registration
    where registration.tournament_id = p_tournament_id
      and registration.category_id = p_additional_category_id
      and registration.athlete_id = p_athlete_id;

    if not found then
      insert into public.tournament_registrations (
        tournament_id, category_id, athlete_id, parent_registration_id,
        public_name, public_city, public_club, status, payment_status,
        total_amount, source, published, notes, terms_accepted_at, confirmed_at
      ) values (
        p_tournament_id, p_additional_category_id, p_athlete_id, primary_registration.id,
        trim(p_public_name), nullif(trim(p_public_city), ''), nullif(trim(p_public_club), ''),
        case when addon_fee = 0 then 'CONFIRMED' else 'PENDING' end,
        case when addon_fee = 0 then 'NOT_REQUIRED' else 'PENDING' end,
        addon_fee, 'PUBLIC', true,
        'Inscrição adicional vinculada à classe principal. ' || coalesce(p_notes, ''),
        now(), case when addon_fee = 0 then now() else null end
      )
      returning * into additional_registration;
    end if;
  end if;

  return jsonb_build_object(
    'registration', to_jsonb(primary_registration),
    'additional_registration', case
      when additional_registration.id is null then null
      else to_jsonb(additional_registration)
    end,
    'total_amount', primary_registration.total_amount + coalesce(additional_registration.total_amount, 0)
  );
end;
$$;

revoke all on function public.claim_public_tournament_registration_bundle(
  uuid, uuid, uuid, uuid, text, text, text, text, text, numeric, text
) from public, anon, authenticated;
grant execute on function public.claim_public_tournament_registration_bundle(
  uuid, uuid, uuid, uuid, text, text, text, text, text, numeric, text
) to service_role;

commit;
