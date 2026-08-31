-- Public, payment-free registration for club tournaments. The commitment is
-- recorded for the next monthly invoice, but no financial invoice is mutated
-- automatically: staff can review the client link before billing.

alter table public.tournament_athletes
  add column if not exists is_minor boolean not null default false,
  add column if not exists guardian_name text,
  add column if not exists guardian_phone text;

create table if not exists public.tournament_registration_orders (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  athlete_id uuid not null references public.tournament_athletes(id) on delete restrict,
  app_client_id uuid references public.app_clients(id) on delete set null,
  public_code text not null default ('INT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  public_token uuid not null default gen_random_uuid(),
  category_count integer not null check (category_count between 1 and 2),
  amount numeric(10,2) not null check (amount >= 0),
  billing_month date not null,
  billing_status text not null default 'PENDING_CLIENT_LINK'
    check (billing_status in ('PENDING_CLIENT_LINK', 'READY_FOR_INVOICE', 'INVOICED', 'WAIVED', 'CANCELLED')),
  status text not null default 'CONFIRMED'
    check (status in ('CONFIRMED', 'CANCELLED')),
  consent_text text not null,
  consent_version text not null default '2026-08-24',
  terms_accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (public_code),
  unique (public_token)
);

create unique index if not exists tournament_registration_orders_active_athlete_uq
  on public.tournament_registration_orders(tournament_id, athlete_id)
  where status <> 'CANCELLED';

create index if not exists tournament_registration_orders_billing_idx
  on public.tournament_registration_orders(billing_status, billing_month, tournament_id);

alter table public.tournament_registrations
  add column if not exists registration_order_id uuid
    references public.tournament_registration_orders(id) on delete set null;

create index if not exists tournament_registrations_order_idx
  on public.tournament_registrations(registration_order_id);

alter table public.tournament_registration_orders enable row level security;
revoke all on table public.tournament_registration_orders from public, anon, authenticated;
grant all on table public.tournament_registration_orders to service_role;

create or replace function public.create_internal_tournament_registration(
  p_tournament_slug text,
  p_category_ids uuid[],
  p_full_name text,
  p_phone text,
  p_is_minor boolean,
  p_guardian_name text,
  p_guardian_phone text,
  p_terms_accepted boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tournament_row public.tournaments%rowtype;
  category_row public.tournament_categories%rowtype;
  athlete_row public.tournament_athletes%rowtype;
  order_row public.tournament_registration_orders%rowtype;
  normalized_name text := trim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g'));
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  normalized_guardian_name text := trim(regexp_replace(coalesce(p_guardian_name, ''), '\s+', ' ', 'g'));
  normalized_guardian_phone text := regexp_replace(coalesce(p_guardian_phone, ''), '\D', '', 'g');
  selected_ids uuid[];
  selected_category_id uuid;
  selected_count integer;
  current_count integer;
  source_value text;
  linked_client_id uuid;
  linked_client_count integer;
  registration_rows jsonb;
begin
  if length(normalized_name) < 2 or length(normalized_name) > 120 then
    raise exception 'Informe o nome completo do atleta.' using errcode = '23514';
  end if;
  if length(normalized_phone) < 10 or length(normalized_phone) > 13 then
    raise exception 'Informe um telefone válido com DDD.' using errcode = '23514';
  end if;
  if coalesce(p_is_minor, false) and (
    length(normalized_guardian_name) < 2
    or length(normalized_guardian_phone) < 10
    or length(normalized_guardian_phone) > 13
  ) then
    raise exception 'Informe o nome e o telefone do responsável.' using errcode = '23514';
  end if;
  if p_terms_accepted is not true then
    raise exception 'Confirme a autorização de cobrança na próxima mensalidade.' using errcode = '23514';
  end if;

  select tournament.*
    into tournament_row
    from public.tournaments as tournament
   where lower(tournament.slug) = lower(trim(coalesce(p_tournament_slug, '')))
     and tournament.is_published = true
     and tournament.status = 'REGISTRATION_OPEN'
     and tournament.registration_open = true
     and coalesce(tournament.settings ->> 'registration_mode', '') = 'MONTHLY_BILLING_SIMPLE'
     and (tournament.registration_opens_at is null or tournament.registration_opens_at <= now())
     and (tournament.registration_closes_at is null or tournament.registration_closes_at >= now())
   limit 1;

  if not found then
    raise exception 'As inscrições deste torneio estão fechadas.' using errcode = '23514';
  end if;

  select array_agg(distinct category_id order by category_id)
    into selected_ids
    from unnest(coalesce(p_category_ids, array[]::uuid[])) as category_id;
  selected_count := coalesce(cardinality(selected_ids), 0);
  if selected_count < 1 or selected_count > 2 then
    raise exception 'Escolha uma ou duas classes.' using errcode = '23514';
  end if;

  foreach selected_category_id in array selected_ids loop
    select category.*
      into category_row
      from public.tournament_categories as category
     where category.id = selected_category_id
       and category.tournament_id = tournament_row.id
       and category.active = true
       and category.is_published = true
       and category.registration_open = true
     for update;
    if not found then
      raise exception 'Uma das classes escolhidas não está disponível.' using errcode = '23514';
    end if;
    if category_row.max_entries is not null then
      select count(*)::integer
        into current_count
        from public.tournament_registrations as registration
       where registration.category_id = category_row.id
         and registration.status = 'CONFIRMED';
      if current_count >= category_row.max_entries then
        raise exception 'A classe % atingiu o limite de vagas.', category_row.name using errcode = '23514';
      end if;
    end if;
  end loop;

  source_value := 'internal:' || tournament_row.id::text || ':' ||
    md5(lower(normalized_name) || '|' || normalized_phone);

  select athlete.*
    into athlete_row
    from public.tournament_athletes as athlete
   where athlete.source_key = source_value
   for update;

  if found then
    select registration_order.*
      into order_row
      from public.tournament_registration_orders as registration_order
     where registration_order.tournament_id = tournament_row.id
       and registration_order.athlete_id = athlete_row.id
       and registration_order.status <> 'CANCELLED'
     limit 1;
    if found then
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', registration.id,
        'category_id', registration.category_id,
        'status', registration.status
      ) order by registration.created_at), '[]'::jsonb)
        into registration_rows
        from public.tournament_registrations as registration
       where registration.registration_order_id = order_row.id;
      return jsonb_build_object(
        'duplicate', true,
        'order', jsonb_build_object(
          'id', order_row.id,
          'public_code', order_row.public_code,
          'public_token', order_row.public_token,
          'amount', order_row.amount,
          'billing_month', order_row.billing_month,
          'billing_status', order_row.billing_status,
          'status', order_row.status
        ),
        'registrations', registration_rows
      );
    end if;
  end if;

  select count(*)::integer
    into linked_client_count
    from public.app_clients as client
   where regexp_replace(coalesce(client.phone, ''), '\D', '', 'g') = normalized_phone
     and upper(coalesce(client.status, '')) = 'ATIVO';
  if linked_client_count = 1 then
    select client.id
      into linked_client_id
      from public.app_clients as client
     where regexp_replace(coalesce(client.phone, ''), '\D', '', 'g') = normalized_phone
       and upper(coalesce(client.status, '')) = 'ATIVO'
     limit 1;
  else
    linked_client_id := null;
  end if;

  if athlete_row.id is null then
    insert into public.tournament_athletes (
      source_key, app_client_id, full_name, phone, is_minor,
      guardian_name, guardian_phone, city, club_name, status, active
    ) values (
      source_value, linked_client_id, normalized_name, normalized_phone, coalesce(p_is_minor, false),
      case when coalesce(p_is_minor, false) then normalized_guardian_name else null end,
      case when coalesce(p_is_minor, false) then normalized_guardian_phone else null end,
      'Colatina', 'Ilha Tênis', 'ACTIVE', true
    ) returning * into athlete_row;
  else
    update public.tournament_athletes as athlete
       set full_name = normalized_name,
           phone = normalized_phone,
           app_client_id = coalesce(athlete.app_client_id, linked_client_id),
           is_minor = coalesce(p_is_minor, false),
           guardian_name = case when coalesce(p_is_minor, false) then normalized_guardian_name else null end,
           guardian_phone = case when coalesce(p_is_minor, false) then normalized_guardian_phone else null end,
           active = true,
           status = 'ACTIVE',
           updated_at = now()
     where athlete.id = athlete_row.id
     returning athlete.* into athlete_row;
  end if;

  insert into public.tournament_registration_orders (
    tournament_id, athlete_id, app_client_id, category_count, amount,
    billing_month, billing_status, consent_text, terms_accepted_at
  ) values (
    tournament_row.id,
    athlete_row.id,
    linked_client_id,
    selected_count,
    case when selected_count = 1
      then coalesce((tournament_row.settings ->> 'single_registration_fee')::numeric, 50)
      else coalesce((tournament_row.settings ->> 'double_registration_fee')::numeric, 80)
    end,
    (date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '1 month')::date,
    case when linked_client_id is null then 'PENDING_CLIENT_LINK' else 'READY_FOR_INVOICE' end,
    'Autorizo a cobrança do valor da inscrição na próxima mensalidade do clube.',
    now()
  ) returning * into order_row;

  foreach selected_category_id in array selected_ids loop
    insert into public.tournament_registrations (
      tournament_id, category_id, athlete_id, registration_order_id,
      public_name, public_city, public_club, status, payment_status,
      total_amount, paid_amount, source, published, terms_accepted_at, confirmed_at,
      notes
    ) values (
      tournament_row.id, selected_category_id, athlete_row.id, order_row.id,
      athlete_row.full_name, 'Colatina', 'Ilha Tênis', 'CONFIRMED', 'NOT_REQUIRED',
      0, 0, 'PUBLIC', true, order_row.terms_accepted_at, now(),
      'Inscrição interna; cobrança autorizada para a próxima mensalidade.'
    );
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', registration.id,
    'category_id', registration.category_id,
    'status', registration.status
  ) order by registration.created_at), '[]'::jsonb)
    into registration_rows
    from public.tournament_registrations as registration
   where registration.registration_order_id = order_row.id;

  return jsonb_build_object(
    'duplicate', false,
    'order', jsonb_build_object(
      'id', order_row.id,
      'public_code', order_row.public_code,
      'public_token', order_row.public_token,
      'amount', order_row.amount,
      'billing_month', order_row.billing_month,
      'billing_status', order_row.billing_status,
      'status', order_row.status
    ),
    'registrations', registration_rows
  );
