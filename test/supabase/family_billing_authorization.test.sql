begin;
do $$
declare
  target public.app_family_members%rowtype;
  other_member record;
  admin_id uuid;
  candidate record;
  result jsonb;
  expected numeric;
  month_start date := (date_trunc('month',now()) + interval '2 months')::date;
begin
  select p.id into admin_id from public.profiles p join auth.users u on u.id=p.id
    join public.protected_access_accounts a on a.email=lower(trim(u.email)) and a.active and a.role=p.role
    where p.active and p.role='admin' limit 1;
  select * into target from public.app_family_members where status='ATIVO'
    and responsible_confirmation_required and requested_by_client_id is null limit 1;
  if admin_id is null or target.id is null then raise exception 'Missing integration test fixture'; end if;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.admin_authorize_family_billing(target.id,target.updated_at);
    raise exception 'Unauthorized call accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  update public.app_family_members set birth_date=null,cpf=null,minor_without_cpf_declared=false,
    responsible_confirmed_at=null,monthly_amount=37,billing_authorized_at=null,billing_authorized_by=null
    where id=target.id returning * into target;
  begin
    perform public.admin_authorize_family_billing(target.id,target.updated_at - interval '1 second');
    raise exception 'Stale call accepted';
  exception when serialization_failure then null; end;
  result := public.admin_authorize_family_billing(target.id,target.updated_at);
  if result->>'billing_authorized_at' is null or result->>'billing_authorized_by' <> admin_id::text
    or not (result->>'responsible_confirmation_required')::boolean or result->>'responsible_confirmed_at' is not null then
    raise exception 'Authorization incorrectly changed details confirmation';
  end if;
  for other_member in select * from public.app_family_members where billing_responsible_id=target.billing_responsible_id
    and status='ATIVO' and id<>target.id loop
    update public.app_family_members set monthly_amount=coalesce(monthly_amount,0) where id=other_member.id returning * into other_member;
    perform public.admin_authorize_family_billing(other_member.id,other_member.updated_at);
  end loop;
  select * into candidate from private.monthly_billing_candidates(month_start,target.billing_responsible_id);
  select c.plan_amount + coalesce(sum(m.monthly_amount),0) into expected from public.app_clients c
    left join public.app_family_members m on m.billing_responsible_id=c.id and m.status='ATIVO'
    where c.id=target.billing_responsible_id group by c.id;
  if candidate.reason='FAMILY_MEMBER_CONFIRMATION_PENDING' or candidate.amount is distinct from expected then
    raise exception 'Authorized member excluded from monthly amount';
  end if;
  if not exists (select 1 from public.app_family_member_audit where family_member_id=target.id
    and actor_id=admin_id and new_data->>'billing_authorized_at' is not null) then raise exception 'Missing audit'; end if;
  perform public.admin_set_app_monthly_billing_enrollment(target.billing_responsible_id,true,'CASH');
  perform public.admin_generate_manual_app_monthly_billing(month_start,target.billing_responsible_id);
  if not exists (select 1 from public.app_family_invoice_items item join public.app_payment_invoices invoice on invoice.id=item.invoice_id
    where invoice.client_id=target.billing_responsible_id and invoice.invoice_month=month_start
    and item.family_member_id=target.id and item.amount=37 and invoice.amount=expected) then
    raise exception 'Manual invoice omitted the authorized member';
  end if;
  update public.app_family_members set monthly_amount=38 where id=target.id returning * into target;
  if target.billing_authorized_at is not null then raise exception 'Changed price retained authorization'; end if;
end;
$$;
rollback;
