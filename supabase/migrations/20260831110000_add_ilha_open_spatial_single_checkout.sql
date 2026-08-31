begin;

alter table public.tournament_registrations
  add column if not exists parent_registration_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tournament_registrations'::regclass
      and conname = 'tournament_registration_parent_fk'
  ) then
    alter table public.tournament_registrations
      add constraint tournament_registration_parent_fk
      foreign key (parent_registration_id, tournament_id)
      references public.tournament_registrations(id, tournament_id)
      on delete cascade;
  end if;
end
$$;

create index if not exists tournament_registrations_parent_idx
  on public.tournament_registrations(parent_registration_id)
  where parent_registration_id is not null;

with target_tournament as (
  select id
  from public.tournaments
  where lower(slug) = 'ilha-open-2026'
  limit 1
), spatial_rules(code, required_codes) as (
  values
    ('ESP-A-M', jsonb_build_array('M2', 'M3', 'M4')),
    ('ESP-B-M', jsonb_build_array('M5', 'M6', 'M7'))
)
update public.tournament_categories as category
set registration_fee = 80,
    settings = coalesce(category.settings, '{}'::jsonb) || jsonb_build_object(
      'registration_rule', jsonb_build_object(
        'requires_existing_codes', spatial.required_codes,
        'max_total_registrations', 2
      )
    ),
    updated_at = now()
from target_tournament as tournament,
     spatial_rules as spatial
where category.tournament_id = tournament.id
  and category.code = spatial.code;

update public.tournaments
set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
      'registration_limits', jsonb_build_object(
        'default_max_categories_per_athlete', 1,
        'special_rule', '2ª, 3ª e 4ª Masculina podem adicionar a Espacial A; 5ª, 6ª e 7ª Masculina podem adicionar a Espacial B.'
      ),
      'spatial_addons', jsonb_build_object(
        'M2', jsonb_build_object('category_code', 'ESP-A-M', 'label', 'Espacial A', 'fee', 80),
        'M3', jsonb_build_object('category_code', 'ESP-A-M', 'label', 'Espacial A', 'fee', 80),
        'M4', jsonb_build_object('category_code', 'ESP-A-M', 'label', 'Espacial A', 'fee', 80),
        'M5', jsonb_build_object('category_code', 'ESP-B-M', 'label', 'Espacial B', 'fee', 80),
        'M6', jsonb_build_object('category_code', 'ESP-B-M', 'label', 'Espacial B', 'fee', 80),
        'M7', jsonb_build_object('category_code', 'ESP-B-M', 'label', 'Espacial B', 'fee', 80)
      )
    ),
    updated_at = now()
where lower(slug) = 'ilha-open-2026';

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
  additional_occupied integer := 0;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
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
    select claimed.*
      into primary_registration
    from public.tournament_claim_public_registration(
      p_tournament_id,
      p_primary_category_id,
      p_athlete_id,
      p_public_name,
      p_public_city,
      p_public_club,
      p_partner_name,
      p_shirt_size,
      p_primary_amount,
      p_notes
    ) as claimed;
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
        public_name, public_city, public_club, partner_name, shirt_size,
        status, payment_status, total_amount, source, published, notes,
        terms_accepted_at, confirmed_at
      ) values (
        p_tournament_id, p_additional_category_id, p_athlete_id, primary_registration.id,
        trim(p_public_name), nullif(trim(p_public_city), ''), nullif(trim(p_public_club), ''),
        null, null,
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

create or replace function public.sync_tournament_registration_payment_group(
  p_primary_registration_id uuid,
  p_registration_status text default null,
  p_payment_status text default null,
  p_paid_amount numeric default null,
  p_confirmed_at timestamptz default null,
  p_cancelled_at timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  group_total numeric;
  updated_count integer;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;
  if p_registration_status is not null
     and p_registration_status not in ('PENDING', 'CONFIRMED', 'WAITLIST', 'CANCELLED', 'REFUNDED') then
    raise exception using errcode = '22023', message = 'Status de inscrição inválido.';
  end if;
  if p_payment_status is not null
     and p_payment_status not in ('NOT_REQUIRED', 'PENDING', 'PAID', 'OVERDUE', 'REFUNDED', 'CANCELLED') then
    raise exception using errcode = '22023', message = 'Status de pagamento inválido.';
  end if;
  if p_paid_amount is not null and p_paid_amount < 0 then
    raise exception using errcode = '22023', message = 'Valor pago inválido.';
  end if;

  select coalesce(sum(registration.total_amount), 0)
    into group_total
  from public.tournament_registrations as registration
  where registration.id = p_primary_registration_id
     or registration.parent_registration_id = p_primary_registration_id;

  if not exists (
    select 1 from public.tournament_registrations
    where id = p_primary_registration_id and parent_registration_id is null
  ) then
    raise exception using errcode = 'P0002', message = 'Inscrição principal não encontrada.';
  end if;

  update public.tournament_registrations as registration
  set status = coalesce(p_registration_status, registration.status),
      payment_status = coalesce(p_payment_status, registration.payment_status),
      paid_amount = case
        when p_paid_amount is null then registration.paid_amount
        when group_total <= 0 then 0
        else round(least(registration.total_amount, p_paid_amount * registration.total_amount / group_total), 2)
      end,
      confirmed_at = case
        when p_registration_status = 'CONFIRMED' then coalesce(p_confirmed_at, now())
        when p_registration_status in ('PENDING', 'CANCELLED', 'REFUNDED') then null
        else registration.confirmed_at
      end,
      cancelled_at = case
        when p_registration_status = 'CANCELLED' then coalesce(p_cancelled_at, now())
        when p_registration_status in ('PENDING', 'CONFIRMED') then null
        else registration.cancelled_at
      end,
      updated_at = now()
  where registration.id = p_primary_registration_id
     or registration.parent_registration_id = p_primary_registration_id;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.sync_tournament_registration_payment_group(
  uuid, text, text, numeric, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.sync_tournament_registration_payment_group(
  uuid, text, text, numeric, timestamptz, timestamptz
) to service_role;

commit;
