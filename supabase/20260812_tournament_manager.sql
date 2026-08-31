-- Tournament manager: multi-event administration, public registration, brackets,
-- scheduling, payments and sanitized public snapshots.

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 3 and 140),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  year integer,
  short_description text,
  description text,
  city text,
  club_name text,
  venue text,
  timezone text not null default 'America/Sao_Paulo',
  logo_url text,
  cover_url text,
  regulations_url text,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS', 'FINISHED', 'ARCHIVED')),
  registration_open boolean not null default false,
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  starts_on date,
  ends_on date,
  default_fee numeric(10,2) not null default 0 check (default_fee >= 0),
  allowed_payment_methods jsonb not null default '["PIX","BOLETO","CREDIT_CARD"]'::jsonb,
  is_published boolean not null default false,
  published_at timestamptz,
  instagram text,
  whatsapp text,
  notes text,
  settings jsonb not null default '{}'::jsonb,
  theme jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  check (registration_closes_at is null or registration_opens_at is null or registration_closes_at >= registration_opens_at)
);

create unique index if not exists tournaments_slug_uq on public.tournaments(lower(slug));
create index if not exists tournaments_public_idx on public.tournaments(is_published, status, starts_on);

create table if not exists public.tournament_categories (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  event_type text not null default 'SINGLES' check (event_type in ('SINGLES', 'DOUBLES')),
  gender text not null default 'OPEN' check (gender in ('MALE', 'FEMALE', 'MIXED', 'OPEN')),
  class_level text,
  draw_format text not null default 'SINGLE_ELIMINATION' check (draw_format in ('SINGLE_ELIMINATION', 'ROUND_ROBIN', 'GROUPS_AND_KNOCKOUT')),
  draw_size integer check (draw_size is null or draw_size in (2, 4, 8, 16, 32, 64, 128)),
  registration_fee numeric(10,2) not null default 0 check (registration_fee >= 0),
  registration_open boolean not null default true,
  min_entries integer not null default 2 check (min_entries >= 2),
  max_entries integer check (max_entries is null or max_entries >= 2),
  active boolean not null default true,
  is_published boolean not null default true,
  sort_order integer not null default 0,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, code),
  unique (id, tournament_id),
  check (max_entries is null or max_entries >= min_entries)
);

create index if not exists tournament_categories_tournament_sort_idx on public.tournament_categories(tournament_id, sort_order, name);

create table if not exists public.tournament_athletes (
  id uuid primary key default gen_random_uuid(),
  source_key text unique,
  auth_user_id uuid references auth.users(id) on delete set null,
  app_client_id uuid references public.app_clients(id) on delete set null,
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  nickname text,
  email text,
  phone text,
  cpf text,
  birth_date date,
  gender text check (gender in ('MALE', 'FEMALE', 'OTHER', 'NOT_INFORMED')),
  city text,
  club_name text,
  ranking integer,
  seed integer,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
  active boolean not null default true,
  asaas_customer_id text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tournament_athletes_cpf_uq on public.tournament_athletes(cpf) where cpf is not null and cpf <> '';
create index if not exists tournament_athletes_name_idx on public.tournament_athletes(lower(full_name));

create table if not exists public.tournament_registrations (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  category_id uuid not null,
  athlete_id uuid not null references public.tournament_athletes(id) on delete restrict,
  public_name text not null,
  public_city text,
  public_club text,
  public_code text not null default ('INS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  public_token uuid not null default gen_random_uuid(),
  partner_name text,
  shirt_size text,
  seed_number integer,
  status text not null default 'PENDING' check (status in ('PENDING', 'CONFIRMED', 'WAITLIST', 'CANCELLED', 'REFUNDED')),
  payment_status text not null default 'PENDING' check (payment_status in ('NOT_REQUIRED', 'PENDING', 'PAID', 'OVERDUE', 'REFUNDED', 'CANCELLED')),
  total_amount numeric(10,2) not null default 0 check (total_amount >= 0),
  paid_amount numeric(10,2) not null default 0 check (paid_amount >= 0),
  source text not null default 'PUBLIC' check (source in ('PUBLIC', 'ADMIN', 'IMPORT', 'DEMO')),
  published boolean not null default true,
  terms_accepted_at timestamptz,
  notes text,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_registration_category_fk foreign key (category_id, tournament_id) references public.tournament_categories(id, tournament_id),
  unique (id, tournament_id),
  unique (tournament_id, category_id, athlete_id),
  unique (tournament_id, public_code),
  unique (public_token)
);

create index if not exists tournament_registrations_category_status_idx on public.tournament_registrations(category_id, status);
create index if not exists tournament_registrations_payment_idx on public.tournament_registrations(tournament_id, payment_status);

create table if not exists public.tournament_payments (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  registration_id uuid not null,
  provider text not null default 'ASAAS',
  provider_customer_id text,
  provider_payment_id text,
  external_reference text not null,
  billing_type text check (billing_type in ('PIX', 'BOLETO', 'CREDIT_CARD', 'UNDEFINED')),
  status text not null default 'CREATED' check (status in ('CREATED', 'PENDING', 'RECEIVED', 'CONFIRMED', 'OVERDUE', 'REFUNDED', 'CANCELLED', 'CHARGEBACK', 'FAILED')),
  amount numeric(10,2) not null check (amount >= 0),
  invoice_url text,
  pix_payload text,
  pix_encoded_image text,
  pix_expires_at timestamptz,
  raw_response jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (registration_id),
  unique (provider, provider_payment_id),
  unique (external_reference)
);

create index if not exists tournament_payments_registration_idx on public.tournament_payments(registration_id, status);

create table if not exists public.asaas_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text not null,
  provider_payment_id text,
  payload jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'PROCESSED', 'IGNORED', 'FAILED')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

create table if not exists public.tournament_courts (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  club_court_id uuid references public.courts(id) on delete set null,
  name text not null,
  surface text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, name)
);

