-- Rebuild the Ilha Play onboarding around complete registration and club approval.

alter table public.app_clients
  add column if not exists birth_date date,
  add column if not exists declared_lesson_slots jsonb not null default '[]'::jsonb;

alter table public.app_clients
  drop constraint if exists app_clients_birth_date_check;
alter table public.app_clients
  add constraint app_clients_birth_date_check
  check (
    birth_date is null
    or birth_date >= date '1900-01-01'
  ) not valid;

alter table public.app_clients
  drop constraint if exists app_clients_declared_lesson_slots_check;
alter table public.app_clients
  add constraint app_clients_declared_lesson_slots_check
  check (jsonb_typeof(declared_lesson_slots) = 'array') not valid;

create table if not exists public.app_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_push_subscriptions_user_idx
  on public.app_push_subscriptions(user_id, enabled);

alter table public.app_push_subscriptions enable row level security;

grant select, insert, update, delete on table public.app_push_subscriptions to authenticated;
grant select, insert, update, delete on table public.app_push_subscriptions to service_role;
revoke all on table public.app_push_subscriptions from anon;

drop policy if exists "clients manage own push subscriptions" on public.app_push_subscriptions;
create policy "clients manage own push subscriptions"
on public.app_push_subscriptions for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create or replace function public.handle_new_app_client()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  declared_plan public.app_plans%rowtype;
  requested_slots jsonb := coalesce(new.raw_user_meta_data -> 'declared_lesson_slots', '[]'::jsonb);
begin
  if coalesce(new.raw_user_meta_data ->> 'app_context', 'public') <> 'public' then
    return new;
  end if;

  if jsonb_typeof(requested_slots) <> 'array' then
    requested_slots := '[]'::jsonb;
  end if;

  select * into declared_plan
  from public.app_plans
  where code = nullif(new.raw_user_meta_data ->> 'declared_plan_code', '')
    and active = true;

  insert into public.app_clients (
    id,
    full_name,
    email,
    phone,
    cpf,
    birth_date,
    guardian_name,
    guardian_phone,
    status,
    client_type,
    declared_plan_code,
    declared_plan_name,
    declared_lesson_slots,
    registration_completed_at,
    email_verified_at
  ) values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, ''), '@', 1), 'Cliente Ilha'),
    coalesce(new.email, ''),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '\D', '', 'g'), ''),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'cpf', ''), '\D', '', 'g'), ''),
    nullif(new.raw_user_meta_data ->> 'birth_date', '')::date,
    nullif(new.raw_user_meta_data ->> 'guardian_name', ''),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'guardian_phone', ''), '\D', '', 'g'), ''),
    'PENDENTE',
    'cliente',
    declared_plan.code,
    declared_plan.name,
    requested_slots,
    now(),
    new.email_confirmed_at
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        phone = excluded.phone,
        cpf = excluded.cpf,
        birth_date = excluded.birth_date,
        guardian_name = excluded.guardian_name,
        guardian_phone = excluded.guardian_phone,
        status = 'PENDENTE',
        declared_plan_code = excluded.declared_plan_code,
        declared_plan_name = excluded.declared_plan_name,
        declared_lesson_slots = excluded.declared_lesson_slots,
        registration_completed_at = excluded.registration_completed_at,
        email_verified_at = coalesce(excluded.email_verified_at, public.app_clients.email_verified_at),
        updated_at = now();

  return new;
end;
$$;

