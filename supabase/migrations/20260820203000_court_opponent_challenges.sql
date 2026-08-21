begin;

alter table public.app_court_bookings
  drop constraint if exists app_court_bookings_status_check;

alter table public.app_court_bookings
  add constraint app_court_bookings_status_check
  check (status in ('PENDENTE', 'CONFIRMADO', 'CANCELADO', 'BLOQUEADO'));

alter table public.app_court_bookings
  add column if not exists challenge_kind text,
  add column if not exists challenge_expires_at timestamptz,
  add column if not exists challenge_invited_at timestamptz,
  add column if not exists challenge_responded_at timestamptz,
  add column if not exists challenge_invite_version integer not null default 0;

alter table public.app_court_bookings
  drop constraint if exists app_court_bookings_challenge_kind_check;

alter table public.app_court_bookings
  add constraint app_court_bookings_challenge_kind_check
  check (challenge_kind is null or challenge_kind in ('DIRETO', 'ABERTO'));

alter table public.app_court_bookings
  drop constraint if exists app_court_bookings_pending_challenge_check;

alter table public.app_court_bookings
  add constraint app_court_bookings_pending_challenge_check
  check (
    status <> 'PENDENTE'
    or (
      client_id is not null
      and challenge_kind is not null
      and challenge_kind in ('DIRETO', 'ABERTO')
      and challenge_expires_at is not null
      and (
        (challenge_kind = 'DIRETO' and opponent_client_id is not null)
        or (challenge_kind = 'ABERTO' and opponent_client_id is null)
      )
    )
  );

create index if not exists app_court_bookings_pending_challenge_expiry_idx
  on public.app_court_bookings(challenge_expires_at)
  where status = 'PENDENTE';

