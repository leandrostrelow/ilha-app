begin;

-- Read-only evidence for customers first created by another Ilha product. This
-- does not adopt a remote customer, rewrite its reference or authorize delivery:
-- the coordinator must additionally inspect every remote payment before use.
create function public.get_monthly_whatsapp_customer_scope(
  p_client_id uuid,p_provider_environment text default 'PRODUCTION'
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  c public.app_clients%rowtype; m public.app_payment_customers%rowtype;
  target jsonb; refs jsonb:='[]'::jsonb; monthly_payments jsonb:='[]'::jsonb;
  other_active boolean:=false; blocked text; scope_version text;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role'
  then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if p_provider_environment is null or p_provider_environment not in('PRODUCTION','SANDBOX')
  then raise exception 'Ambiente inválido.' using errcode='22023'; end if;
  target:=public.get_monthly_whatsapp_target(p_client_id,p_provider_environment);
  select * into c from public.app_clients where id=p_client_id;
  if not found then return jsonb_build_object('state','BLOCKED','reason','CLIENT_NOT_FOUND','clientId',p_client_id); end if;
  select * into m from public.app_payment_customers where client_id=c.id and provider='ASAAS' and provider_environment=p_provider_environment;
  blocked:=case
    when m.id is null or m.status is distinct from 'ACTIVE' or nullif(m.provider_customer_id,'') is null then 'CUSTOMER_MAPPING_NOT_ACTIVE'
    when not coalesce(public.is_valid_cpf(c.cpf),false) then 'INVALID_PAYER_CPF'
    when exists(select 1 from public.app_payment_customers other where other.client_id<>c.id and other.provider='ASAAS'
      and other.provider_environment=p_provider_environment and other.provider_customer_id=m.provider_customer_id) then 'AMBIGUOUS_PROVIDER_CUSTOMER'
    else null end;
  if blocked is null then
    -- A matching prefix alone is never ownership proof. Entity id, customer id
    -- and the same fiscal identity must all match an existing Ilha record.
    select coalesce(jsonb_agg(ref order by ref),'[]'::jsonb) into refs from (
      select 'tournament-athlete:'||a.id as ref from public.tournament_athletes a
      where a.asaas_customer_id=m.provider_customer_id
        and regexp_replace(coalesce(a.cpf,''),'\D','','g')=regexp_replace(c.cpf,'\D','','g')
        and (a.app_client_id is null or a.app_client_id=c.id)
        and exists(select 1 from public.tournament_payments p join public.tournament_registrations r on r.id=p.registration_id
          where r.athlete_id=a.id and p.provider='ASAAS' and p.provider_environment=p_provider_environment and p.provider_customer_id=m.provider_customer_id)
      union
      select 'tournament-family:'||g.id from public.tournament_registration_groups g
      where g.provider_customer_id=m.provider_customer_id
        and regexp_replace(g.payer_cpf,'\D','','g')=regexp_replace(c.cpf,'\D','','g')
        and exists(select 1 from public.tournament_payments p where p.provider='ASAAS' and p.provider_environment=p_provider_environment
          and p.provider_customer_id=m.provider_customer_id and (p.registration_group_id=g.id or p.registration_id=g.primary_registration_id))
    ) known_origins;
    select coalesce(jsonb_agg(jsonb_build_object('providerPaymentId',p.provider_payment_id,'externalReference',p.external_reference)
      order by p.provider_payment_id),'[]'::jsonb) into monthly_payments
    from public.app_invoice_provider_payments p join public.app_payment_invoices i on i.id=p.invoice_id
    where i.client_id=c.id and i.status in('ABERTA','AGUARDANDO','VENCIDA') and i.superseded_at is null
      and p.provider='ASAAS' and p.provider_environment=p_provider_environment and p.provider_customer_id=m.provider_customer_id
      and nullif(p.provider_payment_id,'') is not null
      and p.external_reference='ilha-monthly-invoice:'||i.id;
    other_active:=
      exists(select 1 from public.tournament_payments p where p.provider='ASAAS' and p.provider_environment=p_provider_environment
        and p.provider_customer_id=m.provider_customer_id and p.status not in('RECEIVED','CONFIRMED','REFUNDED','CANCELLED'))
      or exists(select 1 from public.tournament_registration_groups g where g.provider_customer_id=m.provider_customer_id and g.status in('PENDING','OVERDUE'))
      or exists(select 1 from public.tournament_registrations r join public.tournament_athletes a on a.id=r.athlete_id
        where a.asaas_customer_id=m.provider_customer_id and r.status not in('CANCELLED','REFUNDED')
        and r.payment_status not in('PAID','CANCELLED','REFUNDED','NOT_REQUIRED'))
      or exists(select 1 from public.app_store_orders o where o.client_id=c.id and o.provider_environment=p_provider_environment
        and o.payment_flow='CHARGE' and o.status not in('PAID','CANCELLED','REFUNDED'))
      or exists(select 1 from public.bar_event_orders o where regexp_replace(o.buyer_cpf,'\D','','g')=regexp_replace(c.cpf,'\D','','g')
        and o.provider_environment=p_provider_environment and o.total_cents>0 and o.status not in('PAID','CANCELLED','REFUNDED'));
    if other_active then blocked:='OTHER_ACTIVE_PRODUCT'; end if;
  end if;
  scope_version:=md5(jsonb_build_array(target->>'targetVersion',m.provider_customer_id,refs,monthly_payments,other_active,blocked)::text);
  return jsonb_build_object('state',case when blocked is null then 'READY' else 'BLOCKED' end,'reason',blocked,
    'clientId',c.id,'customerId',m.provider_customer_id,'targetVersion',target->>'targetVersion','scopeVersion',scope_version,
    'allowedExternalReferences',refs,'monthlyPayments',monthly_payments,'hasOtherActiveProduct',other_active);
end;
$$;
revoke all on function public.get_monthly_whatsapp_customer_scope(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_monthly_whatsapp_customer_scope(uuid,text) to service_role;

commit;