create table if not exists public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  legacy_key text unique,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  category_id uuid not null,
  round_no integer not null default 1,
  round_code text,
  phase text,
  match_no integer not null default 1,
  side1_athlete_id uuid references public.tournament_athletes(id) on delete set null,
  side2_athlete_id uuid references public.tournament_athletes(id) on delete set null,
  winner_athlete_id uuid references public.tournament_athletes(id) on delete set null,
  source1_match_id uuid references public.tournament_matches(id) on delete set null deferrable initially deferred,
  source2_match_id uuid references public.tournament_matches(id) on delete set null deferrable initially deferred,
  score text,
  court_name text,
  match_date date,
  match_time time,
  scheduled_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  status text not null default 'PENDING' check (status in ('PENDING', 'SCHEDULED', 'CHECK_IN', 'IN_PROGRESS', 'FINISHED', 'WALKOVER', 'CANCELLED')),
  sort_order integer not null default 0,
  published boolean not null default true,
  public_notes text,
  admin_notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_match_category_fk foreign key (category_id, tournament_id) references public.tournament_categories(id, tournament_id),
  unique (id, tournament_id),
  unique (tournament_id, category_id, round_no, match_no),
  check (side1_athlete_id is null or side2_athlete_id is null or side1_athlete_id <> side2_athlete_id),
  check (winner_athlete_id is null or winner_athlete_id = side1_athlete_id or winner_athlete_id = side2_athlete_id)
);

create index if not exists tournament_matches_schedule_idx on public.tournament_matches(tournament_id, match_date, match_time, court_name);
create index if not exists tournament_matches_round_idx on public.tournament_matches(category_id, round_no, match_no);

create table if not exists public.tournament_match_sets (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.tournament_matches(id) on delete cascade,
  set_no integer not null check (set_no between 1 and 5),
  side1_score integer not null default 0 check (side1_score >= 0),
  side2_score integer not null default 0 check (side2_score >= 0),
  side1_tiebreak integer,
  side2_tiebreak integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, set_no)
);

create table if not exists public.tournament_schedule_events (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  title text not null,
  description text,
  event_date date not null,
  event_time time,
  court_name text,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'CONFIRMED', 'FINISHED', 'CANCELLED')),
  published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tournament_schedule_events_date_idx on public.tournament_schedule_events(tournament_id, event_date, event_time);

