begin;
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.prepare_client_monthly_pix(uuid,date,text)'::regprocedure);
  definition:=replace(definition,'app_invoice_provider_payments.invoice_id=prepare_client_monthly_pix.invoice_id','app_invoice_provider_payments.invoice_id=(option->>''invoice_id'')::uuid');
  execute definition;
end;
$$;
commit;
