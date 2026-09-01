begin;

create table public.tournament_registration_groups (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  request_token uuid not null unique,
  public_token uuid not null default gen_random_uuid() unique,
  primary_registration_id uuid references public.tournament_registrations(id) on delete set null,
  payer_name text not null,
  payer_email text not null,
  payer_phone text not null,
  payer_cpf text not null,
  provider_customer_id text,
  status text not null default 'PENDING',
  total_amount numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_registration_groups_payer_name_check
    check (length(trim(payer_name)) between 2 and 120),
  constraint tournament_registration_groups_payer_email_check
    check (length(trim(payer_email)) between 5 and 180),
  constraint tournament_registration_groups_payer_phone_check
    check (payer_phone ~ '^[0-9]{10,13}$'),
  constraint tournament_registration_groups_payer_cpf_check
    check (payer_cpf ~ '^[0-9]{11}$'),
  constraint tournament_registration_groups_status_check
    check (status in ('PENDING', 'CONFIRMED', 'OVERDUE', 'CANCELLED', 'REFUNDED')),
  constraint tournament_registration_groups_total_check
    check (total_amount >= 0)
);

create index tournament_registration_groups_tournament_created_idx
  on public.tournament_registration_groups(tournament_id, created_at desc);

alter table public.tournament_registration_groups enable row level security;
revoke all on table public.tournament_registration_groups from public, anon, authenticated;
grant select, insert, update, delete on table public.tournament_registration_groups to service_role;

alter table public.tournament_registrations
  add column if not exists registration_group_id uuid
    references public.tournament_registration_groups(id) on delete set null;

create index if not exists tournament_registrations_group_idx
  on public.tournament_registrations(registration_group_id, created_at)
  where registration_group_id is not null;

alter table public.tournament_payments
  add column if not exists registration_group_id uuid
    references public.tournament_registration_groups(id) on delete set null;

create unique index if not exists tournament_payments_registration_group_uq
  on public.tournament_payments(registration_group_id)
  where registration_group_id is not null;

alter table private.tournament_expired_registration_attempts
  add column if not exists registration_group_id uuid;