create table if not exists public.tournament_sponsors (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null,
  logo_url text,
  link_url text,
  tier text not null default 'SUPPORTER' check (tier in ('NAMING', 'MASTER', 'PARTNER', 'SUPPORTER')),
  is_published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tournament_live_state (
  tournament_id uuid primary key references public.tournaments(id) on delete cascade,
  status text not null default 'IDLE',
  match_id uuid references public.tournament_matches(id) on delete set null,
  game1 text,
  game2 text,
  tie1 text,
  tie2 text,
  side1_athlete_id uuid references public.tournament_athletes(id) on delete set null,
  side2_athlete_id uuid references public.tournament_athletes(id) on delete set null,
  winner_athlete_id uuid references public.tournament_athletes(id) on delete set null,
  category_id uuid references public.tournament_categories(id) on delete set null,
  phase text,
  ad_url text,
  ad_title text,
  ad_source text,
  ad_id text,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.tournament_audit_log (
  id bigint generated always as identity primary key,
  tournament_id uuid references public.tournaments(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.has_tournament_permission(p_permission text default 'tournaments.read')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.active = true
      and (
        p.role = 'admin'
        or coalesce(p.permissions, '[]'::jsonb) ? 'tournaments'
        or coalesce(p.permissions, '[]'::jsonb) ? p_permission
      )
  )
$$;

revoke all on function public.has_tournament_permission(text) from public;
grant execute on function public.has_tournament_permission(text) to authenticated;

create or replace function public.tournament_public_snapshot(p_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target public.tournaments%rowtype;
  result jsonb;
begin
  if nullif(trim(p_slug), '') is null then
    select jsonb_build_object(
      'tournaments', coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'slug', t.slug,
        'short_description', t.short_description,
        'city', t.city,
        'club_name', t.club_name,
        'venue', t.venue,
        'status', t.status,
        'starts_on', t.starts_on,
        'ends_on', t.ends_on,
        'registration_open', t.registration_open,
        'registration_closes_at', t.registration_closes_at,
        'cover_url', t.cover_url,
        'logo_url', t.logo_url
      ) order by t.starts_on desc nulls last, t.name), '[]'::jsonb)
    ) into result
    from public.tournaments t
    where t.is_published = true and t.status <> 'ARCHIVED';
    return coalesce(result, jsonb_build_object('tournaments', '[]'::jsonb));
  end if;

  select * into target
  from public.tournaments t
  where lower(t.slug) = lower(trim(p_slug))
    and t.is_published = true
    and t.status <> 'ARCHIVED'
  limit 1;

  if target.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'tournament', jsonb_build_object(
      'id', target.id, 'name', target.name, 'slug', target.slug, 'year', target.year,
      'short_description', target.short_description, 'description', target.description,
      'city', target.city, 'club_name', target.club_name, 'venue', target.venue,
      'timezone', target.timezone, 'logo_url', target.logo_url, 'cover_url', target.cover_url,
      'regulations_url', target.regulations_url, 'status', target.status,
      'registration_open', target.registration_open,
      'registration_opens_at', target.registration_opens_at,
      'registration_closes_at', target.registration_closes_at,
      'starts_on', target.starts_on, 'ends_on', target.ends_on,
      'default_fee', target.default_fee, 'allowed_payment_methods', target.allowed_payment_methods,
      'instagram', target.instagram, 'whatsapp', target.whatsapp,
      'settings', target.settings, 'theme', target.theme
    ),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'tournament_id', c.tournament_id, 'code', c.code, 'name', c.name,
        'description', c.description, 'event_type', c.event_type, 'gender', c.gender,
        'class_level', c.class_level, 'draw_format', c.draw_format, 'draw_size', c.draw_size,
        'registration_fee', c.registration_fee, 'registration_open', c.registration_open,
        'max_entries', c.max_entries, 'sort_order', c.sort_order,
        'registration_count', (select count(*) from public.tournament_registrations r where r.category_id = c.id and r.status in ('CONFIRMED', 'WAITLIST'))
      ) order by c.sort_order, c.name)
      from public.tournament_categories c
      where c.tournament_id = target.id and c.active = true and c.is_published = true
    ), '[]'::jsonb),
    'registrations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'category_id', r.category_id, 'public_name', r.public_name,
        'public_city', r.public_city, 'public_club', r.public_club,
        'partner_name', r.partner_name, 'seed_number', r.seed_number,
        'status', r.status
      ) order by r.seed_number nulls last, r.public_name)
      from public.tournament_registrations r
      where r.tournament_id = target.id and r.published = true and r.status in ('CONFIRMED', 'WAITLIST')
    ), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'category_id', m.category_id, 'round_no', m.round_no,
        'round_code', m.round_code, 'phase', m.phase, 'match_no', m.match_no,
        'side1_athlete_id', m.side1_athlete_id, 'side2_athlete_id', m.side2_athlete_id,
        'winner_athlete_id', m.winner_athlete_id,
        'side1_name', a1.full_name, 'side2_name', a2.full_name, 'winner_name', aw.full_name,
        'source1_match_id', m.source1_match_id, 'source2_match_id', m.source2_match_id,
        'score', m.score, 'court_name', m.court_name, 'match_date', m.match_date,
        'match_time', m.match_time, 'scheduled_at', m.scheduled_at, 'status', m.status,
        'sort_order', m.sort_order, 'public_notes', m.public_notes
      ) order by m.category_id, m.round_no, m.match_no)
      from public.tournament_matches m
      left join public.tournament_athletes a1 on a1.id = m.side1_athlete_id
      left join public.tournament_athletes a2 on a2.id = m.side2_athlete_id
      left join public.tournament_athletes aw on aw.id = m.winner_athlete_id
      where m.tournament_id = target.id and m.published = true
    ), '[]'::jsonb),
    'courts', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'surface', c.surface, 'sort_order', c.sort_order) order by c.sort_order, c.name)
      from public.tournament_courts c where c.tournament_id = target.id and c.active = true
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'title', e.title, 'description', e.description, 'event_date', e.event_date,
        'event_time', e.event_time, 'court_name', e.court_name, 'status', e.status, 'sort_order', e.sort_order
      ) order by e.event_date, e.event_time nulls last, e.sort_order)
      from public.tournament_schedule_events e where e.tournament_id = target.id and e.published = true
    ), '[]'::jsonb),
    'sponsors', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'logo_url', s.logo_url, 'link_url', s.link_url, 'tier', s.tier) order by s.sort_order, s.name)
      from public.tournament_sponsors s where s.tournament_id = target.id and s.is_published = true
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.tournament_public_snapshot(text) from public;
grant execute on function public.tournament_public_snapshot(text) to anon, authenticated;

