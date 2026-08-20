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
    raise exception 'Somente a equipe autorizada pode liberar clientes.' using errcode = '42501';
  end if;

  update auth.users
     set email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where id = p_client_id;

  if not found then
    raise exception 'Conta de acesso não encontrada.' using errcode = 'P0002';
  end if;

  update public.app_clients
     set status = 'ATIVO',
         email_verified_at = coalesce(email_verified_at, now()),
         updated_at = now()
   where id = p_client_id
   returning * into approved_client;

  if approved_client.id is null then
    raise exception 'Aluno não encontrado.' using errcode = 'P0002';
  end if;

  return approved_client;
end;
$$;

revoke all on function public.approve_app_client(uuid) from public, anon;
grant execute on function public.approve_app_client(uuid) to authenticated;

comment on function public.approve_app_client(uuid) is
  'Libera o cadastro do aluno e confirma a conta Auth em uma única operação restrita à equipe do clube.';