create or replace function public.claim_public_tournament_family_bundle(
  p_tournament_id uuid,
  p_request_token uuid,
  p_payer_name text,
  p_payer_email text,
  p_payer_phone text,
  p_payer_cpf text,
  p_entries jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_payer_name text := trim(regexp_replace(coalesce(p_payer_name, ''), '\s+', ' ', 'g'));
  normalized_payer_email text := lower(trim(coalesce(p_payer_email, '')));
  normalized_payer_phone text := regexp_replace(coalesce(p_payer_phone, ''), '\D', '', 'g');
  normalized_payer_cpf text := regexp_replace(coalesce(p_payer_cpf, ''), '\D', '', 'g');
  entry_count integer;
  entry_record record;
  entry_data jsonb;
  bundle jsonb;
  primary_registration jsonb;
  additional_registration jsonb;
  group_row public.tournament_registration_groups%rowtype;
  group_total numeric := 0;
  first_registration_id uuid;
  registrations jsonb := '[]'::jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;
  if p_tournament_id is null or p_request_token is null then
    raise exception using errcode = '22023', message = 'Inscrição familiar inválida.';
  end if;
  if jsonb_typeof(p_entries) <> 'array' then
    raise exception using errcode = '22023', message = 'Informe os atletas da inscrição.';
  end if;
  entry_count := jsonb_array_length(p_entries);
  if entry_count < 1 or entry_count > 6 then
    raise exception using errcode = '22023', message = 'Uma inscrição pode reunir de um a seis atletas.';
  end if;
  if length(normalized_payer_name) < 2
     or normalized_payer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or normalized_payer_phone !~ '^[0-9]{10,13}$'
     or normalized_payer_cpf !~ '^[0-9]{11}$' then
    raise exception using errcode = '22023', message = 'Dados do responsável inválidos.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_token::text, 20260901032343)
  );

  select registration_group.*
    into group_row
  from public.tournament_registration_groups as registration_group
  where registration_group.request_token = p_request_token
  for update;

  if found then
    if group_row.tournament_id <> p_tournament_id
       or group_row.payer_cpf <> normalized_payer_cpf then
      raise exception using errcode = '42501', message = 'A inscrição familiar não corresponde ao responsável informado.';
    end if;
    return jsonb_build_object(
      'registration_group', jsonb_build_object(
        'id', group_row.id,
        'public_token', group_row.public_token,
        'status', group_row.status,
        'total_amount', group_row.total_amount,
        'primary_registration_id', group_row.primary_registration_id
      ),
      'registrations', coalesce((
        select jsonb_agg(to_jsonb(registration) order by registration.created_at, registration.id)
        from public.tournament_registrations as registration
        where registration.registration_group_id = group_row.id
      ), '[]'::jsonb),
      'duplicate', true
    );
  end if;

  if not exists (
    select 1
    from public.tournaments as tournament
    where tournament.id = p_tournament_id
      and tournament.is_published = true
      and tournament.status = 'REGISTRATION_OPEN'
      and tournament.registration_open = true
      and (tournament.registration_opens_at is null or tournament.registration_opens_at <= now())
      and (tournament.registration_closes_at is null or tournament.registration_closes_at >= now())
  ) then
    raise exception using errcode = 'P0002', message = 'Torneio indisponível para inscrição.';
  end if;

  perform 1
  from public.tournament_categories as category
  where category.tournament_id = p_tournament_id
    and category.id in (
      select distinct category_id
      from (
        select nullif(entry.value ->> 'primary_category_id', '')::uuid as category_id
        from jsonb_array_elements(p_entries) as entry(value)
        union all
        select nullif(entry.value ->> 'additional_category_id', '')::uuid as category_id
        from jsonb_array_elements(p_entries) as entry(value)
      ) as selected
      where category_id is not null
    )
  order by category.id
  for update;

  insert into public.tournament_registration_groups (
    tournament_id,
    request_token,
    payer_name,
    payer_email,
    payer_phone,
    payer_cpf,
    status,
    total_amount
  ) values (
    p_tournament_id,
    p_request_token,
    normalized_payer_name,
    normalized_payer_email,
    normalized_payer_phone,
    normalized_payer_cpf,
    'PENDING',
    0
  )
  returning * into group_row;

  for entry_record in
    select entry.value as data, entry.ordinality
    from jsonb_array_elements(p_entries) with ordinality as entry(value, ordinality)
    order by entry.ordinality
  loop
    entry_data := entry_record.data;
    if jsonb_typeof(entry_data) <> 'object'
       or nullif(entry_data ->> 'athlete_id', '') is null
       or nullif(entry_data ->> 'primary_category_id', '') is null then
      raise exception using errcode = '22023', message = 'Dados de atleta inválidos.';
    end if;

    if exists (
      select 1
      from public.tournament_registrations as existing
      where existing.tournament_id = p_tournament_id
        and existing.athlete_id = (entry_data ->> 'athlete_id')::uuid
        and existing.status in ('PENDING', 'CONFIRMED', 'WAITLIST')
    ) then
      raise exception using errcode = 'P0001', message = 'Um dos atletas já possui inscrição neste torneio.';
    end if;

    select public.claim_public_tournament_registration_bundle(
      p_tournament_id,
      (entry_data ->> 'primary_category_id')::uuid,
      nullif(entry_data ->> 'additional_category_id', '')::uuid,
      (entry_data ->> 'athlete_id')::uuid,
      entry_data ->> 'public_name',
      nullif(entry_data ->> 'public_city', ''),
      null::text,
      nullif(entry_data ->> 'partner_name', ''),
      null::text,
      greatest(coalesce((entry_data ->> 'primary_amount')::numeric, 0), 0),
      nullif(entry_data ->> 'notes', '')
    ) into bundle;

    primary_registration := bundle -> 'registration';
    additional_registration := bundle -> 'additional_registration';
    if coalesce(primary_registration ->> 'status', '') = 'WAITLIST' then
      raise exception using errcode = 'P0001', message = 'Uma das classes escolhidas não possui mais vagas para a inscrição familiar.';
    end if;

    update public.tournament_registrations
    set registration_group_id = group_row.id,
        updated_at = now()
    where id = (primary_registration ->> 'id')::uuid
       or (additional_registration is not null and id = (additional_registration ->> 'id')::uuid);

    if first_registration_id is null then
      first_registration_id := (primary_registration ->> 'id')::uuid;
    end if;
    group_total := group_total + coalesce((bundle ->> 'total_amount')::numeric, 0);
    registrations := registrations || jsonb_build_array(primary_registration);
    if additional_registration is not null and jsonb_typeof(additional_registration) = 'object' then
      registrations := registrations || jsonb_build_array(additional_registration);
    end if;
  end loop;

  update public.tournament_registration_groups
  set primary_registration_id = first_registration_id,
      total_amount = group_total,
      status = case when group_total = 0 then 'CONFIRMED' else 'PENDING' end,
      updated_at = now()
  where id = group_row.id
  returning * into group_row;

  return jsonb_build_object(
    'registration_group', jsonb_build_object(
      'id', group_row.id,
      'public_token', group_row.public_token,
      'status', group_row.status,
      'total_amount', group_row.total_amount,
      'primary_registration_id', group_row.primary_registration_id
    ),
    'registrations', registrations,
    'duplicate', false
  );