create or replace function public.tournament_public_registration_status(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'registration', jsonb_build_object(
      'public_code', r.public_code, 'public_name', r.public_name, 'category_id', r.category_id,
      'status', r.status, 'payment_status', r.payment_status, 'total_amount', r.total_amount,
      'created_at', r.created_at
    ),
    'payment', case when p.id is null then null else jsonb_build_object(
      'status', p.status, 'billing_type', p.billing_type, 'amount', p.amount,
      'invoice_url', p.invoice_url, 'paid_at', p.paid_at, 'pix_expires_at', p.pix_expires_at
    ) end
  )
  from public.tournament_registrations r
  left join lateral (
    select tp.* from public.tournament_payments tp where tp.registration_id = r.id order by tp.created_at desc limit 1
  ) p on true
  where r.public_token = p_token
  limit 1
$$;

revoke all on function public.tournament_public_registration_status(uuid) from public;
grant execute on function public.tournament_public_registration_status(uuid) to anon, authenticated;

alter table public.tournaments enable row level security;
alter table public.tournament_categories enable row level security;
alter table public.tournament_athletes enable row level security;
alter table public.tournament_registrations enable row level security;
alter table public.tournament_payments enable row level security;
alter table public.asaas_webhook_events enable row level security;
alter table public.tournament_courts enable row level security;
alter table public.tournament_matches enable row level security;
alter table public.tournament_match_sets enable row level security;
alter table public.tournament_schedule_events enable row level security;
alter table public.tournament_sponsors enable row level security;
alter table public.tournament_live_state enable row level security;
alter table public.tournament_audit_log enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'tournaments', 'tournament_categories', 'tournament_athletes', 'tournament_registrations',
    'tournament_courts', 'tournament_matches', 'tournament_match_sets',
    'tournament_schedule_events', 'tournament_sponsors', 'tournament_live_state'
  ] loop
    execute format('drop policy if exists "tournament staff read" on public.%I', table_name);
    execute format('create policy "tournament staff read" on public.%I for select to authenticated using ((select public.has_tournament_permission(''tournaments.read'')))', table_name);
    execute format('drop policy if exists "tournament staff write" on public.%I', table_name);
    execute format('create policy "tournament staff write" on public.%I for all to authenticated using ((select public.has_tournament_permission(''tournaments.write''))) with check ((select public.has_tournament_permission(''tournaments.write'')))', table_name);
  end loop;
