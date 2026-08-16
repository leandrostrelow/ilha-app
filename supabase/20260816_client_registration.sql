-- Complete and verified Ilha Play client registration.

alter table public.app_clients
  add column if not exists declared_plan_code text,
  add column if not exists declared_plan_name text,
  add column if not exists registration_completed_at timestamptz,
  add column if not exists email_verified_at timestamptz;

create or replace function public.is_valid_cpf(p_cpf text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  digits text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  total integer := 0;
  first_digit integer;
  second_digit integer;
  position integer;
begin
  if length(digits) <> 11 or digits ~ '^(\d)\1{10}$' then
    return false;
  end if;

  for position in 1..9 loop
    total := total + substr(digits, position, 1)::integer * (11 - position);
  end loop;
  first_digit := (total * 10) % 11;
  if first_digit = 10 then first_digit := 0; end if;
  if first_digit <> substr(digits, 10, 1)::integer then return false; end if;

  total := 0;
  for position in 1..10 loop
    total := total + substr(digits, position, 1)::integer * (12 - position);
  end loop;
  second_digit := (total * 10) % 11;
  if second_digit = 10 then second_digit := 0; end if;

  return second_digit = substr(digits, 11, 1)::integer;
end;
$$;

alter table public.app_clients
  drop constraint if exists app_clients_cpf_valid_check;
alter table public.app_clients
  add constraint app_clients_cpf_valid_check
  check (cpf is null or public.is_valid_cpf(cpf)) not valid;

create unique index if not exists app_clients_cpf_unique_idx
  on public.app_clients ((regexp_replace(cpf, '\D', '', 'g')))
  where length(regexp_replace(coalesce(cpf, ''), '\D', '', 'g')) = 11;

create or replace function public.handle_new_app_client()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  declared_plan public.app_plans%rowtype;
begin
  if coalesce(new.raw_user_meta_data ->> 'app_context', 'public') = 'admin' then
    return new;
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
    client_type,
    declared_plan_code,
    declared_plan_name,
    email_verified_at
  ) values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, ''), '@', 1), 'Cliente Ilha'),
    coalesce(new.email, ''),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '\D', '', 'g'), ''),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'cpf', ''), '\D', '', 'g'), ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'client_type', ''), 'cliente'),
    declared_plan.code,
    declared_plan.name,
    new.email_confirmed_at
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        phone = coalesce(excluded.phone, public.app_clients.phone),
        cpf = coalesce(excluded.cpf, public.app_clients.cpf),
        declared_plan_code = coalesce(excluded.declared_plan_code, public.app_clients.declared_plan_code),
        declared_plan_name = coalesce(excluded.declared_plan_name, public.app_clients.declared_plan_name),
        email_verified_at = coalesce(excluded.email_verified_at, public.app_clients.email_verified_at),
        updated_at = now();

  return new;
end;
$$;

create or replace function public.complete_current_app_registration(
  p_full_name text,
  p_phone text,
  p_cpf text,
  p_declared_plan_code text default null
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
begin
  if auth.uid() is null then
    raise exception 'Entre novamente para concluir o cadastro.' using errcode = '42501';
  end if;

  select * into current_auth_user
  from auth.users
  where id = auth.uid();

  if current_auth_user.email_confirmed_at is null then
    raise exception 'Confirme o código enviado ao seu e-mail.' using errcode = '42501';
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

  if nullif(p_declared_plan_code, '') is not null then
    select * into declared_plan
    from public.app_plans
    where code = p_declared_plan_code
      and active = true;

    if declared_plan.id is null then
      raise exception 'Escolha um plano válido.' using errcode = '22023';
    end if;
  end if;

  insert into public.app_clients (
    id,
    full_name,
    email,
    phone,
    cpf,
    declared_plan_code,
    declared_plan_name,
    email_verified_at,
    registration_completed_at,
    last_login_at
  ) values (
    auth.uid(),
    trim(p_full_name),
    coalesce(current_auth_user.email, ''),
    normalized_phone,
    normalized_cpf,
    declared_plan.code,
    declared_plan.name,
    current_auth_user.email_confirmed_at,
    now(),
    now()
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        phone = excluded.phone,
        cpf = excluded.cpf,
        declared_plan_code = excluded.declared_plan_code,
        declared_plan_name = excluded.declared_plan_name,
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

revoke all on function public.complete_current_app_registration(text, text, text, text) from public, anon;
grant execute on function public.complete_current_app_registration(text, text, text, text) to authenticated;
