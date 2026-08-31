create or replace function public.claim_protected_access_recovery(
  p_email text,
  p_cooldown_seconds integer default 3600
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_at timestamptz;
  cooldown_seconds integer := greatest(60, least(coalesce(p_cooldown_seconds, 3600), 86400));
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  update public.protected_access_accounts as account
     set last_recovery_at = now(),
         updated_at = now()
   where account.email = lower(trim(p_email))
     and account.active is true
     and (
       account.last_recovery_at is null
       or account.last_recovery_at <= now() - (cooldown_seconds * interval '1 second')
     )
  returning account.last_recovery_at into claimed_at;

  return claimed_at;
end;
$$;

revoke all on function public.claim_protected_access_recovery(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_protected_access_recovery(text, integer)
  to service_role;