end
$$;

drop policy if exists "tournament finance read" on public.tournament_payments;
create policy "tournament finance read" on public.tournament_payments for select to authenticated using ((select public.has_tournament_permission('tournaments.finance')));
drop policy if exists "tournament finance write" on public.tournament_payments;
create policy "tournament finance write" on public.tournament_payments for all to authenticated using ((select public.has_tournament_permission('tournaments.finance'))) with check ((select public.has_tournament_permission('tournaments.finance')));

drop policy if exists "tournament audit read" on public.tournament_audit_log;
create policy "tournament audit read" on public.tournament_audit_log for select to authenticated using ((select public.has_tournament_permission('tournaments.read')));
drop policy if exists "tournament audit write" on public.tournament_audit_log;
create policy "tournament audit write" on public.tournament_audit_log for insert to authenticated with check ((select public.has_tournament_permission('tournaments.write')));

revoke all on table public.asaas_webhook_events from anon, authenticated;
revoke all on table public.tournament_payments from anon;

grant select, insert, update, delete on table
  public.tournaments, public.tournament_categories, public.tournament_athletes,
  public.tournament_registrations, public.tournament_payments, public.tournament_courts,
  public.tournament_matches, public.tournament_match_sets, public.tournament_schedule_events,
  public.tournament_sponsors, public.tournament_live_state, public.tournament_audit_log
to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Demonstration tournament. All athletes below are fictitious test records.
insert into public.tournaments (
  name, slug, year, short_description, description, city, club_name, venue, status,
  registration_open, registration_opens_at, registration_closes_at, starts_on, ends_on,
  default_fee, is_published, published_at, instagram, whatsapp, notes, settings, theme
)
values (
  'Ilha Open 2026 — Torneio teste', 'ilha-open-2026-teste', 2026,
  'Torneio fictício criado para testar inscrições, pagamentos, chaves, horários e resultados.',
  'Uma base completa de demonstração. Nenhum atleta ou resultado desta página é real.',
  'Colatina', 'Ilha Tênis', 'Ilha Tênis', 'REGISTRATION_OPEN', true,
  '2026-08-01 08:00:00-03', '2026-09-13 23:59:00-03', '2026-09-18', '2026-09-20',
  89.90, true, now(), '@ilhatenis', null,
  'DEMO — dados integralmente fictícios.',
  '{"demo":true,"public_notice":"Ambiente de teste: inscrições e resultados fictícios.","show_participants":true}'::jsonb,
  '{"primary":"#063f46","accent":"#9ce900","surface":"#ffffff"}'::jsonb
)
on conflict ((lower(slug))) do update set
  name = excluded.name,
  status = excluded.status,
  registration_open = excluded.registration_open,
  is_published = true,
  updated_at = now();

insert into public.tournament_categories (
  tournament_id, code, name, description, event_type, gender, class_level,
  draw_format, draw_size, registration_fee, registration_open, max_entries,
  active, is_published, sort_order
)
select t.id, v.code, v.name, v.description, v.event_type, v.gender, v.class_level,
       'SINGLE_ELIMINATION', v.draw_size, v.fee, true, v.max_entries, true, true, v.sort_order
from public.tournaments t
cross join (values
  ('A-M', 'Classe A Masculina', 'Categoria avançada masculina.', 'SINGLES', 'MALE', 'A', 8, 99.90::numeric, 16, 10),
  ('B-M', 'Classe B Masculina', 'Categoria intermediária masculina.', 'SINGLES', 'MALE', 'B', 8, 89.90::numeric, 16, 20),
  ('C-F', 'Classe C Feminina', 'Categoria de entrada feminina.', 'SINGLES', 'FEMALE', 'C', 8, 89.90::numeric, 16, 30),
  ('D-MIX', 'Duplas Mistas', 'Duplas com formação livre mista.', 'DOUBLES', 'MIXED', 'OPEN', 8, 149.90::numeric, 16, 40)
) as v(code, name, description, event_type, gender, class_level, draw_size, fee, max_entries, sort_order)
where t.slug = 'ilha-open-2026-teste'
on conflict (tournament_id, code) do update set
  name = excluded.name, description = excluded.description, registration_fee = excluded.registration_fee,
  registration_open = true, active = true, is_published = true, updated_at = now();

