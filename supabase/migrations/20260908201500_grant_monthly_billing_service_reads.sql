-- The monthly billing Edge Function reads these legacy tables through the
-- service-role client before dispatching a charge. RLS is still enforced for
-- every public/authenticated client; only the backend service receives read
-- access, and it does not receive write access here.
grant select on table public.app_payment_invoices to service_role;
grant select on table public.app_clients to service_role;
