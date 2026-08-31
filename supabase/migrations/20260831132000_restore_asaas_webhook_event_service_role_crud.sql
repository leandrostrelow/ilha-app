-- The webhook claims events through a SECURITY DEFINER RPC, then updates the
-- private event row directly while reconciling the payment. Keep the table
-- closed to browser roles, but restore the privileges required by the worker.

revoke all on table public.asaas_webhook_events from anon, authenticated;
grant select, insert, update, delete on table public.asaas_webhook_events to service_role;

do $$
begin
  if not has_table_privilege('service_role', 'public.asaas_webhook_events', 'select')
     or not has_table_privilege('service_role', 'public.asaas_webhook_events', 'insert')
     or not has_table_privilege('service_role', 'public.asaas_webhook_events', 'update')
     or not has_table_privilege('service_role', 'public.asaas_webhook_events', 'delete') then
    raise exception 'service_role webhook event privileges were not restored';
  end if;
  if has_table_privilege('anon', 'public.asaas_webhook_events', 'select')
     or has_table_privilege('authenticated', 'public.asaas_webhook_events', 'select') then
    raise exception 'webhook events must remain private';
  end if;
end;
$$;
