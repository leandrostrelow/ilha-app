begin;
alter table public.app_family_members
  add column billing_paused boolean not null default false,
  add column billing_pause_reason text;

create table private.family_billing_pause_audit (
  id uuid primary key default gen_random_uuid(),
  family_member_id uuid not null,
  actor_id uuid not null,
  previous_paused boolean not null,
  paused boolean not null,
  contracted_amount numeric(10,2),
  reason text not null,
  created_at timestamptz not null default now()
);
revoke all on private.family_billing_pause_audit from public, anon, authenticated, service_role;

create function private.guard_family_billing_pause()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (tg_op='INSERT' and (new.billing_paused or new.billing_pause_reason is not null))
     or (tg_op='UPDATE' and (new.billing_paused is distinct from old.billing_paused
          or new.billing_pause_reason is distinct from old.billing_pause_reason)) then
    if auth.uid() is null or not coalesce(public.has_club_permission('finance.write'),false) then
      raise exception 'Seu acesso não permite pausar cobrança familiar.' using errcode='42501';
    end if;
    if length(trim(coalesce(new.billing_pause_reason,''))) not between 5 and 500 then
      raise exception 'Informe um motivo de 5 a 500 caracteres.' using errcode='22023';
    end if;
    insert into private.family_billing_pause_audit(family_member_id,actor_id,previous_paused,paused,contracted_amount,reason)
    values(new.id,auth.uid(),case when tg_op='INSERT' then false else old.billing_paused end,
      new.billing_paused,new.monthly_amount,trim(new.billing_pause_reason));
  end if;
  return new;
end;
$$;
revoke all on function private.guard_family_billing_pause() from public,anon,authenticated,service_role;
create trigger guard_family_billing_pause before insert or update on public.app_family_members
for each row execute function private.guard_family_billing_pause();

create function private.admin_set_family_billing_paused_impl(
  p_family_member_id uuid,p_paused boolean,p_expected_updated_at timestamptz,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare member public.app_family_members%rowtype;
begin
  if auth.uid() is null or not coalesce(public.has_club_permission('finance.write'),false) then
    raise exception 'Seu acesso não permite pausar cobrança familiar.' using errcode='42501';
  end if;
  select * into member from public.app_family_members where id=p_family_member_id for update;
  if not found or member.status<>'ATIVO' then
    raise exception 'O vínculo familiar precisa estar ativo.' using errcode='22023';
  end if;
  if p_expected_updated_at is null or member.updated_at is distinct from p_expected_updated_at then
    raise exception 'O cadastro mudou. Reabra a ficha e confira o valor novamente.' using errcode='40001';
  end if;
  if p_paused is null or length(trim(coalesce(p_reason,''))) not between 5 and 500 then
    raise exception 'Informe a operação e um motivo de 5 a 500 caracteres.' using errcode='22023';
  end if;
  if not p_paused and member.monthly_amount is null then
    raise exception 'Defina o valor contratado antes de retomar a cobrança.' using errcode='22023';
  end if;
  if member.billing_paused=p_paused then return to_jsonb(member); end if;
  update public.app_family_members set billing_paused=p_paused,billing_pause_reason=trim(p_reason)
    where id=member.id returning * into member;
  return to_jsonb(member);
end;
$$;
revoke all on function private.admin_set_family_billing_paused_impl(uuid,boolean,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function private.admin_set_family_billing_paused_impl(uuid,boolean,timestamptz,text) to authenticated;
create function public.admin_set_family_billing_paused(p_family_member_id uuid,p_paused boolean,p_expected_updated_at timestamptz,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$
select private.admin_set_family_billing_paused_impl(p_family_member_id,p_paused,p_expected_updated_at,p_reason);
$$;
revoke all on function public.admin_set_family_billing_paused(uuid,boolean,timestamptz,text) from public,anon,service_role;
grant execute on function public.admin_set_family_billing_paused(uuid,boolean,timestamptz,text) to authenticated;

-- Exclude paused members from new billing snapshots and eligibility checks.
-- Keep their relationship, student profile, contracted price and old invoices.
do $$
declare signature text; definition text;
begin
  foreach signature in array array[
    'private.monthly_billing_candidates_ignoring(date,uuid,uuid)',
    'public.admin_generate_family_invoice(uuid,date,date)',
    'public.generate_app_monthly_pix_billing(date,uuid,text)',
    'public.admin_generate_manual_app_monthly_billing(date,uuid)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if position('member.status = ''ATIVO''' in definition)=0 then
      raise exception 'Unexpected billing definition: %',signature;
    end if;
    definition:=replace(definition,'member.status = ''ATIVO''','member.status = ''ATIVO'' and not member.billing_paused');
    execute definition;
  end loop;
  definition:=pg_get_functiondef('public.prepare_monthly_receipt_batch(uuid,uuid,uuid,jsonb,text,date,text)'::regprocedure);
  if position('billing_responsible_id=p_client_id and status=''ATIVO''' in definition)=0 then
    raise exception 'Unexpected receipt batch definition';
  end if;
  execute replace(definition,'billing_responsible_id=p_client_id and status=''ATIVO''',
    'billing_responsible_id=p_client_id and status=''ATIVO'' and not billing_paused');
  definition:=pg_get_functiondef('private.client_family_summary_data(uuid)'::regprocedure);
  if position('member_total.status = ''ATIVO''' in definition)=0 or position('''monthly_amount'', case' in definition)=0 then
    raise exception 'Unexpected family summary definition';
  end if;
  definition:=replace(definition,'member_total.status = ''ATIVO''','member_total.status = ''ATIVO'' and not member_total.billing_paused');
  definition:=replace(definition,'''monthly_amount'', case','''billing_paused'', member.billing_paused, ''monthly_amount'', case');
  execute definition;
end;
$$;
commit;