end;
$$;

revoke all on function public.create_internal_tournament_registration(
  text, uuid[], text, text, boolean, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.create_internal_tournament_registration(
  text, uuid[], text, text, boolean, text, text, boolean
) to service_role;

insert into public.tournaments (
  name, slug, year, short_description, description, city, club_name, venue,
  timezone, cover_url, status, registration_open, registration_opens_at,
  registration_closes_at, starts_on, ends_on, default_fee,
  allowed_payment_methods, is_published, published_at, notes, settings, theme
)
select
  'Ilha Open Interno 2026',
  'ilha-open-interno-2026',
  2026,
  'Torneio interno do Ilha Tênis Colatina, de 7 a 13 de setembro.',
  'Cada atleta pode jogar em até duas classes. A inscrição será lançada na próxima mensalidade do clube.',
  'Colatina',
  'Ilha Tênis',
  'Ilha Tênis Colatina',
  'America/Sao_Paulo',
  '/assets/tournaments/ilha-open-interno-2026.jpg',
  'REGISTRATION_OPEN',
  true,
  '2026-08-24 00:00:00 America/Sao_Paulo',
  '2026-09-06 23:59:59 America/Sao_Paulo',
  '2026-09-07',
  '2026-09-13',
  50,
  '["MONTHLY_INVOICE"]'::jsonb,
  true,
  now(),
  'Inscrição: R$ 50 para uma classe ou R$ 80 para duas classes. Vagas limitadas.',
  jsonb_build_object(
    'registration_mode', 'MONTHLY_BILLING_SIMPLE',
    'registration_function', 'tournament-internal-register',
    'max_categories_per_submission', 2,
    'single_registration_fee', 50,
    'double_registration_fee', 80,
    'billing_timing', 'NEXT_MONTHLY_INVOICE',
    'requires_guardian_for_minors', true,
    'poster_url', '/assets/tournaments/ilha-open-interno-2026.jpg'
  ),
  '{"navy":"#06265d","lime":"#b6ef00","orange":"#ef6a1a","paper":"#fff7ee"}'::jsonb
where not exists (
  select 1 from public.tournaments where lower(slug) = 'ilha-open-interno-2026'
);

insert into public.tournament_categories (
  tournament_id, code, name, description, event_type, gender, class_level,
  draw_format, draw_size, registration_fee, registration_open,
  min_entries, max_entries, active, is_published, sort_order
)
select tournament.id, category.code, category.name, category.description,
  'SINGLES', category.gender, category.class_level, 'SINGLE_ELIMINATION', null,
  0, true, 2, 32, true, true, category.sort_order
from public.tournaments as tournament
cross join (values
  ('INFANTIL', 'Infantil', 'Masculino e feminino', 'OPEN', 'INFANTIL', 10),
  ('JUVENIL', 'Juvenil', 'Masculino e feminino', 'OPEN', 'JUVENIL', 20),
  ('ADULTO-INICIANTE', 'Adulto Iniciante', 'Masculino e feminino', 'OPEN', 'INICIANTE', 30),
  ('MASC-1', 'Masculino · 1ª Classe', 'Categoria masculina', 'MALE', '1A', 40),
  ('MASC-2', 'Masculino · 2ª Classe', 'Categoria masculina', 'MALE', '2A', 50),
  ('MASC-3', 'Masculino · 3ª Classe', 'Categoria masculina', 'MALE', '3A', 60),
  ('FEM-1', 'Feminino · 1ª Classe', 'Categoria feminina', 'FEMALE', '1A', 70),
  ('FEM-2', 'Feminino · 2ª Classe', 'Categoria feminina', 'FEMALE', '2A', 80)
) as category(code, name, description, gender, class_level, sort_order)
where tournament.slug = 'ilha-open-interno-2026'
on conflict (tournament_id, code) do update
set name = excluded.name,
    description = excluded.description,
    gender = excluded.gender,
    class_level = excluded.class_level,
    registration_open = true,
    active = true,
    is_published = true,
    sort_order = excluded.sort_order,
    updated_at = now();
