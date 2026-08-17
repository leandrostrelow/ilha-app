-- Client accounts require an explicit club approval before app access.

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
    status,
    client_type,
    declared_plan_code,
    declared_plan_name,
    registration_completed_at,
    email_verified_at
  ) values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, ''), '@', 1), 'Cliente Ilha'),
    coalesce(new.email, ''),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '\D', '', 'g'), ''),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'cpf', ''), '\D', '', 'g'), ''),
    'PENDENTE',
    coalesce(nullif(new.raw_user_meta_data ->> 'client_type', ''), 'cliente'),
    declared_plan.code,
    declared_plan.name,
    now(),
    new.email_confirmed_at
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        phone = coalesce(excluded.phone, public.app_clients.phone),
        cpf = coalesce(excluded.cpf, public.app_clients.cpf),
        declared_plan_code = coalesce(excluded.declared_plan_code, public.app_clients.declared_plan_code),
        declared_plan_name = coalesce(excluded.declared_plan_name, public.app_clients.declared_plan_name),
        registration_completed_at = coalesce(public.app_clients.registration_completed_at, excluded.registration_completed_at),
        email_verified_at = coalesce(excluded.email_verified_at, public.app_clients.email_verified_at),
        updated_at = now();

  return new;
end;
$$;

revoke all on function public.handle_new_app_client() from public, anon, authenticated;

create or replace function public.approve_app_client(p_client_id uuid)
returns public.app_clients
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  approved_client public.app_clients%rowtype;
begin
  if auth.uid() is null or not public.is_club_office() then
    raise exception 'Somente a equipe autorizada pode aprovar clientes.' using errcode = '42501';
  end if;

  update public.app_clients
  set status = 'ATIVO',
      updated_at = now()
  where id = p_client_id
  returning * into approved_client;

  if approved_client.id is null then
    raise exception 'Cliente não encontrado.' using errcode = 'P0002';
  end if;

  return approved_client;
end;
$$;

revoke all on function public.approve_app_client(uuid) from public, anon;
grant execute on function public.approve_app_client(uuid) to authenticated;
