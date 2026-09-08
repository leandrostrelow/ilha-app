begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- A courtesy link is a single-use capability bound to one already-confirmed
-- primary registration and its server-derived Spatial category. It is fully
-- independent from both the normal tournament invites and the paid R$ 80
-- Spatial portal.
create unique index if not exists tournament_registrations_courtesy_scope_idx
  on public.tournament_registrations(id, tournament_id, athlete_id);

create unique index if not exists tournament_registrations_courtesy_target_scope_idx
  on public.tournament_registrations(id, tournament_id, athlete_id, category_id);

create unique index if not exists tournament_categories_courtesy_scope_idx
  on public.tournament_categories(id, tournament_id);

create table public.tournament_spatial_courtesy_invites (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  primary_registration_id uuid not null,
  athlete_id uuid not null references public.tournament_athletes(id) on delete restrict,
  target_category_id uuid not null,
  token_hash text not null unique,
  token_ciphertext text not null,
  status text not null default 'ACTIVE',
  used_registration_id uuid unique,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  revoked_at timestamptz,
  constraint tournament_spatial_courtesy_invites_token_hash_check
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint tournament_spatial_courtesy_invites_token_ciphertext_check
    check (token_ciphertext ~ '^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{60,120}$'),
  constraint tournament_spatial_courtesy_invites_status_check
    check (status in ('ACTIVE', 'USED', 'REVOKED')),
  constraint tournament_spatial_courtesy_invites_expiry_check
    check (expires_at > created_at and expires_at <= created_at + interval '90 days'),
  constraint tournament_spatial_courtesy_invites_state_check
    check (
      (status = 'ACTIVE' and used_registration_id is null and used_at is null and revoked_at is null)
      or (status = 'USED' and used_registration_id is not null and used_at is not null and revoked_at is null)
      or (status = 'REVOKED' and used_registration_id is null and used_at is null and revoked_at is not null)
    ),
  constraint tournament_spatial_courtesy_invites_primary_scope_fk
    foreign key (primary_registration_id, tournament_id, athlete_id)
    references public.tournament_registrations(id, tournament_id, athlete_id)
    on delete restrict,
  constraint tournament_spatial_courtesy_invites_target_scope_fk
    foreign key (target_category_id, tournament_id)
    references public.tournament_categories(id, tournament_id)
    on delete restrict,
  constraint tournament_spatial_courtesy_invites_used_scope_fk
    foreign key (used_registration_id, tournament_id, athlete_id, target_category_id)
    references public.tournament_registrations(id, tournament_id, athlete_id, category_id)
    on delete restrict
);

create index tournament_spatial_courtesy_invites_tournament_status_idx
  on public.tournament_spatial_courtesy_invites(tournament_id, status, created_at desc);

create index tournament_spatial_courtesy_invites_primary_scope_idx
  on public.tournament_spatial_courtesy_invites(
    primary_registration_id,
    tournament_id,
    athlete_id
  );

create index tournament_spatial_courtesy_invites_athlete_idx
  on public.tournament_spatial_courtesy_invites(athlete_id);

create index tournament_spatial_courtesy_invites_target_scope_idx
  on public.tournament_spatial_courtesy_invites(target_category_id, tournament_id);

create index tournament_spatial_courtesy_invites_created_by_idx
  on public.tournament_spatial_courtesy_invites(created_by)
  where created_by is not null;

create unique index tournament_spatial_courtesy_invites_one_active_idx
  on public.tournament_spatial_courtesy_invites(
    tournament_id,
    athlete_id,
    target_category_id
  )
  where status = 'ACTIVE';

alter table public.tournament_spatial_courtesy_invites enable row level security;
alter table public.tournament_spatial_courtesy_invites force row level security;
revoke all on table public.tournament_spatial_courtesy_invites
  from public, anon, authenticated;
grant select, insert, update, delete on table public.tournament_spatial_courtesy_invites
  to service_role;

