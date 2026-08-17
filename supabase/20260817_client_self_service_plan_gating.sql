-- Cadastro com acesso imediato e reservas controladas pelo plano oficial.

drop trigger if exists protect_app_client_official_fields on public.app_clients;
drop function if exists public.protect_app_client_official_fields();
drop function if exists public.approve_app_client(uuid);

update public.app_clients
set status = 'ATIVO', updated_at = now()
where upper(coalesce(status, '')) = 'PENDENTE';

create or replace function public.ensure_current_app_client(
  p_full_name text default null,
  p_phone text default null
)
returns public.app_clients
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  client_row public.app_clients%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  insert into public.app_clients (id, full_name, email, phone, status, last_login_at)
  values (
    auth.uid(),
    coalesce(
      nullif(p_full_name, ''),
      auth.jwt() -> 'user_metadata' ->> 'full_name',
      split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1),
      'Cliente Ilha'
    ),
    coalesce(auth.jwt() ->> 'email', ''),
    coalesce(nullif(p_phone, ''), auth.jwt() -> 'user_metadata' ->> 'phone'),
    'ATIVO',
    now()
  )
  on conflict (id) do update
    set full_name = coalesce(nullif(p_full_name, ''), public.app_clients.full_name),
        phone = coalesce(nullif(p_phone, ''), public.app_clients.phone),
        email = excluded.email,
        status = case
          when upper(coalesce(public.app_clients.status, '')) = 'BLOQUEADO' then 'BLOQUEADO'
          else 'ATIVO'
        end,
        last_login_at = now(),
        updated_at = now()
  returning * into client_row;

  return client_row;
end;
$$;

revoke all on function public.ensure_current_app_client(text, text) from public, anon;
grant execute on function public.ensure_current_app_client(text, text) to authenticated;

create or replace function public.complete_current_app_registration(
  p_full_name text,
  p_phone text,
  p_cpf text,
  p_declared_plan_code text,
  p_birth_date date,
  p_declared_lesson_slots jsonb default '[]'::jsonb,
  p_guardian_name text default null,
  p_guardian_phone text default null
)
returns public.app_clients
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_auth_user auth.users%rowtype;
  declared_plan public.app_plans%rowtype;
  client_row public.app_clients%rowtype;
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '\\D', '', 'g');
  normalized_cpf text := regexp_replace(coalesce(p_cpf, ''), '\\D', '', 'g');
  normalized_guardian_phone text := regexp_replace(coalesce(p_guardian_phone, ''), '\\D', '', 'g');
  required_lessons integer := case
    when coalesce(p_declared_plan_code, '') like '%_2x' then 2
    when coalesce(p_declared_plan_code, '') like '%_1x' then 1
    else 0
  end;
  age_years integer;
