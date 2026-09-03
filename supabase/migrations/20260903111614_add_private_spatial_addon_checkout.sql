begin;

-- The private portal token is delivered in the URL fragment, so the raw
-- capability never reaches Vercel/Supabase access logs. Only its SHA-256 hash
-- is persisted. The Edge Function validates it before any CPF lookup.
update public.tournaments
set settings = jsonb_set(
      coalesce(settings, '{}'::jsonb),
      '{spatial_addon_portal}',
      jsonb_build_object(
        'enabled', true,
        'token_hash', 'a4b106f82d420e5689ff7a55dca652a23637067a2929f0db716c2d605f4e0004'
      ),
      true
    ),
    updated_at = now()
where lower(slug) = 'ilha-open-2026';

do $$
begin
  if not exists (
    select 1
    from public.tournaments as tournament
    where lower(tournament.slug) = 'ilha-open-2026'
      and tournament.settings #>> '{spatial_addon_portal,token_hash}' =
        'a4b106f82d420e5689ff7a55dca652a23637067a2929f0db716c2d605f4e0004'
  ) then
    raise exception 'O torneio oficial não foi encontrado para configurar o portal privado da Classe Espacial.';
  end if;
end;
$$;

-- CPF lookup is private, rate-limited and scoped to one tournament. Keep it
-- index-backed so abusive misses cannot force a scan of every family group.
create index if not exists tournament_registration_groups_tournament_payer_cpf_idx
  on public.tournament_registration_groups(tournament_id, payer_cpf);

