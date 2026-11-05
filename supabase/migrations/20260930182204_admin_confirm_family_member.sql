begin;

-- Staff confirmation uses the existing family audit trigger (actor + old/new
-- snapshot + timestamp). It neither activates memberships nor issues invoices.
create function private.admin_confirm_family_member_impl(
  p_family_member_id uuid, p_expected_updated_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  member public.app_family_members%rowtype;
begin
  if (select auth.uid()) is null or not coalesce(public.has_club_permission('clients.write'), false) then
    raise exception 'Seu acesso não permite confirmar membros familiares.' using errcode = '42501';
  end if;
  select * into member from public.app_family_members where id = p_family_member_id for update;
  if not found or member.status not in ('ATIVO', 'PENDENTE') then
    raise exception 'Membro não disponível para confirmação.' using errcode = '22023';
  end if;
  if p_expected_updated_at is null or member.updated_at is distinct from p_expected_updated_at then
    raise exception 'Os dados deste membro mudaram. Reabra a ficha e revise novamente.' using errcode = '40001';
  end if;
  if not member.responsible_confirmation_required then return to_jsonb(member); end if;
  if member.birth_date is null and member.cpf is null and not member.minor_without_cpf_declared then
    raise exception 'Edite o membro e informe CPF ou nascimento antes de confirmar.' using errcode = '22023';
  end if;
  if member.birth_date <= ((now() at time zone 'America/Sao_Paulo')::date - interval '18 years')::date and member.cpf is null then
    raise exception 'Edite o membro e informe o CPF do adulto antes de confirmar.' using errcode = '22023';
  end if;
  -- Existing validation trigger also enforces valid CPF, dates and contacts.
  update public.app_family_members set responsible_confirmation_required = false,
    responsible_confirmed_at = now() where id = member.id returning * into member;
  return to_jsonb(member);
end;
$$;
revoke all on function private.admin_confirm_family_member_impl(uuid,timestamptz) from public, anon, authenticated, service_role;
grant execute on function private.admin_confirm_family_member_impl(uuid,timestamptz) to authenticated;

create function public.admin_confirm_family_member(p_family_member_id uuid, p_expected_updated_at timestamptz)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.admin_confirm_family_member_impl(p_family_member_id, p_expected_updated_at);
$$;
revoke all on function public.admin_confirm_family_member(uuid,timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.admin_confirm_family_member(uuid,timestamptz) to authenticated;
commit;
