-- Rollback-only integration test: no confirmation or financial change persists.
begin;
do $$
declare
  target public.app_family_members%rowtype;
  admin_id uuid;
  result jsonb;
begin
  select p.id into admin_id from public.profiles p join auth.users u on u.id=p.id
    join public.protected_access_accounts a on a.email=lower(trim(u.email)) and a.active and a.role=p.role
    where p.active and p.role='admin' limit 1;
  if admin_id is null then raise exception 'Test requires an active admin'; end if;
  select * into target from public.app_family_members
    where status='ATIVO' and responsible_confirmation_required and requested_by_client_id is null limit 1;
  if target.id is null then raise exception 'Test requires a pending manual member'; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.admin_confirm_family_member(target.id,target.updated_at);
    raise exception 'Anonymous confirmation was allowed';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  begin
    perform public.admin_confirm_family_member(target.id,target.updated_at - interval '1 second');
    raise exception 'Stale snapshot was accepted';
  exception when serialization_failure then null; end;
  update public.app_family_members set birth_date=null, cpf=null, minor_without_cpf_declared=false
    where id=target.id returning * into target;
  begin
    perform public.admin_confirm_family_member(target.id,target.updated_at);
    raise exception 'Incomplete member was accepted';
  exception when invalid_parameter_value then null; end;
  update public.app_family_members set birth_date=date '1990-01-01'
    where id=target.id returning * into target;
  begin
    perform public.admin_confirm_family_member(target.id,target.updated_at);
    raise exception 'Adult without CPF was accepted';
  exception when invalid_parameter_value then null; end;
  update public.app_family_members set birth_date=current_date - interval '10 years'
    where id=target.id returning * into target;
  result := public.admin_confirm_family_member(target.id,target.updated_at);
  if (result->>'responsible_confirmation_required')::boolean or result->>'responsible_confirmed_at' is null then
    raise exception 'Confirmation failed';
  end if;
  if not exists (select 1 from public.app_family_member_audit where family_member_id=target.id
    and actor_id=admin_id and (old_data->>'responsible_confirmation_required')::boolean
    and not (new_data->>'responsible_confirmation_required')::boolean) then
    raise exception 'Audit actor/snapshot missing';
  end if;
  if has_function_privilege('anon','public.admin_confirm_family_member(uuid,timestamptz)','EXECUTE') then
    raise exception 'Anonymous RPC grant';
  end if;
end;
$$;
rollback;