begin
  if auth.uid() is null then
    raise exception 'Entre novamente para concluir o cadastro.' using errcode = '42501';
  end if;

  select * into current_auth_user from auth.users where id = auth.uid();
  if current_auth_user.id is null then
    raise exception 'Conta não encontrada. Faça um novo cadastro.' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_full_name, ''))) < 5 or position(' ' in trim(p_full_name)) = 0 then
    raise exception 'Informe seu nome completo.' using errcode = '22023';
  end if;
  if length(normalized_phone) not between 10 and 13 then
    raise exception 'Informe um telefone válido com DDD.' using errcode = '22023';
  end if;
  if not public.is_valid_cpf(normalized_cpf) then
    raise exception 'Informe um CPF válido.' using errcode = '22023';
  end if;
  if p_birth_date is null or p_birth_date > current_date or p_birth_date < current_date - interval '120 years' then
    raise exception 'Informe uma data de nascimento válida.' using errcode = '22023';
  end if;

  age_years := extract(year from age(current_date, p_birth_date));
  if age_years < 18 and (length(trim(coalesce(p_guardian_name, ''))) < 5 or length(normalized_guardian_phone) < 10) then
    raise exception 'Informe o responsável e o telefone para o aluno menor de idade.' using errcode = '22023';
  end if;

  if nullif(p_declared_plan_code, '') is not null then
    select * into declared_plan
    from public.app_plans
    where code = p_declared_plan_code and active = true;
    if declared_plan.id is null then
      raise exception 'Escolha um plano válido.' using errcode = '22023';
    end if;
  end if;

  if jsonb_typeof(coalesce(p_declared_lesson_slots, '[]'::jsonb)) <> 'array' then
    raise exception 'Informe os dias e horários das aulas.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_declared_lesson_slots, '[]'::jsonb)) < required_lessons then
    raise exception 'Informe todos os dias e horários das aulas.' using errcode = '22023';
  end if;

  insert into public.app_clients (
    id, full_name, email, phone, cpf, birth_date, guardian_name, guardian_phone, status,
    declared_plan_code, declared_plan_name, declared_lesson_slots,
    email_verified_at, registration_completed_at, last_login_at
  ) values (
    auth.uid(), trim(p_full_name), coalesce(current_auth_user.email, ''), normalized_phone,
    normalized_cpf, p_birth_date, nullif(trim(coalesce(p_guardian_name, '')), ''),
    nullif(normalized_guardian_phone, ''), 'ATIVO', declared_plan.code, declared_plan.name,
    coalesce(p_declared_lesson_slots, '[]'::jsonb),
    coalesce(current_auth_user.email_confirmed_at, now()), now(), now()
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        phone = excluded.phone,
        cpf = excluded.cpf,
        birth_date = excluded.birth_date,
        guardian_name = excluded.guardian_name,
        guardian_phone = excluded.guardian_phone,
        status = case
          when upper(coalesce(public.app_clients.status, '')) = 'BLOQUEADO' then 'BLOQUEADO'
          else 'ATIVO'
        end,
        declared_plan_code = excluded.declared_plan_code,
        declared_plan_name = excluded.declared_plan_name,
        declared_lesson_slots = excluded.declared_lesson_slots,
        email_verified_at = excluded.email_verified_at,
        registration_completed_at = excluded.registration_completed_at,
        last_login_at = excluded.last_login_at,
        updated_at = now()
  returning * into client_row;

  return client_row;
exception
  when unique_violation then
    raise exception 'Este CPF já está vinculado a outra conta. Fale com a equipe do clube.' using errcode = '23505';
end;
$$;

revoke all on function public.complete_current_app_registration(text, text, text, text, date, jsonb, text, text) from public, anon;
grant execute on function public.complete_current_app_registration(text, text, text, text, date, jsonb, text, text) to authenticated;

create or replace function public.book_my_app_court(
  p_booking_date date,
  p_starts_at time without time zone,
  p_court_name text,
  p_opponent_name text,
  p_notes text default null
)
returns public.app_court_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.app_clients%rowtype;
  v_booking public.app_court_bookings%rowtype;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_is_weekend boolean;
  v_extra_enabled boolean;
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
    raise exception 'Complete seu cadastro para reservar.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.app_plans p
    where p.active = true
      and (
        (v_client.official_plan_id is not null and p.id = v_client.official_plan_id)
        or
        (nullif(v_client.official_plan_code, '') is not null and p.code = v_client.official_plan_code)
      )
  ) then
    raise exception 'Você precisa de um plano ou pacote ativo para reservar quadras.' using errcode = '42501';
  end if;

  if p_booking_date < v_today or p_booking_date > v_today + 45 then
    raise exception 'Escolha uma data disponível na agenda.' using errcode = '22023';
  end if;

  v_is_weekend := extract(isodow from p_booking_date) in (6, 7);
  select coalesce(enabled, false) into v_extra_enabled
  from public.app_court_schedule_days
  where schedule_date = p_booking_date;

  if not v_is_weekend and not coalesce(v_extra_enabled, false) then
    raise exception 'Este dia não está aberto para reservas.' using errcode = '22023';
  end if;

  if p_court_name not in ('Quadra 1', 'Quadra 2')
     or p_starts_at not in (time '14:00', time '15:00', time '16:00', time '17:00', time '18:00', time '19:00', time '20:00') then
    raise exception 'Quadra ou horário inválido.' using errcode = '22023';
  end if;

  if v_is_weekend and p_court_name = 'Quadra 1' and p_starts_at = time '17:00' then
    raise exception 'Este horário possui um bloqueio fixo.' using errcode = '23514';
  end if;

  if length(trim(coalesce(p_opponent_name, ''))) < 2 then
    raise exception 'Informe o nome do adversário.' using errcode = '22023';
  end if;

  insert into public.app_court_bookings (
    client_id, client_name, opponent_name, booking_date, starts_at, court_name, status, notes
  ) values (
    v_client.id, v_client.full_name, trim(p_opponent_name), p_booking_date, p_starts_at,
    p_court_name, 'CONFIRMADO', nullif(trim(coalesce(p_notes, '')), '')
  ) returning * into v_booking;

  return v_booking;
exception
  when unique_violation then
    if exists (
      select 1 from public.app_court_bookings
      where client_id = auth.uid()
        and booking_date = p_booking_date
        and status <> 'CANCELADO'
    ) then
      raise exception 'Você já possui uma reserva neste dia.' using errcode = '23505';
    end if;
    raise exception 'Esse horário acabou de ser reservado. Escolha outro.' using errcode = '23505';
end;
$$;

revoke all on function public.book_my_app_court(date, time without time zone, text, text, text) from public, anon;
grant execute on function public.book_my_app_court(date, time without time zone, text, text, text) to authenticated;

create or replace function public.guard_app_client_entitlements()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user = 'authenticated'
     and auth.uid() = old.id
     and not public.is_club_staff()
     and (
       new.status is distinct from old.status
       or new.client_type is distinct from old.client_type
       or new.source is distinct from old.source
       or new.official_plan_id is distinct from old.official_plan_id
       or new.official_plan_code is distinct from old.official_plan_code
       or new.official_plan_name is distinct from old.official_plan_name
       or new.plan_amount is distinct from old.plan_amount
       or new.weekly_lessons is distinct from old.weekly_lessons
       or new.preferred_days is distinct from old.preferred_days
       or new.due_day is distinct from old.due_day
       or new.registration_completed_at is distinct from old.registration_completed_at
       or new.email_verified_at is distinct from old.email_verified_at
     ) then
    raise exception 'O plano e as permissões desta conta só podem ser alterados pela equipe.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_app_client_entitlements on public.app_clients;
create trigger guard_app_client_entitlements
before update on public.app_clients
for each row execute function public.guard_app_client_entitlements();

revoke all on function public.guard_app_client_entitlements() from public, anon, authenticated;