create or replace function public.claim_private_tournament_spatial_addon_checkout(
  p_tournament_id uuid,
  p_request_token uuid,
  p_athlete_id uuid,
  p_primary_registration_id uuid,
  p_billing_type text default 'PIX',
  p_provider_environment text default 'UNKNOWN'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tournament_row public.tournaments%rowtype;
  athlete_row public.tournament_athletes%rowtype;
  primary_registration public.tournament_registrations%rowtype;
  primary_category public.tournament_categories%rowtype;
  spatial_category public.tournament_categories%rowtype;
  spatial_registration public.tournament_registrations%rowtype;
  payment_row public.tournament_payments%rowtype;
  addon_rule jsonb;
  addon_fee numeric;
  existing_spatial_registration_id uuid;
  matched_request_token boolean := false;
  occupied integer := 0;
  payment_created boolean := false;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;
  if p_tournament_id is null
     or p_request_token is null
     or p_athlete_id is null
     or p_primary_registration_id is null then
    raise exception using errcode = '22023', message = 'Tentativa de adicional inválida.';
  end if;
  if p_provider_environment not in ('SANDBOX', 'PRODUCTION') then
    raise exception using errcode = '22023', message = 'Ambiente do provedor inválido.';
  end if;
  if upper(coalesce(p_billing_type, '')) <> 'PIX' then
    raise exception using errcode = '22023', message = 'Forma de pagamento inválida.';
  end if;

  -- Serialize both idempotent retries and competing attempts for the same
  -- athlete. The public-registration trigger independently enforces the same
  -- athlete/category limit as a second line of defense.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_token::text, 20260903111614)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tournament_id::text || ':' || p_athlete_id::text, 20260831100000)
  );

  select tournament.*
    into tournament_row
  from public.tournaments as tournament
  where tournament.id = p_tournament_id
    and tournament.is_published = true
    and tournament.status = 'REGISTRATION_OPEN'
    and tournament.registration_open = true
    and lower(coalesce(tournament.settings #>> '{spatial_addon_portal,enabled}', 'false')) = 'true'
    and (tournament.registration_opens_at is null or tournament.registration_opens_at <= now())
    and (tournament.registration_closes_at is null or tournament.registration_closes_at >= now())
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Adicional da Classe Espacial indisponível.';
  end if;

  select athlete.*
    into athlete_row
  from public.tournament_athletes as athlete
  where athlete.id = p_athlete_id
    and athlete.active = true
    and athlete.status = 'ACTIVE'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Inscrição elegível não encontrada.';
  end if;

  select registration.*
    into primary_registration
  from public.tournament_registrations as registration
  where registration.id = p_primary_registration_id
    and registration.tournament_id = p_tournament_id
    and registration.athlete_id = p_athlete_id
    and registration.status = 'CONFIRMED'
    and registration.payment_status in ('PAID', 'NOT_REQUIRED')
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Inscrição principal confirmada não encontrada.';
  end if;

  select category.*
    into primary_category
  from public.tournament_categories as category
  where category.id = primary_registration.category_id
    and category.tournament_id = p_tournament_id
    and category.active = true;
  if not found then
    raise exception using errcode = 'P0002', message = 'Classe principal indisponível.';
  end if;

  addon_rule := tournament_row.settings -> 'spatial_addons' -> primary_category.code;
  if addon_rule is null or nullif(trim(addon_rule ->> 'category_code'), '') is null then
    raise exception using errcode = 'P0001', message = 'Esta classe não permite inscrição na Classe Espacial.';
  end if;

  select category.*
    into spatial_category
  from public.tournament_categories as category
  where category.tournament_id = p_tournament_id
    and category.code = addon_rule ->> 'category_code'
    and category.active = true
    and category.registration_open = true
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'A Classe Espacial correspondente está fechada.';
  end if;

  addon_fee := case
    when coalesce(tournament_row.settings #>> '{spatial_addon_fee}', '') ~ '^[0-9]+([.][0-9]{1,2})?$'
      then (tournament_row.settings #>> '{spatial_addon_fee}')::numeric
    when coalesce(addon_rule ->> 'fee', '') ~ '^[0-9]+([.][0-9]{1,2})?$'
      then (addon_rule ->> 'fee')::numeric
    else spatial_category.registration_fee
  end;
  if addon_fee is null or addon_fee <> 80 then
    raise exception using errcode = 'P0001', message = 'O adicional da Classe Espacial deve estar configurado em R$ 80,00.';
  end if;

  -- Discover a possible replay without taking a row lock yet. Existing
  -- checkouts are then locked in the same canonical order used by payment
  -- reconciliation and expiry: payment first, registration second. This
  -- avoids a registration -> payment / payment -> registration deadlock.
  select registration.id
    into existing_spatial_registration_id
  from public.tournament_registrations as registration
  where registration.request_token = p_request_token
    and registration.parent_registration_id is null
    and registration.registration_group_id is null;

  if found then
    matched_request_token := true;
  else
    select registration.id
      into existing_spatial_registration_id
    from public.tournament_registrations as registration
    where registration.tournament_id = p_tournament_id
      and registration.athlete_id = p_athlete_id
      and registration.category_id = spatial_category.id
    order by registration.created_at desc, registration.id desc
    limit 1;
  end if;

  if existing_spatial_registration_id is not null then
    select payment.*
      into payment_row
    from public.tournament_payments as payment
    where payment.registration_id = existing_spatial_registration_id
    for update;

    select registration.*
      into spatial_registration
    from public.tournament_registrations as registration
    where registration.id = existing_spatial_registration_id
    for update;

    -- Expiry may have removed both rows after the unlocked discovery query.
    -- In that case it is safe to create a fresh reservation below.
    if found then
      if matched_request_token then
        if spatial_registration.tournament_id <> p_tournament_id
           or spatial_registration.athlete_id <> p_athlete_id
           or spatial_registration.category_id <> spatial_category.id
           or spatial_registration.parent_registration_id is not null
           or spatial_registration.registration_group_id is not null
           or spatial_registration.source <> 'PUBLIC'
           or spatial_registration.total_amount <> addon_fee then
          raise exception using errcode = '42501', message = 'Esta tentativa não corresponde ao adicional informado.';
        end if;
        if spatial_registration.status = 'CONFIRMED'
           and spatial_registration.payment_status in ('PAID', 'NOT_REQUIRED') then
          raise exception using errcode = 'P0001', message = 'Você já está inscrito nesta Classe Espacial.';
        end if;
        if spatial_registration.status <> 'PENDING'
           or spatial_registration.payment_status <> 'PENDING' then
          raise exception using errcode = 'P0001', message = 'Esta inscrição precisa ser revisada pela organização.';
        end if;
      else
        if spatial_registration.status = 'CONFIRMED'
           and spatial_registration.payment_status in ('PAID', 'NOT_REQUIRED') then
          raise exception using errcode = 'P0001', message = 'Você já está inscrito nesta Classe Espacial.';
        end if;
        if spatial_registration.parent_registration_id is not null
           or spatial_registration.registration_group_id is not null
           or spatial_registration.request_token is null
           or spatial_registration.source <> 'PUBLIC'
           or spatial_registration.total_amount <> addon_fee
           or spatial_registration.status <> 'PENDING'
           or spatial_registration.payment_status <> 'PENDING' then
          raise exception using errcode = 'P0001', message = 'Esta inscrição precisa ser revisada pela organização.';
        end if;
      end if;
    else
      existing_spatial_registration_id := null;
      matched_request_token := false;
      payment_row := null;
    end if;
  end if;

  if spatial_registration.id is null then
    select count(*)::integer
      into occupied
    from public.tournament_registrations as registration
    where registration.category_id = spatial_category.id
      and registration.status in ('PENDING', 'CONFIRMED');
    if spatial_category.max_entries is not null and occupied >= spatial_category.max_entries then
      raise exception using errcode = 'P0001', message = 'A Classe Espacial correspondente atingiu o limite de vagas.';
    end if;

    insert into public.tournament_registrations (
      tournament_id,
      category_id,
      athlete_id,
      public_name,
      public_city,
      public_club,
      request_token,
      status,
      payment_status,
      total_amount,
      source,
      published,
      terms_accepted_at,
      notes
    ) values (
      p_tournament_id,
      spatial_category.id,
      p_athlete_id,
      primary_registration.public_name,
      primary_registration.public_city,
      primary_registration.public_club,
      p_request_token,
      'PENDING',
      'PENDING',
      addon_fee,
      'PUBLIC',
      true,
      now(),
      'Adicional da Classe Espacial solicitado após a inscrição principal ' || primary_registration.public_code || '.'
    )
    returning * into spatial_registration;
  end if;

  if payment_row.id is null then
    insert into public.tournament_payments (
      tournament_id,
      registration_id,
      provider,
      provider_environment,
      external_reference,
      billing_type,
      status,
      amount,
      expires_at
    ) values (
      p_tournament_id,
      spatial_registration.id,
      'ASAAS',
      p_provider_environment,
      'tournament-spatial-addon:' || spatial_registration.id::text,
      'PIX',
      'CREATED',
      addon_fee,
      now() + interval '2 hours'
    )
    returning * into payment_row;
    payment_created := true;
  end if;

  if payment_row.tournament_id <> p_tournament_id
     or payment_row.registration_id <> spatial_registration.id
     or payment_row.registration_group_id is not null
     or payment_row.provider <> 'ASAAS'
     or payment_row.provider_environment <> p_provider_environment
     or payment_row.external_reference <> 'tournament-spatial-addon:' || spatial_registration.id::text
     or payment_row.billing_type is distinct from 'PIX'
     or payment_row.status not in ('CREATED', 'RECONCILING', 'PENDING', 'FAILED')
     or payment_row.expires_at is null
     or payment_row.expires_at <= now()
     or payment_row.amount <> addon_fee then
    raise exception using errcode = '55000', message = 'A cobrança local do adicional é divergente.';
  end if;

  return jsonb_build_object(
    'primary_registration', to_jsonb(primary_registration),
    'primary_category', to_jsonb(primary_category),
    'registration', to_jsonb(spatial_registration),
    'category', to_jsonb(spatial_category),
    'payment', to_jsonb(payment_row),
    'payment_created', payment_created,
    'total_amount', addon_fee
  );
end;
$$;

-- Resume an already-created standalone add-on under a database lock. This is
-- intentionally separate from the creation RPC: an active two-hour Pix may be
-- resumed after registrations close, but it must never bypass the exact
-- athlete/category/payment invariants established when it was created.
create or replace function public.resume_private_tournament_spatial_addon_checkout(
  p_tournament_id uuid,
  p_athlete_id uuid,
  p_primary_registration_id uuid,
  p_spatial_registration_id uuid,
  p_provider_environment text default 'UNKNOWN'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tournament_row public.tournaments%rowtype;
  athlete_row public.tournament_athletes%rowtype;
  primary_registration public.tournament_registrations%rowtype;
  primary_category public.tournament_categories%rowtype;
  spatial_category public.tournament_categories%rowtype;
  spatial_registration public.tournament_registrations%rowtype;
  payment_row public.tournament_payments%rowtype;
  addon_rule jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;
  if p_tournament_id is null
     or p_athlete_id is null
     or p_primary_registration_id is null
     or p_spatial_registration_id is null then
    raise exception using errcode = '22023', message = 'Retomada do adicional inválida.';
  end if;
  if p_provider_environment not in ('SANDBOX', 'PRODUCTION') then
    raise exception using errcode = '22023', message = 'Ambiente do provedor inválido.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tournament_id::text || ':' || p_athlete_id::text, 20260831100000)
  );

  -- Keep the canonical payment -> registration row-lock order used by the
  -- webhook, reconciliation and expiry workers.
  select payment.*
    into payment_row
  from public.tournament_payments as payment
  where payment.registration_id = p_spatial_registration_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Cobrança do adicional não encontrada.';
  end if;

  select registration.*
    into spatial_registration
  from public.tournament_registrations as registration
  where registration.id = p_spatial_registration_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Inscrição adicional não encontrada.';
  end if;

  if spatial_registration.tournament_id <> p_tournament_id
     or spatial_registration.athlete_id <> p_athlete_id
     or spatial_registration.parent_registration_id is not null
     or spatial_registration.registration_group_id is not null
     or spatial_registration.request_token is null
     or spatial_registration.source <> 'PUBLIC'
     or spatial_registration.status <> 'PENDING'
     or spatial_registration.payment_status <> 'PENDING'
     or spatial_registration.total_amount <> 80 then
    raise exception using errcode = 'P0001', message = 'Esta inscrição precisa ser revisada pela organização.';
  end if;

  if payment_row.tournament_id <> p_tournament_id
     or payment_row.registration_id <> spatial_registration.id
     or payment_row.registration_group_id is not null
     or payment_row.provider <> 'ASAAS'
     or payment_row.provider_environment <> p_provider_environment
     or payment_row.external_reference <> 'tournament-spatial-addon:' || spatial_registration.id::text
     or payment_row.billing_type is distinct from 'PIX'
     or payment_row.status not in ('CREATED', 'RECONCILING', 'PENDING', 'FAILED')
     or payment_row.expires_at is null
     or payment_row.expires_at <= now()
     or payment_row.amount <> 80 then
    raise exception using errcode = 'P0001', message = 'A cobrança desta inscrição precisa ser revisada pela organização.';
  end if;

  select tournament.*
    into tournament_row
  from public.tournaments as tournament
  where tournament.id = p_tournament_id
    and tournament.is_published = true
    and lower(coalesce(tournament.settings #>> '{spatial_addon_portal,enabled}', 'false')) = 'true';
  if not found then
    raise exception using errcode = 'P0002', message = 'Adicional da Classe Espacial indisponível.';
  end if;

  select athlete.*
    into athlete_row
  from public.tournament_athletes as athlete
  where athlete.id = p_athlete_id
    and athlete.active = true
    and athlete.status = 'ACTIVE';
  if not found then
    raise exception using errcode = 'P0002', message = 'Atleta do adicional não encontrado.';
  end if;

  select registration.*
    into primary_registration
  from public.tournament_registrations as registration
  where registration.id = p_primary_registration_id
    and registration.tournament_id = p_tournament_id
    and registration.athlete_id = p_athlete_id
    and registration.status = 'CONFIRMED'
    and registration.payment_status in ('PAID', 'NOT_REQUIRED');
  if not found then
    raise exception using errcode = 'P0002', message = 'Inscrição principal confirmada não encontrada.';
  end if;

  select category.*
    into primary_category
  from public.tournament_categories as category
  where category.id = primary_registration.category_id
    and category.tournament_id = p_tournament_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Classe principal não encontrada.';
  end if;

  addon_rule := tournament_row.settings -> 'spatial_addons' -> primary_category.code;
  if addon_rule is null or nullif(trim(addon_rule ->> 'category_code'), '') is null then
    raise exception using errcode = 'P0001', message = 'Esta classe não permite inscrição na Classe Espacial.';
  end if;

  select category.*
    into spatial_category
  from public.tournament_categories as category
  where category.id = spatial_registration.category_id
    and category.tournament_id = p_tournament_id
    and category.code = addon_rule ->> 'category_code';
  if not found then
    raise exception using errcode = 'P0001', message = 'A Classe Espacial da cobrança é divergente.';
  end if;

  return jsonb_build_object(
    'primary_registration', to_jsonb(primary_registration),
    'primary_category', to_jsonb(primary_category),
    'registration', to_jsonb(spatial_registration),
    'category', to_jsonb(spatial_category),
    'payment', to_jsonb(payment_row),
    'payment_created', false,
    'total_amount', 80
  );
end;
$$;

revoke all on function public.claim_private_tournament_spatial_addon_checkout(
  uuid, uuid, uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.claim_private_tournament_spatial_addon_checkout(
  uuid, uuid, uuid, uuid, text, text
) to service_role;

revoke all on function public.resume_private_tournament_spatial_addon_checkout(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.resume_private_tournament_spatial_addon_checkout(
  uuid, uuid, uuid, uuid, text
) to service_role;

-- The expiry worker performs provider I/O before removing the local hold. A
-- checkout or webhook can update the payment during that interval, so the
-- destructive step must compare the exact row version again while holding the
-- payment lock. Keep the legacy one-argument overload for the atomic family
-- checkout, which invokes it inside the same database transaction.
create or replace function public.archive_expired_tournament_payment(
  p_payment_id uuid,
  p_expected_status text,
  p_expected_updated_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.tournament_payments%rowtype;
  primary_registration_id uuid;
  athlete_id uuid;
  target_group_id uuid;
  registration_snapshot jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;

  select payment.*
    into payment_row
  from public.tournament_payments as payment
  where payment.id = p_payment_id
  for update;

  if not found
     or payment_row.status is distinct from p_expected_status
     or payment_row.updated_at is distinct from p_expected_updated_at
     or payment_row.status not in ('CREATED', 'RECONCILING', 'PENDING', 'FAILED', 'OVERDUE')
     or payment_row.expires_at is null
     or payment_row.expires_at > now()
     or (
       payment_row.status in ('CREATED', 'RECONCILING')
       and payment_row.provider_attempted_at is not null
       and payment_row.provider_attempted_at > clock_timestamp() - interval '3 minutes'
     ) then
    return false;
  end if;

  select coalesce(registration.parent_registration_id, registration.id),
         registration.athlete_id,
         registration.registration_group_id
    into primary_registration_id, athlete_id, target_group_id
  from public.tournament_registrations as registration
  where registration.id = payment_row.registration_id
  for update;

  if primary_registration_id is null then
    delete from public.tournament_payments where id = payment_row.id;
    return true;
  end if;

  select coalesce(jsonb_agg(to_jsonb(registration) order by registration.created_at, registration.id), '[]'::jsonb)
    into registration_snapshot
  from public.tournament_registrations as registration
  where case
    when target_group_id is not null then registration.registration_group_id = target_group_id
    else registration.id = primary_registration_id
      or registration.parent_registration_id = primary_registration_id
  end;

  insert into private.tournament_expired_registration_attempts (
    tournament_id,
    athlete_id,
    primary_registration_id,
    payment_id,
    registration_group_id,
    registration_snapshot,
    payment_snapshot,
    expired_at
  ) values (
    payment_row.tournament_id,
    athlete_id,
    primary_registration_id,
    payment_row.id,
    target_group_id,
    registration_snapshot,
    to_jsonb(payment_row) - 'raw_response' - 'pix_payload' - 'pix_encoded_image',
    now()
  ) on conflict (payment_id) do nothing;

  delete from public.tournament_payments
  where id = payment_row.id;

  if target_group_id is not null then
    delete from public.tournament_registrations
    where tournament_registrations.registration_group_id = target_group_id;
    delete from public.tournament_registration_groups
    where id = target_group_id;
  else
    delete from public.tournament_registrations
    where id = primary_registration_id;
  end if;

  return true;
end;
$$;

revoke all on function public.archive_expired_tournament_payment(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.archive_expired_tournament_payment(uuid, text, timestamptz)
  to service_role;

commit;
