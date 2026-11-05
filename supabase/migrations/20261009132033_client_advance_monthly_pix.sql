begin;

-- Keep the regular D-15 options/job unchanged. This separate calendar is only
-- used when the owner explicitly chooses to anticipate a monthly payment.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('private.client_monthly_payment_options(uuid)'::regprocedure);
  if position('interval ''1 month'',interval ''1 month''' in definition)=0
    or position('then state:=''TOO_EARLY''; end if;' in definition)=0 then
    raise exception 'Unexpected monthly options definition';
  end if;
  definition:=replace(definition,'FUNCTION private.client_monthly_payment_options(',
    'FUNCTION private.client_advance_payment_options(');
  definition:=replace(definition,'interval ''1 month'',interval ''1 month''',
    'interval ''11 months'',interval ''1 month''');
  definition:=replace(definition,'then state:=''TOO_EARLY''; end if;',
    'and false then state:=''TOO_EARLY''; end if;');
  definition:=replace(definition,'result:=result||jsonb_build_array(', $guard$
    -- Manual receipts in progress must never turn into a second Asaas charge.
    if state not in ('PAID','CONFIRMED') and (invoice.payment_method in ('CASH','CLUB_PIX')
      or exists(select 1 from public.app_clients where id=p_client_id and plan_cancel_at<=due)) then
      state:='BLOCKED'; reason:='REVIEW_REQUIRED';
    end if;
    -- Proven cancellations still use the original, guarded reissue window.
    if state='REISSUABLE' and cycle.month>date_trunc('month',today)::date and due>today+15 then
      state:='BLOCKED'; reason:='INVOICE_CANCELLED';
    end if;
    result:=result||jsonb_build_array($guard$);
  execute definition;
end;
$$;
revoke all on function private.client_advance_payment_options(uuid) from public,anon,authenticated,service_role;

-- Public functions are invoker-only. Authorization lives in private guards.
alter function public.admin_get_monthly_receipt_calendar(uuid) set schema private;
create function public.admin_get_monthly_receipt_calendar(p_client_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.admin_get_monthly_receipt_calendar(p_client_id);
$$;
revoke all on function public.admin_get_monthly_receipt_calendar(uuid) from public,anon,authenticated,service_role;
grant usage on schema private to authenticated;
grant execute on function private.admin_get_monthly_receipt_calendar(uuid),public.admin_get_monthly_receipt_calendar(uuid) to authenticated;

create function private.get_my_advance_payment_options()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.' using errcode='42501'; end if;
  return private.client_advance_payment_options(auth.uid());
end;
$$;
create function public.get_my_advance_payment_options()
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.get_my_advance_payment_options();
$$;
revoke all on function private.get_my_advance_payment_options(),public.get_my_advance_payment_options() from public,anon,authenticated,service_role;
grant execute on function private.get_my_advance_payment_options(),public.get_my_advance_payment_options() to authenticated;

-- Same ownership, locks, server-side prices and idempotent invoice creation as
-- the regular flow. The Edge handler supplies only the authenticated owner's ID.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.prepare_client_monthly_pix(uuid,date,text)'::regprocedure);
  definition:=replace(definition,'FUNCTION public.prepare_client_monthly_pix(',
    'FUNCTION public.prepare_client_advance_pix(');
  definition:=replace(definition,'private.client_monthly_payment_options(p_client_id)',
    'private.client_advance_payment_options(p_client_id)');
  execute definition;
end;
$$;
revoke all on function public.prepare_client_advance_pix(uuid,date,text) from public,anon,authenticated,service_role;
grant execute on function public.prepare_client_advance_pix(uuid,date,text) to service_role;

commit;
