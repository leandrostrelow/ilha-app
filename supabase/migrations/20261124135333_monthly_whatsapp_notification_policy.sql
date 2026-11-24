begin;

-- The policy is opt-in. All contact material is available only to the service
-- coordinator; neither client RPCs nor the public schema expose this audit.
create table private.monthly_whatsapp_notification_policy (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
insert into private.monthly_whatsapp_notification_policy(singleton) values(true);
create index monthly_whatsapp_policy_actor_idx on private.monthly_whatsapp_notification_policy(updated_by);

create table private.monthly_whatsapp_policy_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id),
  reason text not null check(length(reason) between 10 and 400),
  old_enabled boolean not null,
  new_enabled boolean not null,
  created_at timestamptz not null default clock_timestamp()
);
create index monthly_whatsapp_policy_audit_actor_idx on private.monthly_whatsapp_policy_audit(actor_id);

create table private.monthly_whatsapp_customer_audit (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.app_clients(id),
  actor_id uuid references auth.users(id),
  provider_environment text not null check(provider_environment in ('PRODUCTION','SANDBOX')),
  provider_customer_id text,
  target_version text not null,
  status text not null check(status in ('APPLIED','BLOCKED','FAILED')),
  before_config jsonb,
  after_config jsonb,
  error_code text,
  created_at timestamptz not null default clock_timestamp()
);
create index monthly_whatsapp_customer_audit_client_idx on private.monthly_whatsapp_customer_audit(client_id,created_at desc);
create index monthly_whatsapp_customer_audit_actor_idx on private.monthly_whatsapp_customer_audit(actor_id);

alter table private.monthly_whatsapp_notification_policy enable row level security;
alter table private.monthly_whatsapp_policy_audit enable row level security;
alter table private.monthly_whatsapp_customer_audit enable row level security;
revoke all on private.monthly_whatsapp_notification_policy,private.monthly_whatsapp_policy_audit,private.monthly_whatsapp_customer_audit from public,anon,authenticated,service_role;

create function private.monthly_whatsapp_finance_actor(p_actor_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.profiles p join auth.users u on u.id=p.id
    join public.protected_access_accounts a on a.email=lower(trim(u.email)) and a.role=p.role and a.active
    where p.id=p_actor_id and p.active and (p.role='admin' or
      (coalesce(p.permissions,'[]'::jsonb)?'finance.write' and coalesce(a.permissions,'[]'::jsonb)?'finance.write'))
  );
$$;
revoke all on function private.monthly_whatsapp_finance_actor(uuid) from public,anon,authenticated,service_role;

create function private.monthly_whatsapp_mobile(p_phone text)
returns text language plpgsql immutable set search_path='' as $$
declare phone text:=regexp_replace(coalesce(p_phone,''),'\D','','g');
begin
  if length(phone)=13 and left(phone,2)='55' then phone:=substr(phone,3); end if;
  if phone !~ '^[1-9][0-9]9[0-9]{8}$' or not(left(phone,2)=any(array[
    '11','12','13','14','15','16','17','18','19','21','22','24','27','28',
    '31','32','33','34','35','37','38','41','42','43','44','45','46','47','48','49',
    '51','53','54','55','61','62','63','64','65','66','67','68','69','71','73','74','75','77','79',
    '81','82','83','84','85','86','87','88','89','91','92','93','94','95','96','97','98','99']))
  then return null; end if;
  return phone;
end;
$$;
revoke all on function private.monthly_whatsapp_mobile(text) from public,anon,authenticated,service_role;

create function public.get_monthly_whatsapp_policy()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Acesso negado.' using errcode='42501'; end if;
  return (select jsonb_build_object('enabled',enabled,'updatedAt',updated_at)
    from private.monthly_whatsapp_notification_policy where singleton);
end;
$$;

