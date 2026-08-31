-- Allow staff to record an internal tournament registration that was paid
-- before the next monthly invoice. This is additive and preserves all rows.

alter table public.tournament_registration_orders
  add column if not exists paid_at timestamptz,
  add column if not exists payment_note text;

alter table public.tournament_registration_orders
  drop constraint if exists tournament_registration_orders_billing_status_check;

alter table public.tournament_registration_orders
  add constraint tournament_registration_orders_billing_status_check
  check (billing_status in (
    'PENDING_CLIENT_LINK',
    'READY_FOR_INVOICE',
    'INVOICED',
    'PAID',
    'WAIVED',
    'CANCELLED'
  ));

alter table public.tournament_registration_orders
  drop constraint if exists tournament_registration_orders_paid_at_check;

alter table public.tournament_registration_orders
  add constraint tournament_registration_orders_paid_at_check
  check (billing_status <> 'PAID' or paid_at is not null);