create or replace function public.create_my_court_challenge(
  p_booking_date date,
  p_starts_at time without time zone,
  p_court_name text,
  p_opponent_client_id uuid default null,
  p_notes text default null
)
returns public.app_court_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.app_clients%rowtype;
  v_opponent public.app_clients%rowtype;
  v_booking public.app_court_bookings%rowtype;
  v_schedule public.app_court_schedule_days%rowtype;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_is_weekend boolean;
  v_day_enabled boolean;
  v_allowed_times time without time zone[] := array[
    time '14:00', time '15:00', time '16:00', time '17:00',
    time '18:00', time '19:00', time '20:00'
  ];
  v_starts_at_tz timestamptz;
  v_expires_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Entre no Ilha Play para chamar um adversário.' using errcode = '42501';
  end if;

  select * into v_client
    from public.app_clients
   where id = auth.uid()
     and upper(coalesce(status, 'ATIVO')) = 'ATIVO'
     and registration_completed_at is not null;

  if v_client.id is null then
    raise exception 'Seu cadastro precisa estar ativo para chamar um adversário.' using errcode = '42501';
  end if;

  if p_booking_date < v_today or p_booking_date > v_today + 45 then
    raise exception 'Escolha uma data disponível na agenda.' using errcode = '22023';
  end if;

  -- Serializa alterações da configuração do dia com novas reservas/desafios.
  perform pg_advisory_xact_lock(
    hashtextextended('court-schedule:' || p_booking_date::text, 0)
  );

  v_is_weekend := extract(isodow from p_booking_date) in (6, 7);
  select * into v_schedule
    from public.app_court_schedule_days
   where schedule_date = p_booking_date;

  v_day_enabled := case
    when v_schedule.schedule_date is not null then coalesce(v_schedule.enabled, false)
    else v_is_weekend
  end;

  if not v_day_enabled then
    raise exception 'Este dia não está aberto para reservas.' using errcode = '22023';
  end if;

  if v_schedule.schedule_date is not null then
    v_allowed_times := coalesce(v_schedule.slot_times, v_allowed_times);
  end if;

  if p_court_name not in ('Quadra 1', 'Quadra 2')
     or not (p_starts_at = any(v_allowed_times)) then
    raise exception 'Quadra ou horário inválido.' using errcode = '22023';
  end if;

  v_starts_at_tz := (p_booking_date + p_starts_at) at time zone 'America/Sao_Paulo';
  if v_starts_at_tz <= now() + interval '12 hours 15 minutes' then
    raise exception 'Para chamar um adversário, escolha um horário com pelo menos 12 horas e 15 minutos de antecedência.' using errcode = '22023';
  end if;
  v_expires_at := now() + interval '12 hours';

  if p_opponent_client_id is not null then
    if p_opponent_client_id = v_client.id then
      raise exception 'Escolha outro aluno para o convite.' using errcode = '22023';
    end if;

    select * into v_opponent
      from public.app_clients opponent
     where opponent.id = p_opponent_client_id
       and upper(coalesce(opponent.status, 'ATIVO')) = 'ATIVO'
       and opponent.registration_completed_at is not null;

    if v_opponent.id is null then
      raise exception 'Esse aluno não está disponível para receber convites.' using errcode = '22023';
    end if;
  end if;

  -- Todos os fluxos de reserva usam a mesma chave por atleta e dia. A ordem
  -- determinística evita deadlock quando duas pessoas se convidam ao mesmo tempo.
  if v_opponent.id is null then
    perform pg_advisory_xact_lock(hashtextextended('court-player:' || v_client.id::text || ':' || p_booking_date::text, 0));
  elsif v_client.id::text < v_opponent.id::text then
    perform pg_advisory_xact_lock(hashtextextended('court-player:' || v_client.id::text || ':' || p_booking_date::text, 0));
    perform pg_advisory_xact_lock(hashtextextended('court-player:' || v_opponent.id::text || ':' || p_booking_date::text, 0));
  else
    perform pg_advisory_xact_lock(hashtextextended('court-player:' || v_opponent.id::text || ':' || p_booking_date::text, 0));
    perform pg_advisory_xact_lock(hashtextextended('court-player:' || v_client.id::text || ':' || p_booking_date::text, 0));
  end if;

  if exists (
    select 1
      from public.app_court_bookings booking
     where booking.booking_date = p_booking_date
       and booking.status <> 'CANCELADO'
       and (booking.client_id = v_client.id or booking.opponent_client_id = v_client.id)
  ) then
    raise exception 'Você já participa de uma reserva ou convite neste dia.' using errcode = '23505';
  end if;

  if v_opponent.id is not null then
    if exists (
      select 1
        from public.app_court_bookings booking
       where booking.booking_date = p_booking_date
         and booking.status <> 'CANCELADO'
         and (booking.client_id = v_opponent.id or booking.opponent_client_id = v_opponent.id)
    ) then
      raise exception 'Esse aluno já participa de uma reserva ou convite neste dia.' using errcode = '23505';
    end if;
  end if;

  insert into public.app_court_bookings (
    client_id,
    client_name,
    opponent_client_id,
    opponent_name,
    booking_date,
    starts_at,
    court_name,
    status,
    notes,
    challenge_kind,
    challenge_expires_at,
    challenge_invited_at,
    challenge_invite_version
  ) values (
    v_client.id,
    trim(v_client.full_name),
    v_opponent.id,
    case when v_opponent.id is null then 'Adversário a definir' else trim(v_opponent.full_name) end,
    p_booking_date,
    p_starts_at,
    p_court_name,
    'PENDENTE',
    nullif(trim(coalesce(p_notes, '')), ''),
    case when v_opponent.id is null then 'ABERTO' else 'DIRETO' end,
    v_expires_at,
    case when v_opponent.id is null then null else now() end,
    case when v_opponent.id is null then 0 else 1 end
  ) returning * into v_booking;

  if v_opponent.id is not null then
    insert into public.app_client_notifications (
      user_id, title, body, link_url, event_type, dedupe_key
    ) values (
      v_opponent.id,
      'Convite para jogar',
      trim(v_client.full_name) || ' convidou você para jogar em ' || p_court_name ||
        ', dia ' || to_char(p_booking_date, 'DD/MM/YYYY') || ' às ' ||
        to_char(p_starts_at, 'HH24:MI') || '. Aceite ou recuse no Ilha Play.',
      '/?view=jogar',
      'CONVITE_QUADRA',
      'court-challenge-invite:' || v_booking.id::text || ':1'
    ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end if;

  return v_booking;
exception
  when unique_violation then
    if exists (
      select 1
        from public.app_court_bookings booking
       where booking.booking_date = p_booking_date
         and booking.status <> 'CANCELADO'
         and (booking.client_id = auth.uid() or booking.opponent_client_id = auth.uid())
    ) then
      raise exception 'Você já participa de uma reserva ou convite neste dia.' using errcode = '23505';
    end if;
    raise exception 'Outra pessoa escolheu esse horário primeiro. A agenda já foi atualizada.' using errcode = '23505';
end;
$$;

-- A reserva direta compartilha os mesmos bloqueios dos desafios. Assim uma
-- reserva comum e um convite concorrentes nunca confirmam o mesmo atleta no dia.
drop function if exists public.book_my_app_court(
  date,
  time without time zone,
  text,
  text,
  text
);

create or replace function public.book_my_app_court(
  p_booking_date date,
  p_starts_at time without time zone,
  p_court_name text,
  p_opponent_name text,
  p_notes text default null::text,
  p_opponent_client_id uuid default null
)
returns public.app_court_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.app_clients%rowtype;
  v_opponent public.app_clients%rowtype;
  v_booking public.app_court_bookings%rowtype;
  v_schedule public.app_court_schedule_days%rowtype;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_is_weekend boolean;
  v_day_enabled boolean;
  v_allowed_times time without time zone[] := array[
    time '14:00', time '15:00', time '16:00', time '17:00',
    time '18:00', time '19:00', time '20:00'
  ];
  v_opponent_name text := trim(coalesce(p_opponent_name, ''));
  v_starts_at_tz timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Entre no Ilha Play para reservar.' using errcode = '42501';
  end if;

  select * into v_client
    from public.app_clients
   where id = auth.uid()
     and upper(coalesce(status, 'ATIVO')) = 'ATIVO'
     and registration_completed_at is not null;

  if v_client.id is null then
    raise exception 'Seu cadastro precisa estar ativo para reservar.' using errcode = '42501';
  end if;

  if p_booking_date < v_today or p_booking_date > v_today + 45 then
    raise exception 'Escolha uma data disponível na agenda.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('court-schedule:' || p_booking_date::text, 0)
  );

  v_is_weekend := extract(isodow from p_booking_date) in (6, 7);
  select * into v_schedule
    from public.app_court_schedule_days
   where schedule_date = p_booking_date;

  v_day_enabled := case
    when v_schedule.schedule_date is not null then coalesce(v_schedule.enabled, false)
    else v_is_weekend
  end;

  if not v_day_enabled then
    raise exception 'Este dia não está aberto para reservas.' using errcode = '22023';
  end if;

  if v_schedule.schedule_date is not null then
    v_allowed_times := coalesce(v_schedule.slot_times, v_allowed_times);
  end if;

  if p_court_name not in ('Quadra 1', 'Quadra 2')
     or not (p_starts_at = any(v_allowed_times)) then
    raise exception 'Quadra ou horário inválido.' using errcode = '22023';
  end if;

  v_starts_at_tz := (p_booking_date + p_starts_at) at time zone 'America/Sao_Paulo';
  if v_starts_at_tz <= now() + interval '30 minutes' then
    raise exception 'Escolha um horário com pelo menos 30 minutos de antecedência.' using errcode = '22023';
  end if;

  if length(v_opponent_name) < 2 then
    raise exception 'Selecione um aluno ativo ou informe o nome do convidado.' using errcode = '22023';
  end if;

  if p_opponent_client_id is not null then
    if p_opponent_client_id = v_client.id then
      raise exception 'Escolha outro aluno para jogar.' using errcode = '22023';
    end if;

    select * into v_opponent
      from public.app_clients opponent
     where opponent.id = p_opponent_client_id
       and upper(coalesce(opponent.status, 'ATIVO')) = 'ATIVO'
       and opponent.registration_completed_at is not null;

    if v_opponent.id is null then
      raise exception 'Esse aluno não está disponível para a reserva.' using errcode = '22023';
    end if;
    v_opponent_name := trim(v_opponent.full_name);
  elsif (
    select count(*)
      from public.app_clients opponent
     where opponent.id <> v_client.id
       and upper(coalesce(opponent.status, 'ATIVO')) = 'ATIVO'
       and opponent.registration_completed_at is not null
       and lower(trim(opponent.full_name)) = lower(v_opponent_name)
  ) = 1 then
    -- Compatibilidade com versões antigas do app: só vincula pelo nome quando
    -- existe exatamente um cadastro correspondente.
    select * into v_opponent
      from public.app_clients opponent
     where opponent.id <> v_client.id
       and upper(coalesce(opponent.status, 'ATIVO')) = 'ATIVO'
       and opponent.registration_completed_at is not null
       and lower(trim(opponent.full_name)) = lower(v_opponent_name)
     limit 1;
  end if;

  if v_opponent.id is null then
    perform pg_advisory_xact_lock(hashtextextended('court-player:' || v_client.id::text || ':' || p_booking_date::text, 0));
  elsif v_client.id::text < v_opponent.id::text then
    perform pg_advisory_xact_lock(hashtextextended('court-player:' || v_client.id::text || ':' || p_booking_date::text, 0));
    perform pg_advisory_xact_lock(hashtextextended('court-player:' || v_opponent.id::text || ':' || p_booking_date::text, 0));
  else
    perform pg_advisory_xact_lock(hashtextextended('court-player:' || v_opponent.id::text || ':' || p_booking_date::text, 0));
    perform pg_advisory_xact_lock(hashtextextended('court-player:' || v_client.id::text || ':' || p_booking_date::text, 0));
  end if;

  if exists (
    select 1 from public.app_court_bookings booking
     where booking.booking_date = p_booking_date
       and booking.status <> 'CANCELADO'
       and (booking.client_id = v_client.id or booking.opponent_client_id = v_client.id)
  ) then
    raise exception 'Você já participa de uma reserva ou convite neste dia.' using errcode = '23505';
  end if;

  if v_opponent.id is not null and exists (
    select 1 from public.app_court_bookings booking
     where booking.booking_date = p_booking_date
       and booking.status <> 'CANCELADO'
       and (booking.client_id = v_opponent.id or booking.opponent_client_id = v_opponent.id)
  ) then
    raise exception 'Esse aluno já participa de uma reserva ou convite neste dia.' using errcode = '23505';
  end if;

  insert into public.app_court_bookings (
    client_id, client_name, opponent_client_id, opponent_name,
    booking_date, starts_at, court_name, status, notes,
    challenge_kind, challenge_expires_at, challenge_invited_at,
    challenge_responded_at, challenge_invite_version
  ) values (
    v_client.id, trim(v_client.full_name), v_opponent.id, v_opponent_name,
    p_booking_date, p_starts_at, p_court_name, 'CONFIRMADO',
    nullif(trim(coalesce(p_notes, '')), ''),
    null, null, null, null, 0
  ) returning * into v_booking;

  return v_booking;