insert into public.tournament_courts(tournament_id, name, surface, sort_order, active)
select t.id, v.name, 'Saibro', v.sort_order, true
from public.tournaments t
cross join (values ('Quadra 1', 10), ('Quadra 2', 20), ('Quadra 3', 30)) as v(name, sort_order)
where t.slug = 'ilha-open-2026-teste'
on conflict (tournament_id, name) do update set active = true, sort_order = excluded.sort_order;

insert into public.tournament_athletes(source_key, full_name, nickname, gender, city, club_name, ranking, seed, status, active, notes)
values
  ('demo:ana-lima', 'Ana Lima', 'Ana', 'FEMALE', 'Colatina', 'Ilha Tênis', 7, 1, 'ACTIVE', true, 'DEMO'),
  ('demo:bruna-matos', 'Bruna Matos', 'Bruna', 'FEMALE', 'Linhares', 'Arena Norte', 14, 2, 'ACTIVE', true, 'DEMO'),
  ('demo:camila-rocha', 'Camila Rocha', 'Cami', 'FEMALE', 'Colatina', 'Ilha Tênis', 19, 3, 'ACTIVE', true, 'DEMO'),
  ('demo:diana-pires', 'Diana Pires', 'Diana', 'FEMALE', 'Baixo Guandu', 'Tênis BG', 23, 4, 'ACTIVE', true, 'DEMO'),
  ('demo:eduardo-nunes', 'Eduardo Nunes', 'Dudu', 'MALE', 'Colatina', 'Ilha Tênis', 4, 1, 'ACTIVE', true, 'DEMO'),
  ('demo:felipe-costa', 'Felipe Costa', 'Felipe', 'MALE', 'Linhares', 'Arena Norte', 8, 2, 'ACTIVE', true, 'DEMO'),
  ('demo:gabriel-melo', 'Gabriel Melo', 'Gabi', 'MALE', 'Colatina', 'Ilha Tênis', 11, 3, 'ACTIVE', true, 'DEMO'),
  ('demo:henrique-silva', 'Henrique Silva', 'Rick', 'MALE', 'Vitória', 'Clube Vitória', 15, 4, 'ACTIVE', true, 'DEMO'),
  ('demo:igor-freitas', 'Igor Freitas', 'Igor', 'MALE', 'Colatina', 'Ilha Tênis', 18, 5, 'ACTIVE', true, 'DEMO'),
  ('demo:joao-dias', 'João Dias', 'João', 'MALE', 'Aracruz', 'Tênis Aracruz', 21, 6, 'ACTIVE', true, 'DEMO'),
  ('demo:lucas-serra', 'Lucas Serra', 'Lucas', 'MALE', 'Colatina', 'Ilha Tênis', 26, 7, 'ACTIVE', true, 'DEMO'),
  ('demo:marcos-reis', 'Marcos Reis', 'Marcos', 'MALE', 'Linhares', 'Arena Norte', 31, 8, 'ACTIVE', true, 'DEMO')
on conflict (source_key) do update set full_name = excluded.full_name, city = excluded.city, club_name = excluded.club_name, active = true, updated_at = now();

insert into public.tournament_registrations (
  tournament_id, category_id, athlete_id, public_name, public_city, public_club,
  seed_number, status, payment_status, total_amount, paid_amount, source, published,
  confirmed_at, notes
)
select t.id, c.id, a.id, a.full_name, a.city, a.club_name, a.seed,
       'CONFIRMED', case when a.source_key in ('demo:igor-freitas', 'demo:joao-dias') then 'PENDING' else 'PAID' end,
       c.registration_fee,
       case when a.source_key in ('demo:igor-freitas', 'demo:joao-dias') then 0 else c.registration_fee end,
       'DEMO', true, now(), 'DEMO — inscrição fictícia'