revoke all on function public.handle_new_app_client() from public, anon, authenticated;

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
    coalesce(nullif(p_full_name, ''), auth.jwt() -> 'user_metadata' ->> 'full_name', split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), 'Cliente Ilha'),
    coalesce(auth.jwt() ->> 'email', ''),
    coalesce(nullif(p_phone, ''), auth.jwt() -> 'user_metadata' ->> 'phone'),
    'PENDENTE',
    now()
  )
  on conflict (id) do update
    set full_name = coalesce(nullif(p_full_name, ''), public.app_clients.full_name),
        phone = coalesce(nullif(p_phone, ''), public.app_clients.phone),
        email = excluded.email,
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
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  normalized_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  normalized_guardian_phone text := regexp_replace(coalesce(p_guardian_phone, ''), '\D', '', 'g');
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
  if current_auth_user.email_confirmed_at is null then
    raise exception 'Confirme seu e-mail antes de continuar.' using errcode = '42501';
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
    id, full_name, email, phone, cpf, birth_date, guardian_name, guardian_phone,
    status, declared_plan_code, declared_plan_name, declared_lesson_slots,
    email_verified_at, registration_completed_at, last_login_at
  ) values (
    auth.uid(), trim(p_full_name), coalesce(current_auth_user.email, ''), normalized_phone, normalized_cpf,
    p_birth_date, nullif(trim(coalesce(p_guardian_name, '')), ''), nullif(normalized_guardian_phone, ''),
    'PENDENTE', declared_plan.code, declared_plan.name, coalesce(p_declared_lesson_slots, '[]'::jsonb),
    current_auth_user.email_confirmed_at, now(), now()
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        phone = excluded.phone,
        cpf = excluded.cpf,
        birth_date = excluded.birth_date,
        guardian_name = excluded.guardian_name,
        guardian_phone = excluded.guardian_phone,
        status = 'PENDENTE',
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

revoke all on function public.complete_current_app_registration(text, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_current_app_registration(text, text, text, text, date, jsonb, text, text) from public, anon;
grant execute on function public.complete_current_app_registration(text, text, text, text, date, jsonb, text, text) to authenticated;

create or replace function public.approve_app_client(p_client_id uuid)
returns public.app_clients
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  approved_client public.app_clients%rowtype;
  required_lessons integer;
begin
  if auth.uid() is null or not public.is_club_office() then
    raise exception 'Somente a equipe autorizada pode aprovar clientes.' using errcode = '42501';
  end if;

  select * into approved_client from public.app_clients where id = p_client_id;
  if approved_client.id is null then
    raise exception 'Cliente não encontrado.' using errcode = 'P0002';
  end if;

  required_lessons := case
    when coalesce(approved_client.declared_plan_code, '') like '%_2x' then 2
    when coalesce(approved_client.declared_plan_code, '') like '%_1x' then 1
    else 0
  end;

  if approved_client.birth_date is null
    or not public.is_valid_cpf(approved_client.cpf)
    or length(regexp_replace(coalesce(approved_client.phone, ''), '\D', '', 'g')) < 10
    or length(trim(coalesce(approved_client.full_name, ''))) < 5
    or jsonb_array_length(coalesce(approved_client.declared_lesson_slots, '[]'::jsonb)) < required_lessons then
    raise exception 'Complete os dados obrigatórios antes de aprovar o acesso.' using errcode = '22023';
  end if;

  update public.app_clients
  set status = 'ATIVO', updated_at = now()
  where id = p_client_id
  returning * into approved_client;

  return approved_client;
end;
$$;

revoke all on function public.approve_app_client(uuid) from public, anon;
grant execute on function public.approve_app_client(uuid) to authenticated;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.app_clients_before_reset_20260817
as select * from public.app_clients with no data;
create table if not exists private.app_plan_requests_before_reset_20260817
as select * from public.app_plan_requests with no data;

insert into private.app_clients_before_reset_20260817
select c.* from public.app_clients c
join auth.users u on u.id = c.id
where coalesce(u.raw_user_meta_data ->> 'app_context', 'public') = 'public';

insert into private.app_plan_requests_before_reset_20260817
select r.* from public.app_plan_requests r
join auth.users u on u.id = r.client_id
where coalesce(u.raw_user_meta_data ->> 'app_context', 'public') = 'public';

insert into public.app_announcements (title, body, link_url, target_type, active, published_at)
select
  'O novo Ilha Play chegou',
  'O acesso antigo foi encerrado. Faça seu novo cadastro para reservar quadras e usar os serviços do clube. Depois do cadastro, a equipe do Ilha aprovará seu acesso.',
  'https://app.ilhatenis.com/',
  'todos',
  true,
  now()
where not exists (
  select 1 from public.app_announcements where title = 'O novo Ilha Play chegou'
);
