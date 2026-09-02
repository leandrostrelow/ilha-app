begin;

-- Keep every local mutation required by a family checkout in one PostgreSQL
-- transaction. The provider call intentionally remains outside this function:
-- the durable CREATED row is the outbox record used by the Edge Function to
-- create or recover exactly one Asaas charge by external_reference.
create or replace function public.claim_public_tournament_family_checkout(
  p_tournament_id uuid,
  p_request_token uuid,
  p_payer_name text,
  p_payer_email text,
  p_payer_phone text,
  p_payer_cpf text,
  p_entries jsonb,
  p_billing_type text,
  p_provider_environment text,
  p_invite_token_hash text,
  p_create_if_missing boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_payer_name text := trim(regexp_replace(coalesce(p_payer_name, ''), '\s+', ' ', 'g'));
  normalized_payer_email text := lower(trim(coalesce(p_payer_email, '')));
  normalized_payer_phone text := regexp_replace(coalesce(p_payer_phone, ''), '\D', '', 'g');
  normalized_payer_cpf text := regexp_replace(coalesce(p_payer_cpf, ''), '\D', '', 'g');
  normalized_billing_type text := upper(trim(coalesce(p_billing_type, '')));
  normalized_provider_environment text := upper(trim(coalesce(p_provider_environment, '')));
  normalized_invite_token_hash text := lower(trim(coalesce(p_invite_token_hash, '')));
  invite_mode boolean := normalized_invite_token_hash <> '';
  entry_count integer;
  entry_record record;
  entry_data jsonb;
  athlete_source_key text;
  athlete_full_name text;
  athlete_email text;
  athlete_phone text;
  athlete_cpf text;
  athlete_birth_date_text text;
  athlete_birth_date date;
  athlete_gender text;
  athlete_city text;
  athlete_is_minor boolean;
  athlete_guardian_name text;
  athlete_guardian_phone text;
  source_athlete public.tournament_athletes%rowtype;
  cpf_athlete public.tournament_athletes%rowtype;
  athlete_row public.tournament_athletes%rowtype;
  invite_row public.tournament_registration_invites%rowtype;
  resolved_athlete_ids uuid[] := '{}'::uuid[];
  resolved_entries jsonb := '[]'::jsonb;
  pre_read_group public.tournament_registration_groups%rowtype;
  existing_group public.tournament_registration_groups%rowtype;
  group_row public.tournament_registration_groups%rowtype;
  claimed_group_id uuid;
  claim_result jsonb;
  registrations jsonb := '[]'::jsonb;
  payment_row public.tournament_payments%rowtype;
  payment_created boolean := false;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;
  if p_tournament_id is null or p_request_token is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception using errcode = '22023', message = 'Inscrição familiar inválida.';
  end if;
  if p_create_if_missing is null then
    raise exception using errcode = '22023', message = 'Modo da inscrição familiar inválido.';
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
  if normalized_billing_type <> 'PIX' then
    raise exception using errcode = '22023', message = 'Forma de pagamento do provedor inválida.';
  end if;
  if normalized_provider_environment not in ('SANDBOX', 'PRODUCTION')
     and not (invite_mode and normalized_provider_environment = 'NOT_APPLICABLE') then
    raise exception using errcode = '22023', message = 'Ambiente do provedor inválido.';
  end if;
  if invite_mode and normalized_invite_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Convite inválido.';
  end if;

  -- Use the same lock namespace as the existing family claim so legacy and new
  -- callers cannot create two groups for the same idempotency token.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_token::text, 20260901032343)
  );

  -- Discover the candidate without a row lock. Financial workers consistently
  -- acquire payment -> registration/group, so an existing payment must be
  -- locked before this function locks the family group.
  select registration_group.*
    into pre_read_group
  from public.tournament_registration_groups as registration_group
  where registration_group.request_token = p_request_token;

  existing_group := null;
  payment_row := null;
  if pre_read_group.id is not null then
    -- For a free invitation this normally finds no row and the group is locked
    -- directly. If corrupt/legacy data does contain a payment, preserve the
    -- canonical order anyway and reject the inconsistency later.
    select payment.*
      into payment_row
    from public.tournament_payments as payment
    where payment.registration_group_id = pre_read_group.id
    for update;

    select registration_group.*
      into existing_group
    from public.tournament_registration_groups as registration_group
    where registration_group.id = pre_read_group.id
      and registration_group.request_token = p_request_token
    for update;

    -- Expiry/archive may have removed the candidate between discovery and the
    -- ordered locks. Never use the stale payment/group decision: continue via
    -- the new-claim path, which consumes the authoritative priced entries.
    if existing_group.id is null then
      payment_row := null;
    end if;
  end if;

  -- The probe must also authoritatively bind a used invitation to this exact
  -- request token. This is read-only here; the create branch below delegates
  -- the ACTIVE -> USED transition to the existing transactional invite claim.
  if invite_mode then
    select invitation.*
      into invite_row
    from public.tournament_registration_invites as invitation
    where invitation.token_hash = normalized_invite_token_hash;

    if invite_row.id is null or invite_row.tournament_id <> p_tournament_id then
      raise exception using errcode = 'P0001', message = 'Este convite é inválido.';
    elsif invite_row.status = 'USED' then
      if existing_group.id is null
         or invite_row.used_registration_group_id is distinct from existing_group.id then
        raise exception using errcode = 'P0001', message = 'Este convite já foi utilizado.';
      end if;
    elsif invite_row.status = 'REVOKED' then
      raise exception using errcode = 'P0001', message = 'Este convite foi cancelado.';
    elsif invite_row.expires_at is not null and invite_row.expires_at < now() then
      raise exception using errcode = 'P0001', message = 'Este convite expirou.';
    elsif existing_group.id is not null then
      raise exception using errcode = 'P0001', message = 'Este convite não corresponde à inscrição informada.';
    end if;
  end if;

  if existing_group.id is not null then
    if existing_group.tournament_id is distinct from p_tournament_id
       or existing_group.payer_cpf is distinct from normalized_payer_cpf then
      raise exception using errcode = '42501', message = 'A inscrição familiar não corresponde ao responsável informado.';
    end if;

    -- Existing-only probes never call the legacy claim functions: those
    -- functions accept creation payloads and may apply mutable category gates.
    claim_result := jsonb_build_object('duplicate', true);
    if invite_mode then
      claim_result := claim_result || jsonb_build_object(
        'invitation', jsonb_build_object(
          'id', invite_row.id,
          'athlete_limit', invite_row.athlete_limit,
          'status', 'USED'
        )
      );
    end if;
  else
    if not p_create_if_missing then
      return jsonb_build_object(
        'found', false,
        'registration_group', null,
        'registrations', '[]'::jsonb,
        'payment', null,
        'payment_created', false
      );
    end if;

    -- Validate the full payload before the first write. These checks duplicate
    -- the public Edge validation deliberately: the service-only RPC remains a
    -- safe transactional boundary if another trusted backend calls it later.
    for entry_record in
      select entry.value as data, entry.ordinality
      from jsonb_array_elements(p_entries) with ordinality as entry(value, ordinality)
      order by entry.ordinality
    loop
      entry_data := entry_record.data;
      if jsonb_typeof(entry_data) <> 'object' then
        raise exception using errcode = '22023', message = 'Dados de atleta inválidos.';
      end if;

      athlete_source_key := trim(coalesce(entry_data ->> 'athlete_source_key', ''));
      athlete_full_name := trim(regexp_replace(coalesce(entry_data ->> 'athlete_full_name', ''), '\s+', ' ', 'g'));
      athlete_email := lower(trim(coalesce(entry_data ->> 'athlete_email', '')));
      athlete_phone := regexp_replace(coalesce(entry_data ->> 'athlete_phone', ''), '\D', '', 'g');
      athlete_cpf := regexp_replace(coalesce(entry_data ->> 'athlete_cpf', ''), '\D', '', 'g');
      athlete_birth_date_text := trim(coalesce(entry_data ->> 'athlete_birth_date', ''));
      athlete_gender := upper(trim(coalesce(entry_data ->> 'athlete_gender', '')));
      athlete_city := nullif(trim(coalesce(entry_data ->> 'athlete_city', '')), '');
      athlete_guardian_name := nullif(trim(regexp_replace(coalesce(entry_data ->> 'athlete_guardian_name', ''), '\s+', ' ', 'g')), '');
      athlete_guardian_phone := regexp_replace(coalesce(entry_data ->> 'athlete_guardian_phone', ''), '\D', '', 'g');

      if jsonb_typeof(entry_data -> 'athlete_is_minor') <> 'boolean' then
        raise exception using errcode = '22023', message = 'Informe se o atleta é menor de idade.';
      end if;
      athlete_is_minor := (entry_data ->> 'athlete_is_minor')::boolean;

      if athlete_source_key !~ '^tournament-family:[0-9a-f]{64}$'
         or length(athlete_full_name) not between 2 and 120
         or athlete_gender not in ('MALE', 'FEMALE')
         or nullif(entry_data ->> 'primary_category_id', '') is null
         or nullif(entry_data ->> 'public_name', '') is null then
        raise exception using errcode = '22023', message = 'Dados de atleta inválidos.';
      end if;
      if athlete_email <> '' and athlete_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
        raise exception using errcode = '22023', message = 'E-mail de atleta inválido.';
      end if;
      if athlete_phone <> '' and athlete_phone !~ '^[0-9]{10,13}$' then
        raise exception using errcode = '22023', message = 'Telefone de atleta inválido.';
      end if;
      if athlete_cpf <> '' and athlete_cpf !~ '^[0-9]{11}$' then
        raise exception using errcode = '22023', message = 'CPF de atleta inválido.';
      end if;
      if not athlete_is_minor and (athlete_cpf = '' or athlete_phone = '') then
        raise exception using errcode = '22023', message = 'CPF e telefone são obrigatórios para atletas adultos.';
      end if;
      if athlete_is_minor and (
        athlete_birth_date_text = ''
        or athlete_email <> normalized_payer_email
        or athlete_guardian_name is distinct from normalized_payer_name
        or athlete_guardian_phone <> normalized_payer_phone
      ) then
        raise exception using errcode = '22023', message = 'Dados do responsável pelo menor são inválidos.';
      end if;

      athlete_birth_date := null;
      if athlete_birth_date_text <> '' then
        begin
          athlete_birth_date := athlete_birth_date_text::date;
        exception when others then
          raise exception using errcode = '22023', message = 'Data de nascimento inválida.';
        end;
        if pg_catalog.to_char(athlete_birth_date, 'YYYY-MM-DD') <> athlete_birth_date_text then
          raise exception using errcode = '22023', message = 'Data de nascimento inválida.';
        end if;
      end if;

      -- Validate casts now, before any write. Category availability and pricing
      -- remain authoritatively checked by the existing bundle claim below.
      perform (entry_data ->> 'primary_category_id')::uuid;
      if nullif(entry_data ->> 'additional_category_id', '') is not null then
        perform (entry_data ->> 'additional_category_id')::uuid;
      end if;
      perform greatest(coalesce((entry_data ->> 'primary_amount')::numeric, 0), 0);
    end loop;

    -- Lock every submitted identity in a stable order. Distinct request tokens
    -- can target the same CPF/source key; ordering prevents deadlocks and closes
    -- the SELECT-then-INSERT race without widening the table lock.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(identity_key.lock_key, 20260902134031)
    )
    from (
      select distinct 'source:' || trim(entry.value ->> 'athlete_source_key') as lock_key
      from jsonb_array_elements(p_entries) as entry(value)
      union
      select distinct 'cpf:' || regexp_replace(coalesce(entry.value ->> 'athlete_cpf', ''), '\D', '', 'g') as lock_key
      from jsonb_array_elements(p_entries) as entry(value)
      where regexp_replace(coalesce(entry.value ->> 'athlete_cpf', ''), '\D', '', 'g') <> ''
    ) as identity_key
    order by identity_key.lock_key;

    for entry_record in
      select entry.value as data, entry.ordinality
      from jsonb_array_elements(p_entries) with ordinality as entry(value, ordinality)
      order by entry.ordinality
    loop
      entry_data := entry_record.data;
      athlete_source_key := trim(entry_data ->> 'athlete_source_key');
      athlete_full_name := trim(regexp_replace(entry_data ->> 'athlete_full_name', '\s+', ' ', 'g'));
      athlete_email := lower(trim(coalesce(entry_data ->> 'athlete_email', '')));
      athlete_phone := regexp_replace(coalesce(entry_data ->> 'athlete_phone', ''), '\D', '', 'g');
      athlete_cpf := regexp_replace(coalesce(entry_data ->> 'athlete_cpf', ''), '\D', '', 'g');
      athlete_birth_date_text := trim(coalesce(entry_data ->> 'athlete_birth_date', ''));
      athlete_birth_date := nullif(athlete_birth_date_text, '')::date;
      athlete_gender := upper(trim(entry_data ->> 'athlete_gender'));
      athlete_city := nullif(trim(coalesce(entry_data ->> 'athlete_city', '')), '');
      athlete_is_minor := (entry_data ->> 'athlete_is_minor')::boolean;
      athlete_guardian_name := nullif(trim(regexp_replace(coalesce(entry_data ->> 'athlete_guardian_name', ''), '\s+', ' ', 'g')), '');
      athlete_guardian_phone := regexp_replace(coalesce(entry_data ->> 'athlete_guardian_phone', ''), '\D', '', 'g');

      source_athlete := null;
      cpf_athlete := null;
      athlete_row := null;

      select athlete.*
        into source_athlete
      from public.tournament_athletes as athlete
      where athlete.source_key = athlete_source_key
      for update;

      if athlete_cpf <> '' then
        select athlete.*
          into cpf_athlete
        from public.tournament_athletes as athlete
        where regexp_replace(coalesce(athlete.cpf, ''), '[^0-9]', '', 'g') = athlete_cpf
        for update;
      end if;

      if source_athlete.id is not null
         and cpf_athlete.id is not null
         and source_athlete.id <> cpf_athlete.id then
        raise exception using errcode = 'P0001', message = format(
          'Os dados de %s já estão vinculados a outro cadastro.', athlete_full_name
        );
      end if;

      if cpf_athlete.id is not null then
        athlete_row := cpf_athlete;
      else
        athlete_row := source_athlete;
      end if;

      if athlete_row.id is not null then
        if exists (
          select 1
          from public.tournament_registrations as registration
          where registration.tournament_id = p_tournament_id
            and registration.athlete_id = athlete_row.id
        ) then
          raise exception using errcode = 'P0001', message = format(
            '%s já possui inscrição neste torneio. Fale com a organização para alterar ou complementar a inscrição.',
            athlete_full_name
          );
        end if;

        if exists (
          select 1
          from public.tournament_registrations as registration
          where registration.athlete_id = athlete_row.id
        )
        and not (
          (athlete_cpf <> '' and regexp_replace(coalesce(athlete_row.cpf, ''), '[^0-9]', '', 'g') = athlete_cpf)
          or (
            athlete_is_minor
            and athlete_cpf = ''
            and athlete_row.source_key = athlete_source_key
            and lower(trim(coalesce(athlete_row.email, ''))) = normalized_payer_email
            and regexp_replace(coalesce(athlete_row.guardian_phone, ''), '\D', '', 'g') = normalized_payer_phone
            and coalesce(athlete_row.birth_date::text, '') = athlete_birth_date_text
          )
        ) then
          raise exception using errcode = 'P0001', message = format(
            'Os dados de %s já existem. Confirme os dados do responsável, o CPF ou fale com a organização.',
            athlete_full_name
          );
        end if;

        update public.tournament_athletes
        set full_name = athlete_full_name,
            source_key = athlete_source_key,
            email = nullif(athlete_email, ''),
            phone = nullif(athlete_phone, ''),
            cpf = nullif(athlete_cpf, ''),
            birth_date = athlete_birth_date,
            gender = athlete_gender,
            city = athlete_city,
            is_minor = athlete_is_minor,
            guardian_name = case when athlete_is_minor then athlete_guardian_name else null end,
            guardian_phone = case when athlete_is_minor then athlete_guardian_phone else null end,
            active = true,
            status = 'ACTIVE',
            updated_at = now()
        where id = athlete_row.id
        returning * into athlete_row;
      else
        insert into public.tournament_athletes (
          full_name,
          source_key,
          email,
          phone,
          cpf,
          birth_date,
          gender,
          city,
          is_minor,
          guardian_name,
          guardian_phone,
          active,
          status,
          updated_at
        ) values (
          athlete_full_name,
          athlete_source_key,
          nullif(athlete_email, ''),
          nullif(athlete_phone, ''),
          nullif(athlete_cpf, ''),
          athlete_birth_date,
          athlete_gender,
          athlete_city,
          athlete_is_minor,
          case when athlete_is_minor then athlete_guardian_name else null end,
          case when athlete_is_minor then athlete_guardian_phone else null end,
          true,
          'ACTIVE',
          now()
        )
        returning * into athlete_row;
      end if;

      if athlete_row.id = any(resolved_athlete_ids) then
        raise exception using errcode = 'P0001', message = 'Cada atleta precisa ter seus próprios dados.';
      end if;
      resolved_athlete_ids := pg_catalog.array_append(resolved_athlete_ids, athlete_row.id);

      resolved_entries := resolved_entries || jsonb_build_array(jsonb_build_object(
        'athlete_id', athlete_row.id,
        'primary_category_id', entry_data -> 'primary_category_id',
        'additional_category_id', entry_data -> 'additional_category_id',
        'public_name', athlete_full_name,
        'public_city', athlete_city,
        'partner_name', entry_data -> 'partner_name',
        'primary_amount', entry_data -> 'primary_amount',
        'notes', entry_data -> 'notes'
      ));
    end loop;

    if invite_mode then
      claim_result := public.claim_public_tournament_invite_bundle(
        normalized_invite_token_hash,
        p_tournament_id,
        p_request_token,
        normalized_payer_name,
        normalized_payer_email,
        normalized_payer_phone,
        normalized_payer_cpf,
        resolved_entries
      );
    else
      claim_result := public.claim_public_tournament_family_bundle(
        p_tournament_id,
        p_request_token,
        normalized_payer_name,
        normalized_payer_email,
        normalized_payer_phone,
        normalized_payer_cpf,
        resolved_entries
      );
    end if;
  end if;

  -- Existing-only probes intentionally do not call either legacy bundle RPC,
  -- so their compact claim_result has no embedded registration_group object.
  claimed_group_id := coalesce(
    existing_group.id,
    nullif(claim_result #>> '{registration_group,id}', '')::uuid
  );
  if claimed_group_id is null then
    raise exception using errcode = 'P0002', message = 'A inscrição familiar não foi criada.';
  end if;

  select registration_group.*
    into group_row
  from public.tournament_registration_groups as registration_group
  where registration_group.id = claimed_group_id
  for update;

  if group_row.id is null
     or group_row.tournament_id is distinct from p_tournament_id
     or group_row.payer_cpf is distinct from normalized_payer_cpf
     or group_row.primary_registration_id is null then
    raise exception using errcode = '55000', message = 'O grupo local da inscrição é divergente.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(registration) order by registration.created_at, registration.id), '[]'::jsonb)
    into registrations
  from public.tournament_registrations as registration
  where registration.registration_group_id = group_row.id;

  if group_row.total_amount > 0 then
    if invite_mode then
      raise exception using errcode = '55000', message = 'Um convite não pode gerar cobrança.';
    end if;
    if normalized_provider_environment not in ('SANDBOX', 'PRODUCTION') then
      raise exception using errcode = '22023', message = 'Ambiente do provedor inválido.';
    end if;

    -- Recreate the durable local intent for legacy groups that were committed
    -- before the old Edge flow managed to insert their payment. A true probe
    -- miss already returned above, so this repair can only use a persisted,
    -- locked group's authoritative amount and primary registration.
    if payment_row.id is null then
      if existing_group.id is not null
         and group_row.status not in ('PENDING', 'OVERDUE') then
        raise exception using errcode = '55000', message = 'O grupo pago sem cobrança local precisa de revisão.';
      end if;

      insert into public.tournament_payments (
        tournament_id,
        registration_id,
        registration_group_id,
        provider,
        provider_environment,
        external_reference,
        billing_type,
        status,
        amount,
        expires_at
      ) values (
        p_tournament_id,
        group_row.primary_registration_id,
        group_row.id,
        'ASAAS',
        normalized_provider_environment,
        'tournament-family:' || group_row.id::text,
        normalized_billing_type,
        'CREATED',
        group_row.total_amount,
        group_row.created_at + interval '2 hours'
      )
      on conflict (registration_group_id) where registration_group_id is not null do nothing
      returning * into payment_row;

      if payment_row.id is null then
        select payment.*
          into payment_row
        from public.tournament_payments as payment
        where payment.registration_group_id = group_row.id
        for update;
      else
        payment_created := true;
      end if;
    end if;

    -- Never hand an expired unpaid intent back to the Edge Function: CREATED
    -- and FAILED rows without a provider id are known not to have a remote
    -- charge and can be archived immediately. Provider-backed or ambiguous
    -- rows must remain for the expiry worker to reconcile/cancel at Asaas, but
    -- are still hidden from this retry so they cannot expose an expired Pix or
    -- start a new provider attempt.
    if existing_group.id is not null
       and group_row.status in ('PENDING', 'OVERDUE')
       and payment_row.status in ('CREATED', 'RECONCILING', 'PENDING', 'FAILED', 'OVERDUE')
       and payment_row.expires_at <= now() then
      if payment_row.provider_payment_id is null
         and payment_row.status in ('CREATED', 'FAILED') then
        if not public.archive_expired_tournament_payment(payment_row.id) then
          raise exception using errcode = '55000', message = 'Não foi possível expirar a inscrição familiar legada.';
        end if;
      end if;

      return jsonb_build_object(
        'found', false,
        'expired', true,
        'registration_group', null,
        'registrations', '[]'::jsonb,
        'payment', null,
        'payment_created', false
      );
    end if;

    -- Do not require equality with normalized_provider_environment here: a
    -- retry after an environment rotation must reach the Edge quarantine
    -- path instead of being turned into an opaque checkout conflict.
    if payment_row.id is not null and (
      payment_row.tournament_id is distinct from p_tournament_id
      or payment_row.registration_id is distinct from group_row.primary_registration_id
      or payment_row.registration_group_id is distinct from group_row.id
      or payment_row.provider is distinct from 'ASAAS'
      or payment_row.provider_environment is null
      or payment_row.provider_environment not in ('SANDBOX', 'PRODUCTION', 'UNKNOWN')
      or payment_row.external_reference is distinct from 'tournament-family:' || group_row.id::text
      or payment_row.billing_type is distinct from normalized_billing_type
      or payment_row.amount is distinct from group_row.total_amount
    ) then
      raise exception using errcode = '55000', message = 'A cobrança local da inscrição familiar é divergente.';
    elsif payment_row.id is null then
      raise exception using errcode = '55000', message = 'A cobrança local da inscrição familiar não foi criada.';
    end if;
  else
    if payment_row.id is null then
      -- The group is already locked. A read is sufficient to reject an
      -- impossible free-group payment without introducing group -> payment
      -- lock inversion against the financial workers.
      select payment.*
        into payment_row
      from public.tournament_payments as payment
      where payment.registration_group_id = group_row.id;
    end if;

    if payment_row.id is not null then
      raise exception using errcode = '55000', message = 'Uma inscrição isenta não pode possuir cobrança.';
    end if;
  end if;

  return claim_result || jsonb_build_object(
    'found', true,
    'registration_group', jsonb_build_object(
      'id', group_row.id,
      'public_token', group_row.public_token,
      'status', group_row.status,
      'total_amount', group_row.total_amount,
      'primary_registration_id', group_row.primary_registration_id
    ),
    'registrations', registrations,
    'payment', case when payment_row.id is null then null else to_jsonb(payment_row) end,
    'payment_created', payment_created
  );
end;
$$;

revoke all on function public.claim_public_tournament_family_checkout(
  uuid, uuid, text, text, text, text, jsonb, text, text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.claim_public_tournament_family_checkout(
  uuid, uuid, text, text, text, text, jsonb, text, text, text, boolean
) to service_role;

comment on function public.claim_public_tournament_family_checkout(
  uuid, uuid, text, text, text, text, jsonb, text, text, text, boolean
) is 'Atomically resolves family athletes, claims registrations or an invitation, and creates one local Pix intent.';

commit;