from public.tournaments t
join public.tournament_categories c on c.tournament_id = t.id and c.code = 'B-M'
join public.tournament_athletes a on a.source_key in (
  'demo:eduardo-nunes','demo:felipe-costa','demo:gabriel-melo','demo:henrique-silva',
  'demo:igor-freitas','demo:joao-dias','demo:lucas-serra','demo:marcos-reis'
)
where t.slug = 'ilha-open-2026-teste'
on conflict (tournament_id, category_id, athlete_id) do update set
  public_name = excluded.public_name, status = excluded.status, payment_status = excluded.payment_status,
  total_amount = excluded.total_amount, paid_amount = excluded.paid_amount, published = true, updated_at = now();

insert into public.tournament_registrations (
  tournament_id, category_id, athlete_id, public_name, public_city, public_club,
  seed_number, status, payment_status, total_amount, paid_amount, source, published,
  confirmed_at, notes
)
select t.id, c.id, a.id, a.full_name, a.city, a.club_name, a.seed,
       'CONFIRMED', 'PAID', c.registration_fee, c.registration_fee, 'DEMO', true, now(), 'DEMO — inscrição fictícia'
from public.tournaments t
join public.tournament_categories c on c.tournament_id = t.id and c.code = 'C-F'
join public.tournament_athletes a on a.source_key in ('demo:ana-lima','demo:bruna-matos','demo:camila-rocha','demo:diana-pires')
where t.slug = 'ilha-open-2026-teste'
on conflict (tournament_id, category_id, athlete_id) do update set
  public_name = excluded.public_name, status = excluded.status, payment_status = excluded.payment_status,
  total_amount = excluded.total_amount, paid_amount = excluded.paid_amount, published = true, updated_at = now();

insert into public.tournament_matches (
  legacy_key, tournament_id, category_id, round_no, round_code, phase, match_no,
  side1_athlete_id, side2_athlete_id, winner_athlete_id, score,
  court_name, match_date, match_time, status, sort_order, published
)
select v.legacy_key, t.id, c.id, v.round_no, v.round_code, v.phase, v.match_no,
       a1.id, a2.id, aw.id, v.score, v.court_name, v.match_date, v.match_time, v.status, v.sort_order, true
from public.tournaments t
join public.tournament_categories c on c.tournament_id = t.id and c.code = 'B-M'
join (values
  ('demo:b-qf1',1,'QF','QF',1,'demo:eduardo-nunes','demo:marcos-reis','demo:eduardo-nunes','6/2 6/3','Quadra 1','2026-09-18'::date,'09:00'::time,'FINISHED',10),
  ('demo:b-qf2',1,'QF','QF',2,'demo:gabriel-melo','demo:henrique-silva','demo:henrique-silva','4/6 6/3 8/10','Quadra 2','2026-09-18'::date,'09:00'::time,'FINISHED',20),
  ('demo:b-qf3',1,'QF','QF',3,'demo:felipe-costa','demo:lucas-serra',null,null,'Quadra 1','2026-09-18'::date,'11:00'::time,'SCHEDULED',30),
  ('demo:b-qf4',1,'QF','QF',4,'demo:igor-freitas','demo:joao-dias',null,null,'Quadra 2','2026-09-18'::date,'11:00'::time,'SCHEDULED',40)
) as v(legacy_key,round_no,round_code,phase,match_no,side1_key,side2_key,winner_key,score,court_name,match_date,match_time,status,sort_order) on true
left join public.tournament_athletes a1 on a1.source_key = v.side1_key
left join public.tournament_athletes a2 on a2.source_key = v.side2_key
left join public.tournament_athletes aw on aw.source_key = v.winner_key
where t.slug = 'ilha-open-2026-teste'
on conflict (legacy_key) do update set
  score = excluded.score, winner_athlete_id = excluded.winner_athlete_id,
  court_name = excluded.court_name, match_date = excluded.match_date, match_time = excluded.match_time,
  status = excluded.status, published = true, updated_at = now();

insert into public.tournament_matches (
  legacy_key, tournament_id, category_id, round_no, round_code, phase, match_no,
  side1_athlete_id, source1_match_id, source2_match_id,
  court_name, match_date, match_time, status, sort_order, published
)
select 'demo:b-sf1', t.id, c.id, 2, 'SF', 'SF', 1,
       a.id, q1.id, q2.id, 'Quadra 1', '2026-09-19'::date, '10:00'::time, 'SCHEDULED', 50, true