end;
$$;

revoke all on function public.claim_public_tournament_family_bundle(
  uuid, uuid, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.claim_public_tournament_family_bundle(
  uuid, uuid, text, text, text, text, jsonb
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
  target_group_id uuid;
  group_total numeric;
  updated_count integer;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
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

  select registration.registration_group_id
    into target_group_id
  from public.tournament_registrations as registration
  where registration.id = p_primary_registration_id
    and registration.parent_registration_id is null;

  if not found then
    raise exception using errcode = 'P0002', message = 'Inscrição principal não encontrada.';
  end if;

  select coalesce(sum(registration.total_amount), 0)
    into group_total
  from public.tournament_registrations as registration
  where case
    when target_group_id is not null then registration.registration_group_id = target_group_id
    else registration.id = p_primary_registration_id
      or registration.parent_registration_id = p_primary_registration_id
  end;

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
  where case
    when target_group_id is not null then registration.registration_group_id = target_group_id
    else registration.id = p_primary_registration_id
      or registration.parent_registration_id = p_primary_registration_id
  end;

  get diagnostics updated_count = row_count;

  if target_group_id is not null then
    update public.tournament_registration_groups
    set status = case
          when p_registration_status = 'CONFIRMED' then 'CONFIRMED'
          when p_registration_status = 'REFUNDED' then 'REFUNDED'
          when p_registration_status = 'CANCELLED' then 'CANCELLED'
          when p_payment_status = 'OVERDUE' then 'OVERDUE'
          else status
        end,
        updated_at = now()
    where id = target_group_id;
  end if;

  return updated_count;
end;
$$;

revoke all on function public.sync_tournament_registration_payment_group(
  uuid, text, text, numeric, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.sync_tournament_registration_payment_group(
  uuid, text, text, numeric, timestamptz, timestamptz
) to service_role;

create or replace function public.archive_expired_tournament_payment(
  p_payment_id uuid
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
     or payment_row.status in ('RECEIVED', 'CONFIRMED', 'REFUNDED', 'CHARGEBACK')
     or payment_row.expires_at is null
     or payment_row.expires_at > now() then
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

revoke all on function public.archive_expired_tournament_payment(uuid) from public, anon, authenticated;
grant execute on function public.archive_expired_tournament_payment(uuid) to service_role;

commit;
