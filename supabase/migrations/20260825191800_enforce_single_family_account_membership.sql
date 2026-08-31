begin;

-- A client account can be either the payer of one family or a member of one
-- family, never both at the same time. UI filters already prevent this, but the
-- invariant belongs in Postgres so direct REST/RPC calls cannot create cycles.
create or replace function private.enforce_single_family_account_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status not in ('PENDENTE', 'ATIVO') then
    return new;
  end if;

  if exists (
    select 1
      from public.app_family_members as existing_member
     where existing_member.id <> new.id
       and existing_member.member_client_id = new.billing_responsible_id
       and existing_member.status in ('PENDENTE', 'ATIVO')
  ) then
    raise exception 'Este responsável já pertence a outra família.'
      using errcode = '23514';
  end if;

  if new.member_client_id is not null and exists (
    select 1
      from public.app_family_members as existing_family
     where existing_family.id <> new.id
       and existing_family.billing_responsible_id = new.member_client_id
       and existing_family.status in ('PENDENTE', 'ATIVO')
  ) then
    raise exception 'Este membro já é responsável financeiro por outra família.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_single_family_account_membership()
  from public, anon, authenticated, service_role;

drop trigger if exists enforce_single_family_account_membership_trigger
  on public.app_family_members;
create trigger enforce_single_family_account_membership_trigger
before insert or update of billing_responsible_id, member_client_id, status
on public.app_family_members
for each row execute function private.enforce_single_family_account_membership();

commit;
