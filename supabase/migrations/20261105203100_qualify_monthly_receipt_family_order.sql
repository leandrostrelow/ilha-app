-- Qualify the family row: both invoice.id and member.id occur in the SELECT.
-- Keep the provider/receipt authorization and the rest of the routine unchanged.
do $$
declare
  definition text := pg_get_functiondef('public.prepare_monthly_receipt_batch(uuid,uuid,uuid,jsonb,text,date,text)'::regprocedure);
  original text := $before$select invoice.id,id,member_client_id,'MEMBRO',full_name,coalesce(monthly_amount,0)
          from public.app_family_members where billing_responsible_id=p_client_id and status='ATIVO'
            and (not coalesce(responsible_confirmation_required,false) or responsible_confirmed_at is not null or billing_authorized_at is not null)
          order by id$before$;
  qualified text := $after$select invoice.id,member.id,member.member_client_id,'MEMBRO',member.full_name,coalesce(member.monthly_amount,0)
          from public.app_family_members as member where member.billing_responsible_id=p_client_id and member.status='ATIVO'
            and (not coalesce(member.responsible_confirmation_required,false) or member.responsible_confirmed_at is not null or member.billing_authorized_at is not null)
          order by member.id$after$;
begin
  if position(original in definition)=0 then raise exception 'Unexpected monthly receipt family definition'; end if;
  execute replace(definition,original,qualified);
end;
$$;
