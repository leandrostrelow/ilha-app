begin;
alter table public.app_family_members
  add column billing_authorized_at timestamptz,
  add column billing_authorized_by uuid references auth.users(id) on delete set null;

create function private.guard_family_billing_authorization()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and (new.billing_authorized_at is not null or new.billing_authorized_by is not null))
     or (tg_op = 'UPDATE' and (new.billing_authorized_at is distinct from old.billing_authorized_at
       or new.billing_authorized_by is distinct from old.billing_authorized_by)) then
    if (select auth.uid()) is null or not coalesce(public.has_club_permission('finance.write'), false) then
      raise exception 'Seu acesso não permite liberar cobrança familiar.' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' and (new.billing_responsible_id is distinct from old.billing_responsible_id
    or new.monthly_amount is distinct from old.monthly_amount or new.status is distinct from old.status) then
    new.billing_authorized_at := null;
    new.billing_authorized_by := null;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_family_billing_authorization() from public, anon, authenticated;
create trigger guard_family_billing_authorization before insert or update on public.app_family_members
for each row execute function private.guard_family_billing_authorization();

create function private.admin_authorize_family_billing_impl(p_family_member_id uuid, p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare member public.app_family_members%rowtype;
begin
  if (select auth.uid()) is null or not coalesce(public.has_club_permission('finance.write'), false) then
    raise exception 'Seu acesso não permite liberar cobrança familiar.' using errcode = '42501';
  end if;
  select * into member from public.app_family_members where id=p_family_member_id for update;
  if not found or member.status <> 'ATIVO' then
    raise exception 'Aprove o vínculo familiar antes de liberar a cobrança.' using errcode = '22023';
  end if;
  if p_expected_updated_at is null or member.updated_at is distinct from p_expected_updated_at then
    raise exception 'O cadastro mudou. Reabra a ficha e confira o valor novamente.' using errcode = '40001';
  end if;
  if member.monthly_amount is null then
    raise exception 'Defina o valor do membro. Use zero se já estiver incluído no plano do responsável.' using errcode = '22023';
  end if;
  update public.app_family_members set billing_authorized_at=now(), billing_authorized_by=(select auth.uid())
    where id=member.id returning * into member;
  return to_jsonb(member);
end;
$$;
revoke all on function private.admin_authorize_family_billing_impl(uuid,timestamptz) from public, anon, authenticated, service_role;
grant execute on function private.admin_authorize_family_billing_impl(uuid,timestamptz) to authenticated;
create function public.admin_authorize_family_billing(p_family_member_id uuid, p_expected_updated_at timestamptz)
returns jsonb language sql security invoker set search_path = '' as $$
select private.admin_authorize_family_billing_impl(p_family_member_id,p_expected_updated_at);
$$;
revoke all on function public.admin_authorize_family_billing(uuid,timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.admin_authorize_family_billing(uuid,timestamptz) to authenticated;

-- Keep the existing financial snapshot/reconciliation checks. Only extend the
-- family eligibility predicate in all three billing paths, never confirmation.
do $$
declare signature text; definition text;
begin
  foreach signature in array array[
    'private.monthly_billing_candidates(date,uuid)',
    'public.generate_app_monthly_pix_billing(date,uuid,text)',
    'public.admin_generate_manual_app_monthly_billing(date,uuid)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position('or member.responsible_confirmed_at is not null' in definition)=0 then
      raise exception 'Unexpected billing definition: %',signature;
    end if;
    definition := replace(definition, 'or member.responsible_confirmed_at is not null',
      'or member.responsible_confirmed_at is not null or member.billing_authorized_at is not null');
    definition := replace(definition, 'and member.responsible_confirmed_at is null',
      'and member.responsible_confirmed_at is null and member.billing_authorized_at is null');
    execute definition;
  end loop;
end;
$$;
commit;