exception
  when unique_violation then
    if exists (
      select 1 from public.app_court_bookings booking
       where booking.booking_date = p_booking_date
         and booking.status <> 'CANCELADO'
         and (booking.client_id = auth.uid() or booking.opponent_client_id = auth.uid())
    ) then
      raise exception 'Você já participa de uma reserva ou convite neste dia.' using errcode = '23505';
    end if;
    raise exception 'Outra pessoa confirmou esse horário primeiro. A agenda já foi atualizada; escolha outro horário.' using errcode = '23505';
end;
$$;

create or replace function public.get_app_court_challenges(
  p_start_date date,
  p_end_date date
)
returns table (
  id uuid,
  client_id uuid,
  client_name text,
  opponent_client_id uuid,
  opponent_name text,
  booking_date date,
  starts_at time without time zone,
  court_name text,
  notes text,
  challenge_kind text,
  challenge_expires_at timestamptz,
  is_owner boolean,
  is_invited boolean,
  can_accept boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Entre no Ilha Play para consultar os convites.' using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.app_clients client
     where client.id = auth.uid()
       and upper(coalesce(client.status, 'ATIVO')) = 'ATIVO'
       and client.registration_completed_at is not null
  ) then
    raise exception 'Seu cadastro precisa estar ativo para consultar os convites.' using errcode = '42501';
  end if;

  if p_start_date is null or p_end_date is null or p_end_date < p_start_date or p_end_date > p_start_date + 45 then
    raise exception 'Período dos convites inválido.' using errcode = '22023';
  end if;

  return query
  select
    booking.id,
    booking.client_id,
    booking.client_name,
    booking.opponent_client_id,
    booking.opponent_name,
    booking.booking_date,
    booking.starts_at,
    booking.court_name,
    booking.notes,
    booking.challenge_kind,
    booking.challenge_expires_at,
    booking.client_id = auth.uid(),
    booking.opponent_client_id = auth.uid(),
    booking.client_id <> auth.uid()
      and (booking.challenge_kind = 'ABERTO' or booking.opponent_client_id = auth.uid())
  from public.app_court_bookings booking
  where booking.status = 'PENDENTE'
    and booking.challenge_expires_at > now()
    and booking.booking_date between p_start_date and p_end_date
    and (
      booking.client_id = auth.uid()
      or booking.opponent_client_id = auth.uid()
      or booking.challenge_kind = 'ABERTO'
    )
  order by booking.booking_date, booking.starts_at, booking.created_at;