from public.tournaments t
join public.tournament_categories c on c.tournament_id = t.id and c.code = 'B-M'
join public.tournament_athletes a on a.source_key = 'demo:eduardo-nunes'
join public.tournament_matches q1 on q1.legacy_key = 'demo:b-qf1'
join public.tournament_matches q2 on q2.legacy_key = 'demo:b-qf2'
where t.slug = 'ilha-open-2026-teste'
on conflict (legacy_key) do update set side1_athlete_id = excluded.side1_athlete_id, source1_match_id = excluded.source1_match_id, source2_match_id = excluded.source2_match_id, updated_at = now();

insert into public.tournament_matches (
  legacy_key, tournament_id, category_id, round_no, round_code, phase, match_no,
  source1_match_id, source2_match_id, court_name, match_date, match_time, status, sort_order, published
)
select 'demo:b-sf2', t.id, c.id, 2, 'SF', 'SF', 2,
       q3.id, q4.id, 'Quadra 2', '2026-09-19'::date, '10:00'::time, 'SCHEDULED', 60, true
from public.tournaments t
join public.tournament_categories c on c.tournament_id = t.id and c.code = 'B-M'
join public.tournament_matches q3 on q3.legacy_key = 'demo:b-qf3'
join public.tournament_matches q4 on q4.legacy_key = 'demo:b-qf4'
where t.slug = 'ilha-open-2026-teste'
on conflict (legacy_key) do update set source1_match_id = excluded.source1_match_id, source2_match_id = excluded.source2_match_id, updated_at = now();

insert into public.tournament_matches (
  legacy_key, tournament_id, category_id, round_no, round_code, phase, match_no,
  source1_match_id, source2_match_id, court_name, match_date, match_time, status, sort_order, published
)
select 'demo:b-final', t.id, c.id, 3, 'FINAL', 'FINAL', 1,
       sf1.id, sf2.id, 'Quadra 1', '2026-09-20'::date, '16:00'::time, 'SCHEDULED', 70, true
from public.tournaments t
join public.tournament_categories c on c.tournament_id = t.id and c.code = 'B-M'
join public.tournament_matches sf1 on sf1.legacy_key = 'demo:b-sf1'
join public.tournament_matches sf2 on sf2.legacy_key = 'demo:b-sf2'
where t.slug = 'ilha-open-2026-teste'
on conflict (legacy_key) do update set source1_match_id = excluded.source1_match_id, source2_match_id = excluded.source2_match_id, updated_at = now();

insert into public.tournament_schedule_events(tournament_id, title, description, event_date, event_time, court_name, status, published, sort_order)
select t.id, v.title, v.description, v.event_date, v.event_time, v.court_name, 'CONFIRMED', true, v.sort_order
from public.tournaments t
cross join (values
  ('Credenciamento', 'Retirada do kit e confirmação dos atletas.', '2026-09-18'::date, '07:30'::time, 'Recepção', 10),
  ('Abertura oficial', 'Boas-vindas e orientações gerais.', '2026-09-18'::date, '08:30'::time, 'Quadra 1', 20),
  ('Premiação', 'Entrega de troféus e fotos dos campeões.', '2026-09-20'::date, '18:00'::time, 'Quadra 1', 30)
) as v(title, description, event_date, event_time, court_name, sort_order)
where t.slug = 'ilha-open-2026-teste'
  and not exists (
    select 1 from public.tournament_schedule_events e
    where e.tournament_id = t.id and e.title = v.title and e.event_date = v.event_date
  );

insert into public.tournament_sponsors(tournament_id, name, tier, is_published, sort_order)
select t.id, v.name, v.tier, true, v.sort_order
from public.tournaments t
cross join (values ('Ilha Tênis', 'MASTER', 10), ('Patrocinador demonstração', 'PARTNER', 20)) as v(name, tier, sort_order)
where t.slug = 'ilha-open-2026-teste'
  and not exists (select 1 from public.tournament_sponsors s where s.tournament_id = t.id and s.name = v.name);

insert into public.tournament_live_state(tournament_id, status)
select id, 'IDLE' from public.tournaments where slug = 'ilha-open-2026-teste'
on conflict (tournament_id) do nothing;
