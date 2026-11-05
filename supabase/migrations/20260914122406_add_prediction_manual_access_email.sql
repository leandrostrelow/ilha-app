create or replace function public.claim_tournament_prediction_access_email_retry(p_entry_id uuid)
returns table(delivery_id uuid, attempt_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign_id uuid;
begin
  select entry.campaign_id
  into v_campaign_id
  from public.tournament_prediction_entries as entry
  where entry.id = p_entry_id;

  if v_campaign_id is null then
    raise exception using errcode = 'P0001', message = 'entry_not_found';
  end if;

  return query
  insert into public.tournament_prediction_access_email_deliveries as delivery (
    campaign_id,
    entry_id,
    status,
    attempt_count,
    claimed_at
  ) values (
    v_campaign_id,
    p_entry_id,
    'SENDING',
    1,
    clock_timestamp()
  )
  on conflict (entry_id) do update
    set status = 'SENDING',
        attempt_count = delivery.attempt_count + 1,
        provider_message_id = null,
        last_error_code = null,
        claimed_at = clock_timestamp(),
        sent_at = null,
        updated_at = clock_timestamp()
  returning delivery.id, delivery.attempt_count;
end;
$$;

comment on function public.claim_tournament_prediction_access_email_retry(uuid) is
  'Reserva um reenvio manual e auditável do código de acesso solicitado pelo administrador.';

revoke all on function public.claim_tournament_prediction_access_email_retry(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_tournament_prediction_access_email_retry(uuid)
  to service_role;