end;
$$;

create or replace function public.respond_to_court_challenge(
  p_booking_id uuid,
  p_response text
)
returns public.app_court_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.app_clients%rowtype;
  v_booking public.app_court_bookings%rowtype;
  v_response text := upper(trim(coalesce(p_response, '')));
  v_previous_opponent_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Entre no Ilha Play para responder ao convite.' using errcode = '42501';
  end if;

  if v_response not in ('ACEITAR', 'RECUSAR') then
    raise exception 'Resposta inválida.' using errcode = '22023';
  end if;

  select * into v_client
    from public.app_clients
   where id = auth.uid()
     and upper(coalesce(status, 'ATIVO')) = 'ATIVO'
     and registration_completed_at is not null;

  if v_client.id is null then
    raise exception 'Seu cadastro precisa estar ativo para responder.' using errcode = '42501';
  end if;

  select * into v_booking
    from public.app_court_bookings booking
   where booking.id = p_booking_id;

  if v_booking.id is null or v_booking.status <> 'PENDENTE' then
    raise exception 'Este convite não está mais disponível.' using errcode = 'P0002';
  end if;

  -- Aceite, troca de convidado e reserva direta sempre adquirem as chaves dos
  -- dois atletas antes do bloqueio da linha. A ordem estável evita deadlock
  -- quando o dono troca o convite no mesmo instante em que alguém o aceita.
  if v_response = 'ACEITAR' then
    if v_booking.client_id::text < v_client.id::text then
      perform pg_advisory_xact_lock(hashtextextended('court-player:' || v_booking.client_id::text || ':' || v_booking.booking_date::text, 0));
      perform pg_advisory_xact_lock(hashtextextended('court-player:' || v_client.id::text || ':' || v_booking.booking_date::text, 0));
    else
      perform pg_advisory_xact_lock(hashtextextended('court-player:' || v_client.id::text || ':' || v_booking.booking_date::text, 0));
      perform pg_advisory_xact_lock(hashtextextended('court-player:' || v_booking.client_id::text || ':' || v_booking.booking_date::text, 0));
    end if;
  end if;

  select * into v_booking
    from public.app_court_bookings booking
   where booking.id = p_booking_id
   for update;

  if v_booking.id is null or v_booking.status <> 'PENDENTE' then
    raise exception 'Este convite não está mais disponível.' using errcode = 'P0002';
  end if;

  if v_booking.challenge_expires_at <= now() then
    perform set_config('app.court_challenge_expiry', 'on', true);
    update public.app_court_bookings
       set status = 'CANCELADO',
           opponent_client_id = null,
           opponent_name = 'Adversário a definir',
           updated_at = now()
     where id = v_booking.id
    returning * into v_booking;

    insert into public.app_client_notifications (
      user_id, title, body, link_url, event_type, dedupe_key
    ) values (
      v_booking.client_id,
      'Horário liberado',
      'O convite ficou 12 horas sem confirmação e o horário de ' ||
        to_char(v_booking.booking_date, 'DD/MM/YYYY') || ' às ' ||
        to_char(v_booking.starts_at, 'HH24:MI') || ' foi liberado.',
      '/?view=jogar',
      'CONVITE_QUADRA_EXPIRADO',
      'court-challenge-expired:' || v_booking.id::text
    ) on conflict (dedupe_key) where dedupe_key is not null do nothing;

    return v_booking;
  end if;

  if v_booking.client_id = v_client.id then
    raise exception 'Você não pode aceitar o próprio convite.' using errcode = '22023';
  end if;

  if v_response = 'RECUSAR' then
    if v_booking.challenge_kind <> 'DIRETO' or v_booking.opponent_client_id <> v_client.id then
      raise exception 'Somente a pessoa convidada pode recusar este convite.' using errcode = '42501';
    end if;

    v_previous_opponent_id := v_booking.opponent_client_id;
    update public.app_court_bookings
       set opponent_client_id = null,
           opponent_name = 'Adversário a definir',
           challenge_kind = 'ABERTO',
           challenge_responded_at = now(),
           updated_at = now()
     where id = v_booking.id
    returning * into v_booking;

    insert into public.app_client_notifications (
      user_id, title, body, link_url, event_type, dedupe_key
    ) values (
      v_booking.client_id,
      'Convite recusado',
      trim(v_client.full_name) || ' não poderá jogar. Seu convite agora está aberto para outro adversário até ' ||
        to_char(v_booking.challenge_expires_at at time zone 'America/Sao_Paulo', 'DD/MM às HH24:MI') || '.',
      '/?view=jogar',
      'CONVITE_QUADRA_RECUSADO',
      'court-challenge-rejected:' || v_booking.id::text || ':' || v_previous_opponent_id::text
    ) on conflict (dedupe_key) where dedupe_key is not null do nothing;

    return v_booking;
  end if;

  if v_booking.challenge_kind = 'DIRETO' and v_booking.opponent_client_id <> v_client.id then
    raise exception 'Este convite foi enviado para outra pessoa.' using errcode = '42501';
  end if;

  if exists (
    select 1
      from public.app_court_bookings booking
     where booking.id <> v_booking.id
       and booking.booking_date = v_booking.booking_date
       and booking.status <> 'CANCELADO'
       and (booking.client_id = v_client.id or booking.opponent_client_id = v_client.id)
  ) then
    raise exception 'Você já participa de outra reserva ou convite neste dia.' using errcode = '23505';
  end if;

  update public.app_court_bookings
     set opponent_client_id = v_client.id,
         opponent_name = trim(v_client.full_name),
         status = 'CONFIRMADO',
         challenge_responded_at = now(),
         updated_at = now()
   where id = v_booking.id
     and status = 'PENDENTE'
  returning * into v_booking;

  if v_booking.id is null then
    raise exception 'Outra pessoa aceitou este convite primeiro.' using errcode = '23505';
  end if;

  insert into public.app_client_notifications (
    user_id, title, body, link_url, event_type, dedupe_key
  ) values
    (
      v_booking.client_id,
      'Adversário confirmado',
      trim(v_client.full_name) || ' aceitou jogar com você. ' || v_booking.court_name ||
        ', dia ' || to_char(v_booking.booking_date, 'DD/MM/YYYY') || ' às ' ||
        to_char(v_booking.starts_at, 'HH24:MI') || '.',
      '/?view=jogar',
      'CONVITE_QUADRA_ACEITO',
      'court-challenge-accepted:' || v_booking.id::text || ':owner'
    ),
    (
      v_client.id,
      'Quadra confirmada',
      'Você vai jogar com ' || trim(v_booking.client_name) || ' em ' || v_booking.court_name ||
        ', dia ' || to_char(v_booking.booking_date, 'DD/MM/YYYY') || ' às ' ||
        to_char(v_booking.starts_at, 'HH24:MI') || '.',
      '/?view=jogar',
      'CONVITE_QUADRA_ACEITO',
      'court-challenge-accepted:' || v_booking.id::text || ':opponent'
    )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  return v_booking;
