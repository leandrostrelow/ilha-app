alter table public.app_clients
  add column if not exists plan_cancellation_requested_at timestamptz,
  add column if not exists plan_cancel_at date,
  add column if not exists reenrollment_fee_required boolean not null default false;

comment on column public.app_clients.plan_cancellation_requested_at is
  'Momento em que o cliente solicitou o cancelamento do plano.';

comment on column public.app_clients.plan_cancel_at is
  'Data da próxima renovação em que o plano deixa de liberar benefícios.';

comment on column public.app_clients.reenrollment_fee_required is
  'Indica cobrança de nova matrícula ao contratar outro plano após cancelamento.';