create function public.set_monthly_whatsapp_policy(p_actor_id uuid,p_enabled boolean,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old_enabled boolean;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' or not private.monthly_whatsapp_finance_actor(p_actor_id)
  then raise exception 'Seu acesso não permite configurar avisos financeiros.' using errcode='42501'; end if;
  if p_enabled is null or length(trim(coalesce(p_reason,''))) not between 10 and 400
  then raise exception 'Informe a política e o motivo da alteração.' using errcode='22023'; end if;
  select enabled into strict old_enabled from private.monthly_whatsapp_notification_policy where singleton for update;
  if old_enabled is distinct from p_enabled then
    insert into private.monthly_whatsapp_policy_audit(actor_id,reason,old_enabled,new_enabled)
    values(p_actor_id,trim(p_reason),old_enabled,p_enabled);
    update private.monthly_whatsapp_notification_policy set enabled=p_enabled,updated_by=p_actor_id,updated_at=clock_timestamp() where singleton;
  end if;
  return public.get_monthly_whatsapp_policy();
end;
$$;

create function public.get_monthly_whatsapp_target(p_client_id uuid,p_provider_environment text default 'PRODUCTION')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  c public.app_clients%rowtype; m public.app_payment_customers%rowtype;
  policy_enabled boolean; family_count integer; dependants integer;
  related_payer uuid; contact_phone text; recipient_kind text:='PAYER';
  blocked text; target_version text; family_version jsonb; is_minor boolean;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if p_provider_environment is null or p_provider_environment not in ('PRODUCTION','SANDBOX')
  then raise exception 'Ambiente inválido.' using errcode='22023'; end if;
  select enabled into strict policy_enabled from private.monthly_whatsapp_notification_policy where singleton;
  select * into c from public.app_clients where id=p_client_id;
  if not found then return jsonb_build_object('state','BLOCKED','reason','CLIENT_NOT_FOUND','clientId',p_client_id,'policyEnabled',policy_enabled); end if;
  select * into m from public.app_payment_customers where client_id=c.id and provider='ASAAS' and provider_environment=p_provider_environment;
  select count(*),min(billing_responsible_id::text)::uuid into dependants,related_payer
    from public.app_family_members where member_client_id=c.id and billing_responsible_id<>c.id and status in('ATIVO','PENDENTE');
  select count(*) into family_count from public.app_family_members where billing_responsible_id=c.id and status in('ATIVO','PENDENTE');
  select coalesce(jsonb_agg(jsonb_build_array(id,updated_at,billing_responsible_id,member_client_id,status,contact_responsible_phone) order by id),'[]'::jsonb)
    into family_version from public.app_family_members where billing_responsible_id=c.id or member_client_id=c.id;
  is_minor:=coalesce(c.birth_date>(now() at time zone 'America/Sao_Paulo')::date-interval '18 years',c.age<18,false);
  contact_phone:=private.monthly_whatsapp_mobile(c.phone);
  if is_minor then recipient_kind:='GUARDIAN'; contact_phone:=private.monthly_whatsapp_mobile(c.guardian_phone); end if;
  blocked:=case
    when c.status<>'ATIVO' or c.registration_deleted_at is not null then 'CLIENT_NOT_ACTIVE'
    when dependants>1 then 'AMBIGUOUS_FAMILY_PAYER'
    when dependants=1 then 'FAMILY_DEPENDENT'
    when not coalesce(public.is_valid_cpf(c.cpf),false) then 'INVALID_PAYER_CPF'
    when c.birth_date is not null and c.birth_date>(now() at time zone 'America/Sao_Paulo')::date then 'INVALID_BIRTH_DATE'
    when is_minor and (contact_phone is null or length(trim(coalesce(c.guardian_name,'')))<3) then 'GUARDIAN_CONTACT_REQUIRED'
    when contact_phone is null then 'MOBILE_PHONE_REQUIRED'
    when family_count>0 and exists(select 1 from public.app_family_members f where f.billing_responsible_id=c.id and f.status in('ATIVO','PENDENTE')
      and nullif(trim(f.contact_responsible_phone),'') is not null and private.monthly_whatsapp_mobile(f.contact_responsible_phone) is distinct from contact_phone) then 'FAMILY_CONTACT_MISMATCH'
    when m.id is not null and (m.status<>'ACTIVE' or nullif(m.provider_customer_id,'') is null) then 'CUSTOMER_MAPPING_NOT_ACTIVE'
    when m.provider_customer_id is not null and exists(select 1 from public.app_payment_customers other where other.client_id<>c.id and other.provider='ASAAS'
      and other.provider_environment=p_provider_environment and other.provider_customer_id=m.provider_customer_id) then 'AMBIGUOUS_PROVIDER_CUSTOMER'
    when exists(select 1 from public.app_invoice_provider_payments p join public.app_payment_invoices i on i.id=p.invoice_id
      where i.client_id=c.id and i.status in('ABERTA','AGUARDANDO','VENCIDA') and i.superseded_at is null
      and p.provider_environment=p_provider_environment and p.provider_customer_id is not null and p.provider_customer_id is distinct from m.provider_customer_id) then 'INVOICE_CUSTOMER_MISMATCH'
    else null end;
  target_version:=md5(jsonb_build_array(c.id,c.updated_at,c.cpf,contact_phone,recipient_kind,m.id,m.updated_at,m.provider_customer_id,family_version)::text);
  return jsonb_build_object('state',case when blocked is null then 'READY' else 'BLOCKED' end,'reason',blocked,
    'clientId',c.id,'payerClientId',case when dependants=1 then related_payer else c.id end,
    'isFamily',family_count>0,'isMinor',is_minor,'recipientKind',recipient_kind,
    -- Even blocked targets retain identity for a verified fail-closed provider
    -- disable. The service must never expose these fields in its UI response.
    'name',c.full_name,'cpf',regexp_replace(coalesce(c.cpf,''),'\D','','g'),
    'phone',case when blocked is null then contact_phone else null end,
    'providerCustomerId',m.provider_customer_id,'mappingStatus',m.status,
    'targetVersion',target_version,'policyEnabled',policy_enabled);
end;
$$;

create function public.list_monthly_whatsapp_targets(p_after_client_id uuid default null,p_limit integer default 10,p_provider_environment text default 'PRODUCTION')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ids uuid[]; chosen uuid; targets jsonb:='[]'::jsonb; last_id uuid; has_more boolean;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 10 or p_provider_environment is null or p_provider_environment not in('PRODUCTION','SANDBOX')
  then raise exception 'Confira o ambiente e o tamanho do lote.' using errcode='22023'; end if;
  select array_agg(id order by id) into ids from (
    select c.id from public.app_clients c where (p_after_client_id is null or c.id>p_after_client_id)
    and (exists(select 1 from public.app_payment_customers m where m.client_id=c.id and m.provider='ASAAS' and m.provider_environment=p_provider_environment)
      or exists(select 1 from public.app_monthly_billing_enrollments e where e.client_id=c.id and e.enabled)
      or exists(select 1 from public.app_payment_invoices i where i.client_id=c.id and i.status in('ABERTA','AGUARDANDO','VENCIDA') and i.superseded_at is null))
    order by c.id limit p_limit+1
  ) candidates;
  has_more:=coalesce(cardinality(ids),0)>p_limit;
  foreach chosen in array coalesce(ids[1:p_limit],'{}'::uuid[]) loop
    targets:=targets||jsonb_build_array(public.get_monthly_whatsapp_target(chosen,p_provider_environment)); last_id:=chosen;
  end loop;
  return jsonb_build_object('targets',targets,'nextCursor',case when has_more then last_id else null end,'hasMore',has_more);
end;
$$;

-- Never store remote responses, customer details, headers, URLs or tokens.
create function private.monthly_whatsapp_safe_config(p_config jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb:='{}'::jsonb; entries jsonb:='[]'::jsonb; entry jsonb; clean jsonb; key text;
begin
  if p_config is null then return null; end if;
  if jsonb_typeof(p_config)<>'object' or octet_length(p_config::text)>32768
  then raise exception 'Configuração de avisos inválida.' using errcode='22023'; end if;
  if jsonb_typeof(p_config->'notificationDisabled')='boolean' then result:=jsonb_build_object('notificationDisabled',p_config->'notificationDisabled'); end if;
  if p_config?'notifications' then
    if jsonb_typeof(p_config->'notifications')<>'array' or jsonb_array_length(p_config->'notifications')>50
    then raise exception 'Lista de avisos inválida.' using errcode='22023'; end if;
    for entry in select value from jsonb_array_elements(p_config->'notifications') loop
      clean:='{}'::jsonb;
      if jsonb_typeof(entry)<>'object' then raise exception 'Aviso inválido.' using errcode='22023'; end if;
      if entry->>'id' ~ '^[A-Za-z0-9_-]{1,100}$' then clean:=clean||jsonb_build_object('id',entry->>'id'); end if;
      if entry->>'event' ~ '^[A-Z][A-Z0-9_]{0,99}$' then clean:=clean||jsonb_build_object('event',entry->>'event'); end if;
      if jsonb_typeof(entry->'scheduleOffset')='number' and entry->>'scheduleOffset' ~ '^-?[0-9]{1,3}$'
      then clean:=clean||jsonb_build_object('scheduleOffset',(entry->>'scheduleOffset')::integer); end if;
      foreach key in array array['enabled','emailEnabledForCustomer','smsEnabledForCustomer','whatsappEnabledForCustomer','phoneCallEnabledForCustomer',
        'emailEnabledForProvider','smsEnabledForProvider','whatsappEnabledForProvider','phoneCallEnabledForProvider'] loop
        if jsonb_typeof(entry->key)='boolean' then clean:=clean||jsonb_build_object(key,entry->key); end if;
      end loop;
      entries:=entries||jsonb_build_array(clean);
    end loop;
    result:=result||jsonb_build_object('notifications',entries);
  end if;
  return result;
end;
$$;
revoke all on function private.monthly_whatsapp_safe_config(jsonb) from public,anon,authenticated,service_role;

create function public.record_monthly_whatsapp_result(
  p_client_id uuid,p_actor_id uuid,p_environment text,p_customer_id text,p_target_version text,p_status text,
  p_before_config jsonb,p_after_config jsonb,p_error_code text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_target jsonb; audit_id uuid; policy_enabled boolean;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' or (p_actor_id is not null and not private.monthly_whatsapp_finance_actor(p_actor_id))
  then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if p_status is null or p_status not in('APPLIED','BLOCKED','FAILED') or p_environment is null or p_environment not in('PRODUCTION','SANDBOX')
    or p_target_version is null or p_target_version !~ '^[a-f0-9]{32}$'
    or (p_customer_id is not null and p_customer_id !~ '^[A-Za-z0-9_-]{1,100}$')
    or (p_error_code is not null and p_error_code !~ '^[A-Z][A-Z0-9_]{0,99}$')
  then raise exception 'Resultado de configuração inválido.' using errcode='22023'; end if;
  -- Match the payer and policy again after the provider round-trip. A concurrent
  -- change must make the coordinator disable delivery before recording FAILED.
  select enabled into strict policy_enabled from private.monthly_whatsapp_notification_policy where singleton for share;
  perform 1 from public.app_clients where id=p_client_id for share;
  if not found then raise exception 'Cliente não encontrado.' using errcode='P0002'; end if;
  perform 1 from public.app_payment_customers where client_id=p_client_id and provider='ASAAS' and provider_environment=p_environment for share;
  perform 1 from public.app_family_members where billing_responsible_id=p_client_id or member_client_id=p_client_id order by id for share;
  current_target:=public.get_monthly_whatsapp_target(p_client_id,p_environment);
  if p_status='APPLIED' and (not policy_enabled or current_target->>'state' is distinct from 'READY'
    or current_target->>'targetVersion' is distinct from p_target_version or nullif(p_customer_id,'') is null
    or current_target->>'providerCustomerId' is distinct from p_customer_id)
  then raise exception 'Política, contato ou vínculo alterado; desative os avisos e confira novamente.' using errcode='40001'; end if;
  insert into private.monthly_whatsapp_customer_audit(client_id,actor_id,provider_environment,provider_customer_id,target_version,status,before_config,after_config,error_code)
  values(p_client_id,p_actor_id,p_environment,p_customer_id,p_target_version,p_status,
    private.monthly_whatsapp_safe_config(p_before_config),private.monthly_whatsapp_safe_config(p_after_config),p_error_code)
  returning id into audit_id;
  return jsonb_build_object('auditId',audit_id,'status',p_status);
end;
$$;

revoke all on function public.get_monthly_whatsapp_policy(),public.set_monthly_whatsapp_policy(uuid,boolean,text),
 public.get_monthly_whatsapp_target(uuid,text),public.list_monthly_whatsapp_targets(uuid,integer,text),
 public.record_monthly_whatsapp_result(uuid,uuid,text,text,text,text,jsonb,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.get_monthly_whatsapp_policy(),public.set_monthly_whatsapp_policy(uuid,boolean,text),
 public.get_monthly_whatsapp_target(uuid,text),public.list_monthly_whatsapp_targets(uuid,integer,text),
 public.record_monthly_whatsapp_result(uuid,uuid,text,text,text,text,jsonb,jsonb,text) to service_role;

commit;