create or replace function public.create_private_tournament_spatial_courtesy_invite(
  p_tournament_id uuid,
  p_primary_registration_id uuid,
  p_token_hash text,
  p_token_ciphertext text,
  p_created_by uuid,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tournament_row public.tournaments%rowtype;
  primary_registration public.tournament_registrations%rowtype;
  primary_category public.tournament_categories%rowtype;
  target_category public.tournament_categories%rowtype;
  invitation public.tournament_spatial_courtesy_invites%rowtype;
  addon_rule jsonb;
  effective_expiry timestamptz;
  event_expiry timestamptz;
  occupied integer := 0;
  existing_count integer := 0;
  special_max integer := 1;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;
  if p_tournament_id is null
     or p_primary_registration_id is null
     or coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_token_ciphertext, '') !~ '^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{60,120}$' then
    raise exception using errcode = '22023', message = 'Convite isento inválido.';
  end if;
  select tournament.*
    into tournament_row
  from public.tournaments as tournament
  where tournament.id = p_tournament_id
    and tournament.is_published = true
    and tournament.status in ('REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS');
  if not found then
    raise exception using errcode = 'P0002', message = 'A Classe Espacial está fechada.';
  end if;
  event_expiry := case
    when tournament_row.ends_on is null then now() + interval '90 days'
    else ((tournament_row.ends_on + 1)::timestamp at time zone 'America/Sao_Paulo')
  end;
  effective_expiry := least(coalesce(p_expires_at, now() + interval '30 days'), event_expiry);
  if effective_expiry <= now() or effective_expiry > now() + interval '90 days' then
    raise exception using errcode = '22023', message = 'Prazo do convite isento inválido.';
  end if;

  select registration.*
    into primary_registration
  from public.tournament_registrations as registration
  where registration.id = p_primary_registration_id
    and registration.tournament_id = p_tournament_id
    and registration.status = 'CONFIRMED'
    and registration.payment_status in ('PAID', 'NOT_REQUIRED');
  if not found then
    raise exception using errcode = 'P0002', message = 'Inscrição principal confirmada não encontrada.';
  end if;
  if not exists (
    select 1
    from public.tournament_athletes as athlete
    where athlete.id = primary_registration.athlete_id
      and athlete.active = true
      and athlete.status = 'ACTIVE'
  ) then
    raise exception using errcode = 'P0002', message = 'Atleta ativo não encontrado.';
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

  addon_rule := coalesce(
    tournament_row.settings -> 'spatial_addons' -> primary_category.code,
    (tournament_row.settings #> '{spatial_addon_portal,eligibility_overrides}')
      -> primary_category.code
  );
  if addon_rule is null or nullif(trim(addon_rule ->> 'category_code'), '') is null then
    raise exception using errcode = 'P0001', message = 'Esta classe não permite inscrição na Classe Espacial.';
  end if;

  select category.*
    into target_category
  from public.tournament_categories as category
  where category.tournament_id = p_tournament_id
    and category.code = addon_rule ->> 'category_code'
    and category.active = true
    and category.registration_open = true;
  if not found then
    raise exception using errcode = 'P0001', message = 'A Classe Espacial correspondente está fechada.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_tournament_id::text || ':' || primary_registration.athlete_id::text,
      20260831100000
    )
  );

  -- Revalidate and lock the bound registration after the canonical athlete
  -- advisory lock, before replacing any previous invite.
  perform 1
  from public.tournament_registrations as registration
  where registration.id = primary_registration.id
    and registration.tournament_id = p_tournament_id
    and registration.athlete_id = primary_registration.athlete_id
    and registration.category_id = primary_category.id
    and registration.status = 'CONFIRMED'
    and registration.payment_status in ('PAID', 'NOT_REQUIRED')
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Inscrição principal confirmada não encontrada.';
  end if;
  perform 1
  from public.tournament_athletes as athlete
  where athlete.id = primary_registration.athlete_id
    and athlete.active = true
    and athlete.status = 'ACTIVE'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Atleta ativo não encontrado.';
  end if;

  select count(*)::integer
    into occupied
  from public.tournament_registrations as registration
  where registration.category_id = target_category.id
    and registration.status in ('PENDING', 'CONFIRMED');
  if target_category.max_entries is not null and occupied >= target_category.max_entries then
    raise exception using
      errcode = 'P0001',
      message = 'Esta classe atingiu o limite de vagas. Escolha outra classe ou aguarde a organização abrir novas vagas.';
  end if;

  special_max := case
    when coalesce(target_category.settings #>> '{registration_rule,max_total_registrations}', '') ~ '^[0-9]+$'
      then greatest(1, (target_category.settings #>> '{registration_rule,max_total_registrations}')::integer)
    else 1
  end;
  select count(*)::integer
    into existing_count
  from public.tournament_registrations as registration
  where registration.tournament_id = p_tournament_id
    and registration.athlete_id = primary_registration.athlete_id
    and registration.status in ('PENDING', 'CONFIRMED', 'WAITLIST');
  if existing_count >= special_max then
    raise exception using errcode = 'P0001', message = 'Este atleta já atingiu o limite de inscrições neste torneio.';
  end if;

  if exists (
    select 1
    from public.tournament_registrations as registration
    where registration.tournament_id = p_tournament_id
      and registration.athlete_id = primary_registration.athlete_id
      and registration.category_id = target_category.id
  ) then
    raise exception using errcode = 'P0001', message = 'Este atleta já possui um histórico de inscrição nesta Classe Espacial.';
  end if;

  -- Generating a replacement for the same athlete/class invalidates the old
  -- still-unused URL inside this transaction.
  update public.tournament_spatial_courtesy_invites as existing
  set status = 'REVOKED',
      revoked_at = now()
  where existing.tournament_id = p_tournament_id
    and existing.athlete_id = primary_registration.athlete_id
    and existing.target_category_id = target_category.id
    and existing.status = 'ACTIVE';

  insert into public.tournament_spatial_courtesy_invites (
    tournament_id,
    primary_registration_id,
    athlete_id,
    target_category_id,
    token_hash,
    token_ciphertext,
    expires_at,
    created_by
  ) values (
    p_tournament_id,
    primary_registration.id,
    primary_registration.athlete_id,
    target_category.id,
    lower(p_token_hash),
    p_token_ciphertext,
    effective_expiry,
    p_created_by
  )
  returning * into invitation;

  return jsonb_build_object(
    'invitation', jsonb_build_object(
      'id', invitation.id,
      'status', invitation.status,
      'expires_at', invitation.expires_at
    ),
    'athlete_id', primary_registration.athlete_id,
    'primary_registration_id', primary_registration.id,
    'primary_category', jsonb_build_object('id', primary_category.id, 'code', primary_category.code, 'name', primary_category.name),
    'target_category', jsonb_build_object('id', target_category.id, 'code', target_category.code, 'name', target_category.name)
  );
end;
$$;

alter function public.create_private_tournament_spatial_courtesy_invite(
  uuid, uuid, text, text, uuid, timestamptz
) owner to postgres;
revoke all on function public.create_private_tournament_spatial_courtesy_invite(
  uuid, uuid, text, text, uuid, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.create_private_tournament_spatial_courtesy_invite(
  uuid, uuid, text, text, uuid, timestamptz
) to service_role;

-- This lookup is capability-first and bound to one stored registration. A bad
-- token and a valid token with the wrong CPF deliberately return the same
-- error, so the endpoint cannot be used to enumerate tournament participants.
create or replace function public.lookup_private_tournament_spatial_courtesy(
  p_tournament_id uuid,
  p_invite_token_hash text,
  p_cpf text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_cpf text := pg_catalog.regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  invitation public.tournament_spatial_courtesy_invites%rowtype;
  tournament_row public.tournaments%rowtype;
  athlete_row public.tournament_athletes%rowtype;
  primary_registration public.tournament_registrations%rowtype;
  primary_category public.tournament_categories%rowtype;
  target_category public.tournament_categories%rowtype;
  addon_rule jsonb;
  occupied integer := 0;
  cpf_matches boolean := false;
  existing_count integer := 0;
  special_max integer := 1;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;
  if p_tournament_id is null
     or coalesce(p_invite_token_hash, '') !~ '^[0-9a-f]{64}$'
     or normalized_cpf !~ '^[0-9]{11}$' then
    raise exception using errcode = 'P0001', message = 'Este convite ou CPF não é válido.';
  end if;

  select invite.*
    into invitation
  from public.tournament_spatial_courtesy_invites as invite
  where invite.token_hash = lower(p_invite_token_hash)
    and invite.tournament_id = p_tournament_id;
  if not found or invitation.status <> 'ACTIVE' or invitation.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'Este convite ou CPF não é válido.';
  end if;

  select tournament.*
    into tournament_row
  from public.tournaments as tournament
  where tournament.id = invitation.tournament_id
    and tournament.is_published = true
    and tournament.status in ('REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS');
  if not found then
    raise exception using errcode = 'P0002', message = 'A Classe Espacial está fechada.';
  end if;

  select registration.*
    into primary_registration
  from public.tournament_registrations as registration
  where registration.id = invitation.primary_registration_id
    and registration.tournament_id = invitation.tournament_id
    and registration.athlete_id = invitation.athlete_id
    and registration.status = 'CONFIRMED'
    and registration.payment_status in ('PAID', 'NOT_REQUIRED');
  if not found then
    raise exception using errcode = 'P0001', message = 'Este convite ou CPF não é válido.';
  end if;

  select athlete.*
    into athlete_row
  from public.tournament_athletes as athlete
  where athlete.id = invitation.athlete_id
    and athlete.active = true
    and athlete.status = 'ACTIVE';
  if not found then
    raise exception using errcode = 'P0001', message = 'Este convite ou CPF não é válido.';
  end if;

  cpf_matches := pg_catalog.regexp_replace(coalesce(athlete_row.cpf, ''), '[^0-9]', '', 'g') = normalized_cpf;
  if not cpf_matches and primary_registration.registration_group_id is not null then
    select exists (
      select 1
      from public.tournament_registration_groups as registration_group
      where registration_group.id = primary_registration.registration_group_id
        and registration_group.tournament_id = invitation.tournament_id
        and registration_group.payer_cpf = normalized_cpf
    ) into cpf_matches;
  end if;
  if not cpf_matches then
    raise exception using errcode = 'P0001', message = 'Este convite ou CPF não é válido.';
  end if;

  select category.*
    into primary_category
  from public.tournament_categories as category
  where category.id = primary_registration.category_id
    and category.tournament_id = invitation.tournament_id
    and category.active = true;
  select category.*
    into target_category
  from public.tournament_categories as category
  where category.id = invitation.target_category_id
    and category.tournament_id = invitation.tournament_id
    and category.active = true
    and category.registration_open = true;
  addon_rule := coalesce(
    tournament_row.settings -> 'spatial_addons' -> primary_category.code,
    (tournament_row.settings #> '{spatial_addon_portal,eligibility_overrides}')
      -> primary_category.code
  );
  if primary_category.id is null
     or target_category.id is null
     or addon_rule is null
     or target_category.code is distinct from addon_rule ->> 'category_code' then
    raise exception using errcode = 'P0002', message = 'A Classe Espacial correspondente está fechada.';
  end if;

  select count(*)::integer
    into occupied
  from public.tournament_registrations as registration
  where registration.category_id = target_category.id
    and registration.status in ('PENDING', 'CONFIRMED');
  if target_category.max_entries is not null and occupied >= target_category.max_entries then
    raise exception using
      errcode = 'P0001',
      message = 'Esta classe atingiu o limite de vagas. Escolha outra classe ou aguarde a organização abrir novas vagas.';
  end if;
  if exists (
    select 1
    from public.tournament_registrations as registration
    where registration.tournament_id = invitation.tournament_id
      and registration.athlete_id = invitation.athlete_id
      and registration.category_id = invitation.target_category_id
  ) then
    raise exception using errcode = 'P0001', message = 'Esta inscrição não está disponível para este convite.';
  end if;

  special_max := case
    when coalesce(target_category.settings #>> '{registration_rule,max_total_registrations}', '') ~ '^[0-9]+$'
      then greatest(1, (target_category.settings #>> '{registration_rule,max_total_registrations}')::integer)
    else 1
  end;
  select count(*)::integer
    into existing_count
  from public.tournament_registrations as registration
  where registration.tournament_id = invitation.tournament_id
    and registration.athlete_id = invitation.athlete_id
    and registration.status in ('PENDING', 'CONFIRMED', 'WAITLIST');
  if existing_count >= special_max then
    raise exception using errcode = 'P0001', message = 'Esta inscrição não está disponível para este convite.';
  end if;

  return jsonb_build_object(
    'invitation', jsonb_build_object(
      'id', invitation.id,
      'status', invitation.status,
      'expires_at', invitation.expires_at
    ),
    'athlete', jsonb_build_object('id', athlete_row.id, 'full_name', athlete_row.full_name),
    'primary_registration', jsonb_build_object('id', primary_registration.id),
    'primary_category', jsonb_build_object('id', primary_category.id, 'code', primary_category.code, 'name', primary_category.name),
    'target_category', jsonb_build_object('id', target_category.id, 'code', target_category.code, 'name', target_category.name),
    'amount', 0,
    'state', 'ELIGIBLE'
  );
end;
$$;

alter function public.lookup_private_tournament_spatial_courtesy(uuid, text, text)
  owner to postgres;
revoke all on function public.lookup_private_tournament_spatial_courtesy(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.lookup_private_tournament_spatial_courtesy(uuid, text, text)
  to service_role;

create or replace function public.claim_private_tournament_spatial_courtesy(
  p_tournament_id uuid,
  p_request_token uuid,
  p_invite_token_hash text,
  p_cpf text,
  p_terms_accepted boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_cpf text := pg_catalog.regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  invitation public.tournament_spatial_courtesy_invites%rowtype;
  tournament_row public.tournaments%rowtype;
  athlete_row public.tournament_athletes%rowtype;
  primary_registration public.tournament_registrations%rowtype;
  primary_category public.tournament_categories%rowtype;
  target_category public.tournament_categories%rowtype;
  spatial_registration public.tournament_registrations%rowtype;
  addon_rule jsonb;
  cpf_matches boolean := false;
  existing_count integer := 0;
  occupied integer := 0;
  special_max integer := 1;
  resolved_invite_id uuid;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;
  if p_tournament_id is null
     or p_request_token is null
     or coalesce(p_invite_token_hash, '') !~ '^[0-9a-f]{64}$'
     or normalized_cpf !~ '^[0-9]{11}$'
     or p_terms_accepted is distinct from true then
    raise exception using errcode = 'P0001', message = 'Este convite ou CPF não é válido.';
  end if;

  -- Resolve only the bound identifiers first. The request + athlete advisory
  -- locks are acquired before the invitation row so creation and claim use the
  -- same canonical order and cannot deadlock while a link is replaced.
  select invite.*
    into invitation
  from public.tournament_spatial_courtesy_invites as invite
  where invite.token_hash = lower(p_invite_token_hash)
    and invite.tournament_id = p_tournament_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'Este convite ou CPF não é válido.';
  end if;
  resolved_invite_id := invitation.id;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_token::text, 20260908140140)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      invitation.tournament_id::text || ':' || invitation.athlete_id::text,
      20260831100000
    )
  );

  select invite.*
    into invitation
  from public.tournament_spatial_courtesy_invites as invite
  where invite.id = resolved_invite_id
    and invite.token_hash = lower(p_invite_token_hash)
    and invite.tournament_id = p_tournament_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Este convite ou CPF não é válido.';
  end if;

  select registration.*
    into primary_registration
  from public.tournament_registrations as registration
  where registration.id = invitation.primary_registration_id
    and registration.tournament_id = invitation.tournament_id
    and registration.athlete_id = invitation.athlete_id;
  select athlete.*
    into athlete_row
  from public.tournament_athletes as athlete
  where athlete.id = invitation.athlete_id
    and athlete.active = true
    and athlete.status = 'ACTIVE'
  for update;
  if primary_registration.id is null or athlete_row.id is null then
    raise exception using errcode = 'P0001', message = 'Este convite ou CPF não é válido.';
  end if;

  cpf_matches := pg_catalog.regexp_replace(coalesce(athlete_row.cpf, ''), '[^0-9]', '', 'g') = normalized_cpf;
  if not cpf_matches and primary_registration.registration_group_id is not null then
    select exists (
      select 1
      from public.tournament_registration_groups as registration_group
      where registration_group.id = primary_registration.registration_group_id
        and registration_group.tournament_id = invitation.tournament_id
        and registration_group.payer_cpf = normalized_cpf
    ) into cpf_matches;
  end if;
  if not cpf_matches then
    raise exception using errcode = 'P0001', message = 'Este convite ou CPF não é válido.';
  end if;

  if invitation.status = 'USED' then
    select registration.*
      into spatial_registration
    from public.tournament_registrations as registration
    where registration.id = invitation.used_registration_id
      and registration.tournament_id = invitation.tournament_id
      and registration.athlete_id = invitation.athlete_id
      and registration.category_id = invitation.target_category_id
      and registration.request_token = p_request_token
      and registration.status = 'CONFIRMED'
      and registration.payment_status = 'NOT_REQUIRED'
      and registration.total_amount = 0
      and registration.paid_amount = 0
      and registration.source = 'PUBLIC'
      and registration.parent_registration_id is null
      and registration.registration_group_id is null
      and registration.registration_order_id is null
      and registration.terms_accepted_at is not null
      and registration.confirmed_at is not null
      and not exists (
        select 1
        from public.tournament_payments as payment
        where payment.registration_id = registration.id
      );
    if not found then
      raise exception using errcode = 'P0001', message = 'Este convite isento já foi utilizado.';
    end if;
    select category.*
      into target_category
    from public.tournament_categories as category
    where category.id = invitation.target_category_id
      and category.tournament_id = invitation.tournament_id;
    return jsonb_build_object(
      'registration', to_jsonb(spatial_registration),
      'category', to_jsonb(target_category),
      'invitation', jsonb_build_object('id', invitation.id, 'status', 'USED'),
      'primary_registration_id', invitation.primary_registration_id,
      'courtesy', true,
      'courtesy_applied', true,
      'idempotent', true
    );
  elsif invitation.status = 'REVOKED' then
    raise exception using errcode = 'P0001', message = 'Este convite isento foi cancelado.';
  elsif invitation.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'Este convite isento expirou.';
  end if;

  if exists (
    select 1
    from public.tournament_registrations as registration
    where registration.request_token = p_request_token
  ) then
    raise exception using errcode = '42501', message = 'Esta tentativa não corresponde ao convite informado.';
  end if;

  select tournament.*
    into tournament_row
  from public.tournaments as tournament
  where tournament.id = invitation.tournament_id
    and tournament.is_published = true
    and tournament.status in ('REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS')
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'A Classe Espacial está fechada.';
  end if;

  select registration.*
    into primary_registration
  from public.tournament_registrations as registration
  where registration.id = invitation.primary_registration_id
    and registration.tournament_id = invitation.tournament_id
    and registration.athlete_id = invitation.athlete_id
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
    and category.tournament_id = invitation.tournament_id
    and category.active = true;
  addon_rule := coalesce(
    tournament_row.settings -> 'spatial_addons' -> primary_category.code,
    (tournament_row.settings #> '{spatial_addon_portal,eligibility_overrides}')
      -> primary_category.code
  );
  if primary_category.id is null
     or addon_rule is null
     or nullif(trim(addon_rule ->> 'category_code'), '') is null then
    raise exception using errcode = 'P0001', message = 'Esta classe não permite inscrição na Classe Espacial.';
  end if;

  select category.*
    into target_category
  from public.tournament_categories as category
  where category.id = invitation.target_category_id
    and category.tournament_id = invitation.tournament_id
    and category.code = addon_rule ->> 'category_code'
    and category.active = true
    and category.registration_open = true
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'A Classe Espacial correspondente está fechada.';
  end if;

  if exists (
    select 1
    from public.tournament_registrations as registration
    where registration.tournament_id = invitation.tournament_id
      and registration.athlete_id = invitation.athlete_id
      and registration.category_id = invitation.target_category_id
  ) then
    raise exception using errcode = 'P0001', message = 'Esta inscrição não está disponível para este convite.';
  end if;

  special_max := case
    when coalesce(target_category.settings #>> '{registration_rule,max_total_registrations}', '') ~ '^[0-9]+$'
      then greatest(1, (target_category.settings #>> '{registration_rule,max_total_registrations}')::integer)
    else 1
  end;
  select count(*)::integer
    into existing_count
  from public.tournament_registrations as registration
  where registration.tournament_id = invitation.tournament_id
    and registration.athlete_id = invitation.athlete_id
    and registration.status in ('PENDING', 'CONFIRMED', 'WAITLIST');
  if existing_count >= special_max then
    raise exception using errcode = 'P0001', message = 'Este atleta já atingiu o limite de inscrições neste torneio.';
  end if;

  select count(*)::integer
    into occupied
  from public.tournament_registrations as registration
  where registration.category_id = target_category.id
    and registration.status in ('PENDING', 'CONFIRMED');
  if target_category.max_entries is not null and occupied >= target_category.max_entries then
    raise exception using
      errcode = 'P0001',
      message = 'Esta classe atingiu o limite de vagas. Escolha outra classe ou aguarde a organização abrir novas vagas.';
  end if;

  perform pg_catalog.set_config(
    'app.private_spatial_courtesy_claim',
    invitation.tournament_id::text || ':' || invitation.athlete_id::text || ':' || invitation.target_category_id::text,
    true
  );
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
    confirmed_at,
    notes
  ) values (
    invitation.tournament_id,
    invitation.target_category_id,
    invitation.athlete_id,
    primary_registration.public_name,
    primary_registration.public_city,
    primary_registration.public_club,
    p_request_token,
    'CONFIRMED',
    'NOT_REQUIRED',
    0,
    'PUBLIC',
    true,
    now(),
    now(),
    'Classe Espacial confirmada por convite isento de uso único ' || invitation.id::text ||
      '; inscrição principal ' || primary_registration.public_code || '.'
  )
  returning * into spatial_registration;
  perform pg_catalog.set_config('app.private_spatial_courtesy_claim', '', true);

  update public.tournament_spatial_courtesy_invites as invite
  set status = 'USED',
      used_registration_id = spatial_registration.id,
      used_at = now()
  where invite.id = invitation.id
    and invite.status = 'ACTIVE';
  if not found then
    raise exception using errcode = 'P0002', message = 'O convite isento foi alterado durante a confirmação.';
  end if;

  return jsonb_build_object(
    'registration', to_jsonb(spatial_registration),
    'category', to_jsonb(target_category),
    'invitation', jsonb_build_object('id', invitation.id, 'status', 'USED'),
    'primary_registration_id', invitation.primary_registration_id,
    'courtesy', true,
    'courtesy_applied', true,
    'idempotent', false
  );
end;
$$;

alter function public.claim_private_tournament_spatial_courtesy(
  uuid, uuid, text, text, boolean
) owner to postgres;
revoke all on function public.claim_private_tournament_spatial_courtesy(
  uuid, uuid, text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.claim_private_tournament_spatial_courtesy(
  uuid, uuid, text, text, boolean
) to service_role;

-- Keep the public per-athlete guard as a second line of defense. The private
-- M1 override is accepted only for the exact paid or single-use courtesy row
-- shape established by their service-role-only claim RPCs.
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
  private_paid_scope text;
  private_courtesy_scope text;
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

  private_paid_scope := coalesce(
    pg_catalog.current_setting('app.private_spatial_addon_claim', true),
    ''
  );
  private_courtesy_scope := coalesce(
    pg_catalog.current_setting('app.private_spatial_courtesy_claim', true),
    ''
  );
  if (
       private_paid_scope =
         new.tournament_id::text || ':' || new.athlete_id::text || ':' || new.category_id::text
       and new.status = 'PENDING'
       and new.payment_status = 'PENDING'
       and new.request_token is not null
       and new.parent_registration_id is null
       and new.registration_group_id is null
       and new.registration_order_id is null
       and new.total_amount = 80
     ) or (
       private_courtesy_scope =
         new.tournament_id::text || ':' || new.athlete_id::text || ':' || new.category_id::text
       and new.status = 'CONFIRMED'
       and new.payment_status = 'NOT_REQUIRED'
       and new.request_token is not null
       and new.parent_registration_id is null
       and new.registration_group_id is null
       and new.registration_order_id is null
       and new.total_amount = 0
       and new.terms_accepted_at is not null
       and new.confirmed_at is not null
       and new.notes like 'Classe Espacial confirmada por convite isento de uso único %'
     ) then
    select exists (
      select 1
      from public.tournament_registrations as existing_primary
      join public.tournament_categories as existing_primary_category
        on existing_primary_category.id = existing_primary.category_id
       and existing_primary_category.tournament_id = existing_primary.tournament_id
      where existing_primary.tournament_id = new.tournament_id
        and existing_primary.athlete_id = new.athlete_id
        and existing_primary.status = 'CONFIRMED'
        and existing_primary.payment_status in ('PAID', 'NOT_REQUIRED')
        and coalesce(
          (tournament_settings #> '{spatial_addon_portal,eligibility_overrides}')
            -> existing_primary_category.code ->> 'category_code',
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

-- Fail closed at deploy time if an older public snapshot stops being an
-- allow-listed SECURITY DEFINER wrapper. The invite table is never queried by
-- that snapshot and remains completely unavailable to anonymous roles.
do $$
declare
  wrapper_oid regprocedure := to_regprocedure('public.tournament_public_snapshot(text)');
  wrapper_security_definer boolean;
  wrapper_config text[];
  wrapper_definition text;
  public_snapshot jsonb;
begin
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
     or lower(wrapper_definition) like '%tournament_spatial_courtesy_invites%' then
    raise exception 'A allow-list da projeção pública expõe convites isentos privados.'
      using errcode = '55000';
  end if;

  public_snapshot := public.tournament_public_snapshot('ilha-open-2026');
  if coalesce(public_snapshot ? 'spatial_courtesy_invites', false)
     or coalesce(public_snapshot #> '{tournament}' ? 'spatial_courtesy_invites', false) then
    raise exception 'O snapshot público expôs convites isentos da Classe Espacial.'
      using errcode = '55000';
  end if;
end;
$$;

commit;
