-- Logical deletion only: keep Auth, financial records and the existing backup.
alter table public.app_clients add column if not exists registration_deleted_at timestamptz;

create or replace function public.delete_pending_client_registration(p_client_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  client_row public.app_clients%rowtype;
  outcome jsonb;
begin
  if (select auth.uid()) is null
     or public.current_user_role() is distinct from 'admin'
     or not coalesce(public.has_club_permission('clients.write'), false) then
    raise exception 'Somente um administrador pode excluir cadastros pendentes.' using errcode = '42501';
  end if;
  -- Use the same lock order as reset/restore to avoid concurrent changes.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app-client-reset:' || p_client_id::text, 0));
  select * into client_row from public.app_clients where id = p_client_id for update;
  if not found then
    raise exception 'Cadastro não encontrado.' using errcode = 'P0002';
  end if;
  if client_row.registration_deleted_at is not null then
    return jsonb_build_object('removed', true, 'already_removed', true);
  end if;
  if upper(coalesce(client_row.status, '')) in ('CANCELADO', 'CANCELADA', 'INATIVO', 'BLOQUEADO')
     or client_row.plan_cancellation_requested_at is not null or client_row.plan_cancel_at is not null
     or (upper(coalesce(client_row.status, '')) <> 'PENDENTE'
         and (client_row.official_plan_id is not null or nullif(client_row.official_plan_code, '') is not null
              or nullif(client_row.official_plan_name, '') is not null)) then
    raise exception 'Este cadastro não está mais pendente. Atualize a lista.' using errcode = '55000';
  end if;
  outcome := public.reset_app_client_account_with_backup(p_client_id, 'Exclusão de cadastro pendente pelo ADM.');
  update public.app_clients set registration_deleted_at = now() where id = p_client_id;
  return outcome || jsonb_build_object('removed', true);
end;
$$;
revoke all on function public.delete_pending_client_registration(uuid) from public, anon;
grant execute on function public.delete_pending_client_registration(uuid) to authenticated;

-- A new completed registration or a backup restoration makes it visible again.
create or replace function private.reopen_deleted_client_registration()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.registration_deleted_at := null;
  return new;
end;
$$;
create trigger reopen_deleted_client_registration
before update of registration_completed_at, declared_plan_code, declared_plan_name on public.app_clients
for each row when (old.registration_deleted_at is not null)
execute function private.reopen_deleted_client_registration();