end;
$$;

create or replace function public.reinvite_my_court_challenge(
  p_booking_id uuid,
  p_opponent_client_id uuid default null
)
returns public.app_court_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.app_court_bookings%rowtype;
  v_opponent public.app_clients%rowtype;
  v_previous_opponent_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Entre no Ilha Play para alterar o convite.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.app_clients client
     where client.id = auth.uid()
       and upper(coalesce(client.status, 'ATIVO')) = 'ATIVO'
       and client.registration_completed_at is not null
  ) then
    raise exception 'Seu cadastro precisa estar ativo para alterar o convite.' using errcode = '42501';
  end if;

  select * into v_booking
    from public.app_court_bookings booking
   where booking.id = p_booking_id
     and booking.client_id = auth.uid();

  if v_booking.id is null or v_booking.status <> 'PENDENTE' or v_booking.challenge_expires_at <= now() then
    raise exception 'Este convite não está mais disponível.' using errcode = 'P0002';
  end if;

  if p_opponent_client_id is not null then
    if p_opponent_client_id = auth.uid() then
      raise exception 'Escolha outro aluno para o convite.' using errcode = '22023';
    end if;

    select * into v_opponent
      from public.app_clients opponent
     where opponent.id = p_opponent_client_id
       and upper(coalesce(opponent.status, 'ATIVO')) = 'ATIVO'
       and opponent.registration_completed_at is not null;

    if v_opponent.id is null then
      raise exception 'Esse aluno não está disponível para receber convites.' using errcode = '22023';
    end if;
  end if;

  if v_opponent.id is null then
    perform pg_advisory_xact_lock(hashtextextended('court-player:' || auth.uid()::text || ':' || v_booking.booking_date::text, 0));
  elsif auth.uid()::text < v_opponent.id::text then
    perform pg_advisory_xact_lock(hashtextextended('court-player:' || auth.uid()::text || ':' || v_booking.booking_date::text, 0));
    perform pg_advisory_xact_lock(hashtextextended('court-player:' || v_opponent.id::text || ':' || v_booking.booking_date::text, 0));
  else
    perform pg_advisory_xact_lock(hashtextextended('court-player:' || v_opponent.id::text || ':' || v_booking.booking_date::text, 0));
    perform pg_advisory_xact_lock(hashtextextended('court-player:' || auth.uid()::text || ':' || v_booking.booking_date::text, 0));
  end if;

  select * into v_booking
    from public.app_court_bookings booking
   where booking.id = p_booking_id
     and booking.client_id = auth.uid()
   for update;

  if v_booking.id is null or v_booking.status <> 'PENDENTE' or v_booking.challenge_expires_at <= now() then
    raise exception 'Este convite não está mais disponível.' using errcode = 'P0002';
  end if;

  if v_opponent.id is not null then
    if exists (
      select 1
        from public.app_court_bookings booking
       where booking.id <> v_booking.id
         and booking.booking_date = v_booking.booking_date
         and booking.status <> 'CANCELADO'
         and (booking.client_id = v_opponent.id or booking.opponent_client_id = v_opponent.id)
    ) then
      raise exception 'Esse aluno já participa de uma reserva ou convite neste dia.' using errcode = '23505';
    end if;
  end if;

  v_previous_opponent_id := v_booking.opponent_client_id;

  update public.app_court_bookings
     set opponent_client_id = v_opponent.id,
         opponent_name = case when v_opponent.id is null then 'Adversário a definir' else trim(v_opponent.full_name) end,
         challenge_kind = case when v_opponent.id is null then 'ABERTO' else 'DIRETO' end,
         challenge_invited_at = case when v_opponent.id is null then null else now() end,
         challenge_responded_at = null,
         challenge_invite_version = challenge_invite_version + 1,
         updated_at = now()
   where id = v_booking.id
  returning * into v_booking;

  if v_previous_opponent_id is not null
     and v_previous_opponent_id is distinct from v_booking.opponent_client_id then
    insert into public.app_client_notifications (
      user_id, title, body, link_url, event_type, dedupe_key
    ) values (
      v_previous_opponent_id,
      'Convite alterado',
      trim(v_booking.client_name) || ' alterou o convite de ' ||
        to_char(v_booking.booking_date, 'DD/MM/YYYY') || ' às ' ||
        to_char(v_booking.starts_at, 'HH24:MI') || '. Você não precisa mais responder.',
      '/?view=jogar',
      'CONVITE_QUADRA_ALTERADO',
      'court-challenge-replaced:' || v_booking.id::text || ':' || v_previous_opponent_id::text || ':' || v_booking.challenge_invite_version::text
    ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end if;

  if v_opponent.id is not null then
    insert into public.app_client_notifications (
      user_id, title, body, link_url, event_type, dedupe_key
    ) values (
      v_opponent.id,
      'Convite para jogar',
      trim(v_booking.client_name) || ' convidou você para jogar em ' || v_booking.court_name ||
        ', dia ' || to_char(v_booking.booking_date, 'DD/MM/YYYY') || ' às ' ||
        to_char(v_booking.starts_at, 'HH24:MI') || '. Aceite ou recuse no Ilha Play.',
      '/?view=jogar',
      'CONVITE_QUADRA',
      'court-challenge-invite:' || v_booking.id::text || ':' || v_booking.challenge_invite_version::text
    ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end if;

  return v_booking;
end;
$$;

create or replace function public.cancel_my_app_court_booking(p_booking_id uuid)
returns public.app_court_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.app_court_bookings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Entre no Ilha Play para cancelar.' using errcode = '42501';
  end if;

  update public.app_court_bookings
     set status = 'CANCELADO', updated_at = now()
   where id = p_booking_id
     and (
       (status = 'PENDENTE' and client_id = auth.uid())
       or (
         status = 'CONFIRMADO'
         and (client_id = auth.uid() or opponent_client_id = auth.uid())
       )
     )
  returning * into v_booking;

  if v_booking.id is null then
    raise exception 'Reserva ou convite não encontrado.' using errcode = 'P0002';
  end if;

  return v_booking;
end;
$$;

create or replace function public.notify_app_court_booking_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
  v_other_name text;
begin
  if tg_op = 'INSERT'
     and new.status = 'CONFIRMADO'
     and new.opponent_client_id is not null then
    insert into public.app_client_notifications (
      user_id, title, body, link_url, event_type, dedupe_key
    ) values (
      new.opponent_client_id,
      'Nova reserva com você',
      trim(coalesce(new.client_name, 'Um aluno')) || ' marcou ' || new.court_name ||
        ' com você para ' || to_char(new.booking_date, 'DD/MM/YYYY') || ' às ' ||
        to_char(new.starts_at, 'HH24:MI') || '.',
      '/?view=jogar',
      'QUADRA_MARCADA',
      'court-booked:' || new.id::text || ':' || new.opponent_client_id::text
    ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
  elsif tg_op = 'UPDATE'
        and old.status <> 'CANCELADO'
        and new.status = 'CANCELADO' then
    if coalesce(current_setting('app.court_admin_configure', true), '') = 'on' then
      return new;
    end if;

    if old.status = 'PENDENTE'
       and coalesce(current_setting('app.court_challenge_expiry', true), '') = 'on' then
      return new;
    end if;

    if old.status = 'PENDENTE' then
      if auth.uid() = old.client_id then
        v_recipient := old.opponent_client_id;
        v_other_name := old.client_name;
      elsif auth.uid() = old.opponent_client_id then
        v_recipient := old.client_id;
        v_other_name := old.opponent_name;
      else
        insert into public.app_client_notifications (
          user_id, title, body, link_url, event_type, dedupe_key
        )
        select
          participant.user_id,
          'Convite cancelado',
          'O convite de ' || old.court_name || ' em ' ||
            to_char(old.booking_date, 'DD/MM/YYYY') || ' às ' ||
            to_char(old.starts_at, 'HH24:MI') || ' foi cancelado pelo clube.',
          '/?view=jogar',
          'QUADRA_CANCELADA',
          'court-cancelled:' || old.id::text || ':' || participant.user_id::text
        from (
          select old.client_id as user_id
          union
          select old.opponent_client_id
        ) participant
        where participant.user_id is not null
        on conflict (dedupe_key) where dedupe_key is not null do nothing;
        return new;
      end if;
    elsif auth.uid() = old.opponent_client_id then
      v_recipient := old.client_id;
      v_other_name := old.opponent_name;
    elsif auth.uid() = old.client_id then
      v_recipient := old.opponent_client_id;
      v_other_name := old.client_name;
    elsif old.status = 'CONFIRMADO' then
      insert into public.app_client_notifications (
        user_id, title, body, link_url, event_type, dedupe_key
      )
      select
        participant.user_id,
        'Reserva de quadra cancelada',
        'A reserva de ' || old.court_name || ' em ' ||
          to_char(old.booking_date, 'DD/MM/YYYY') || ' às ' ||
          to_char(old.starts_at, 'HH24:MI') || ' foi cancelada pelo clube.',
        '/?view=jogar',
        'QUADRA_CANCELADA',
        'court-cancelled:' || old.id::text || ':' || participant.user_id::text
      from (
        select old.client_id as user_id
        union
        select old.opponent_client_id
      ) participant
      where participant.user_id is not null
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
      return new;
    end if;

    if v_recipient is not null then
      insert into public.app_client_notifications (
        user_id, title, body, link_url, event_type, dedupe_key
      ) values (
        v_recipient,
        case when old.status = 'PENDENTE' then 'Convite cancelado' else 'Reserva de quadra cancelada' end,
        trim(coalesce(v_other_name, 'O outro jogador')) || ' cancelou ' || old.court_name ||
          ' de ' || to_char(old.booking_date, 'DD/MM/YYYY') || ' às ' ||
          to_char(old.starts_at, 'HH24:MI') || '. O horário foi liberado.',
        '/?view=jogar',
        'QUADRA_CANCELADA',
        'court-cancelled:' || old.id::text || ':' || v_recipient::text
      ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.expire_court_challenges()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking record;
  v_expired integer := 0;
begin
  perform set_config('app.court_challenge_expiry', 'on', true);

  for v_booking in
    select booking.*
      from public.app_court_bookings booking
     where booking.status = 'PENDENTE'
       and booking.challenge_expires_at <= now()
     order by booking.challenge_expires_at
     for update skip locked
  loop
    update public.app_court_bookings
       set status = 'CANCELADO',
           opponent_client_id = null,
           opponent_name = 'Adversário a definir',
           updated_at = now()
     where id = v_booking.id;

    insert into public.app_client_notifications (
      user_id, title, body, link_url, event_type, dedupe_key
    ) values (
      v_booking.client_id,
      'Horário liberado',
      'O convite ficou 12 horas sem confirmação e o horário de ' ||
        to_char(v_booking.booking_date, 'DD/MM/YYYY') || ' às ' ||
        to_char(v_booking.starts_at, 'HH24:MI') || ' foi disponibilizado novamente.',
      '/?view=jogar',
      'CONVITE_QUADRA_EXPIRADO',
      'court-challenge-expired:' || v_booking.id::text
    ) on conflict (dedupe_key) where dedupe_key is not null do nothing;

    if v_booking.opponent_client_id is not null then
      insert into public.app_client_notifications (
        user_id, title, body, link_url, event_type, dedupe_key
      ) values (
        v_booking.opponent_client_id,
        'Convite encerrado',
        'O convite de ' || trim(v_booking.client_name) || ' expirou sem confirmação.',
        '/?view=jogar',
        'CONVITE_QUADRA_EXPIRADO',
        'court-challenge-expired:' || v_booking.id::text || ':invitee'
      ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;

    v_expired := v_expired + 1;
  end loop;

  return v_expired;
end;
$$;

-- O bloqueio administrativo usa a mesma chave por data das reservas. Isso
-- impede que uma reserva seja criada enquanto o clube desabilita o dia.
create or replace function public.admin_configure_app_court_day(
  p_schedule_date date,
  p_enabled boolean,
  p_notes text default null,
  p_slot_times time without time zone[] default null
)
returns table (
  user_id uuid,
  title text,
  body text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant record;
  v_title text := 'Reserva de quadra cancelada';
  v_body text;
  v_times time without time zone[] := coalesce(
    p_slot_times,
    array[
      time '14:00', time '15:00', time '16:00', time '17:00',
      time '18:00', time '19:00', time '20:00'
    ]
  );
begin
  if auth.uid() is null or not public.is_club_office() then
    raise exception 'Acesso não autorizado.' using errcode = '42501';
  end if;

  if p_schedule_date is null then
    raise exception 'Informe a data.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('court-schedule:' || p_schedule_date::text, 0)
  );

  insert into public.app_court_schedule_days (schedule_date, enabled, notes, slot_times)
  values (
    p_schedule_date,
    coalesce(p_enabled, false),
    nullif(trim(coalesce(p_notes, '')), ''),
    v_times
  )
  on conflict (schedule_date) do update
    set enabled = excluded.enabled,
        notes = excluded.notes,
        slot_times = excluded.slot_times;

  if coalesce(p_enabled, false) then
    return;
  end if;

  v_body := 'Sua reserva de ' || to_char(p_schedule_date, 'DD/MM/YYYY') ||
    ' foi cancelada porque o clube bloqueou esse dia' ||
    case
      when nullif(trim(coalesce(p_notes, '')), '') is not null
        then ': ' || trim(p_notes) || '.'
      else '.'
    end;

  for v_participant in
    select distinct participant.user_id
      from public.app_court_bookings booking
      cross join lateral (
        select booking.client_id as user_id
        union
        select booking.opponent_client_id
      ) participant
     where booking.booking_date = p_schedule_date
       and booking.status <> 'CANCELADO'
       and participant.user_id is not null
  loop
    insert into public.app_client_notifications (
      user_id, title, body, link_url, event_type, dedupe_key
    ) values (
      v_participant.user_id,
      v_title,
      v_body,
      '/?view=notifications',
      'QUADRA_CANCELADA',
      'court-day-cancelled:' || p_schedule_date::text || ':' || v_participant.user_id::text
    ) on conflict (dedupe_key) where dedupe_key is not null do nothing;

    user_id := v_participant.user_id;
    title := v_title;
    body := v_body;
    return next;
  end loop;

  perform set_config('app.court_admin_configure', 'on', true);
  update public.app_court_bookings
     set status = 'CANCELADO',
         challenge_kind = case when status = 'PENDENTE' then null else challenge_kind end,
         challenge_expires_at = case when status = 'PENDENTE' then null else challenge_expires_at end,
         updated_at = now()
   where booking_date = p_schedule_date
     and status <> 'CANCELADO';
end;
$$;

-- Mantém a exclusão de conta compatível com convites ainda pendentes. Primeiro
-- libera os horários; depois as FKs podem aplicar ON DELETE SET NULL.
create or replace function public.delete_app_client_account(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'Somente administradores podem excluir alunos.' using errcode = '42501';
  end if;

  if p_client_id is null then
    raise exception 'Aluno inválido.' using errcode = '22023';
  end if;

  if p_client_id = auth.uid() then
    raise exception 'Você não pode excluir sua própria conta administrativa.' using errcode = '42501';
  end if;

  if exists (select 1 from public.profiles where id = p_client_id) then
    raise exception 'Contas da equipe não podem ser excluídas pela ficha de alunos.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.app_clients where id = p_client_id) then
    raise exception 'Aluno não encontrado.' using errcode = 'P0002';
  end if;

  update public.app_court_bookings
     set status = 'CANCELADO',
         challenge_kind = case when status = 'PENDENTE' then null else challenge_kind end,
         challenge_expires_at = case when status = 'PENDENTE' then null else challenge_expires_at end,
         updated_at = now()
   where status <> 'CANCELADO'
     and (client_id = p_client_id or opponent_client_id = p_client_id);

  delete from auth.users where id = p_client_id;
end;
$$;

revoke all on function public.create_my_court_challenge(date, time without time zone, text, uuid, text) from public, anon;
revoke all on function public.book_my_app_court(date, time without time zone, text, text, text, uuid) from public, anon;
revoke all on function public.get_app_court_challenges(date, date) from public, anon;
revoke all on function public.respond_to_court_challenge(uuid, text) from public, anon;
revoke all on function public.reinvite_my_court_challenge(uuid, uuid) from public, anon;
revoke all on function public.cancel_my_app_court_booking(uuid) from public, anon;
revoke all on function public.expire_court_challenges() from public, anon, authenticated;

grant execute on function public.create_my_court_challenge(date, time without time zone, text, uuid, text) to authenticated;
grant execute on function public.book_my_app_court(date, time without time zone, text, text, text, uuid) to authenticated;
grant execute on function public.get_app_court_challenges(date, date) to authenticated;
grant execute on function public.respond_to_court_challenge(uuid, text) to authenticated;
grant execute on function public.reinvite_my_court_challenge(uuid, uuid) to authenticated;
grant execute on function public.cancel_my_app_court_booking(uuid) to authenticated;
grant execute on function public.expire_court_challenges() to service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
    from cron.job
   where jobname = 'ilha-play-court-challenge-expiry';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end;
$$;

select cron.schedule(
  'ilha-play-court-challenge-expiry',
  '* * * * *',
  'select public.expire_court_challenges();'
);

commit;
