begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Receipt reconciliation updates money, not an administrator's sports cancellation.
create or replace function public.sync_tournament_registration_payment_group(
  p_primary_registration_id uuid,
  p_registration_status text default null,
  p_payment_status text default null,
  p_paid_amount numeric default null,
  p_confirmed_at timestamptz default null,
  p_cancelled_at timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_group_id uuid;
  group_total numeric;
  updated_count integer;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;
  if p_registration_status is not null
     and p_registration_status not in ('PENDING', 'CONFIRMED', 'WAITLIST', 'CANCELLED', 'REFUNDED') then
    raise exception using errcode = '22023', message = 'Status de inscrição inválido.';
  end if;
  if p_payment_status is not null
     and p_payment_status not in ('NOT_REQUIRED', 'PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'OVERDUE', 'REFUNDED', 'CANCELLED') then
    raise exception using errcode = '22023', message = 'Status de pagamento inválido.';
  end if;
  if p_paid_amount is not null and p_paid_amount < 0 then
    raise exception using errcode = '22023', message = 'Valor pago inválido.';
  end if;

  select registration.registration_group_id
    into target_group_id
  from public.tournament_registrations as registration
  where registration.id = p_primary_registration_id
    and registration.parent_registration_id is null;

  if not found then
    raise exception using errcode = 'P0002', message = 'Inscrição principal não encontrada.';
  end if;

  select coalesce(sum(registration.total_amount), 0)
    into group_total
  from public.tournament_registrations as registration
  where case
    when target_group_id is not null then registration.registration_group_id = target_group_id
    else registration.id = p_primary_registration_id
      or registration.parent_registration_id = p_primary_registration_id
  end;

  update public.tournament_registrations as registration
  set status = case
        when p_registration_status = 'CONFIRMED' and registration.status in ('CANCELLED','REFUNDED') then registration.status
        else coalesce(p_registration_status, registration.status)
      end,
      payment_status = coalesce(p_payment_status, registration.payment_status),
      paid_amount = case
        when p_paid_amount is null then registration.paid_amount
        when group_total <= 0 then 0
        else round(least(registration.total_amount, p_paid_amount * registration.total_amount / group_total), 2)
      end,
      confirmed_at = case
        when p_registration_status = 'CONFIRMED' and registration.status in ('CANCELLED','REFUNDED') then registration.confirmed_at
        when p_registration_status = 'CONFIRMED' then coalesce(registration.confirmed_at, p_confirmed_at, now())
        when p_registration_status in ('PENDING', 'CANCELLED', 'REFUNDED') then null
        else registration.confirmed_at
      end,
      cancelled_at = case
        when p_registration_status = 'CONFIRMED' and registration.status in ('CANCELLED','REFUNDED') then registration.cancelled_at
        when p_registration_status = 'CANCELLED' then coalesce(p_cancelled_at, now())
        when p_registration_status in ('PENDING', 'CONFIRMED') then null
        else registration.cancelled_at
      end,
      updated_at = now()
  where case
    when target_group_id is not null then registration.registration_group_id = target_group_id
    else registration.id = p_primary_registration_id
      or registration.parent_registration_id = p_primary_registration_id
  end;

  get diagnostics updated_count = row_count;

  if target_group_id is not null then
    update public.tournament_registration_groups
    set status = case
          when p_registration_status = 'CONFIRMED' and status in ('CANCELLED','REFUNDED') then status
          when p_registration_status = 'PENDING' then 'PENDING'
          when p_registration_status = 'CONFIRMED' then 'CONFIRMED'
          when p_registration_status = 'REFUNDED' then 'REFUNDED'
          when p_registration_status = 'CANCELLED' then 'CANCELLED'
          when p_payment_status = 'OVERDUE' then 'OVERDUE'
          else status
        end,
        updated_at = now()
    where id = target_group_id;
  end if;

  return updated_count;
end;
$$;


alter table public.tournament_payments add column reconciliation_closed_at timestamptz;
create table private.tournament_reconciliation_closures (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.tournament_payments(id),
  actor_id uuid not null references auth.users(id),
  reason text not null check (length(btrim(reason)) between 12 and 1000),
  before_state jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
revoke all on private.tournament_reconciliation_closures from public,anon,authenticated,service_role;
create index tournament_reconciliation_closures_payment_idx on private.tournament_reconciliation_closures(payment_id);
create index tournament_reconciliation_closures_actor_idx on private.tournament_reconciliation_closures(actor_id);

-- Closing routine receipt checks never suppresses a later refund/chargeback.
create function private.reopen_changed_tournament_payment() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then new.reconciliation_closed_at := null; end if;
  return new;
end;
$$;
revoke all on function private.reopen_changed_tournament_payment() from public,anon,authenticated,service_role;
create trigger reopen_changed_tournament_payment before update on public.tournament_payments
for each row execute function private.reopen_changed_tournament_payment();

-- Service-only operational action: no provider mutation and no financial rewrite.
create function public.close_cancelled_tournament_reconciliation(
  p_payment_id uuid,p_actor_id uuid,p_expected_updated_at timestamptz,
  p_expected_provider_payment_id text,p_expected_amount numeric,p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.tournament_payments%rowtype;
  r public.tournament_registrations%rowtype;
  closed_id uuid;
  before_state jsonb;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Acesso negado.' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.profiles profile join auth.users u on u.id=profile.id
    join public.protected_access_accounts account on account.email=lower(trim(u.email))
      and account.role=profile.role and account.active is true
    where profile.id=p_actor_id and profile.role='admin' and profile.active is true
  ) then raise exception 'Administrador responsável inválido.' using errcode='42501'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 12 and 1000 then
    raise exception 'Informe o motivo do encerramento.' using errcode='22023';
  end if;
  select * into p from public.tournament_payments where id=p_payment_id for update;
  if not found then raise exception 'Cobrança não encontrada.' using errcode='P0002'; end if;
  if p.provider <> 'ASAAS' or p.status <> 'RECEIVED' or p.paid_at is null
     or p.provider_payment_id is distinct from p_expected_provider_payment_id
     or p.amount is distinct from p_expected_amount then
    raise exception 'O recebimento não corresponde à conferência.' using errcode='P0001';
  end if;
  select * into r from public.tournament_registrations where id=p.registration_id for update;
  if not found then raise exception 'Inscrição não encontrada.' using errcode='P0002'; end if;
  perform 1 from public.tournament_registrations x
  where case when r.registration_group_id is not null then x.registration_group_id=r.registration_group_id
    else x.id=r.id or x.parent_registration_id=r.id end order by x.id for update;
  if exists(select 1 from public.tournament_registrations x
    where (case when r.registration_group_id is not null then x.registration_group_id=r.registration_group_id
      else x.id=r.id or x.parent_registration_id=r.id end)
      and (x.status <> 'CANCELLED' or x.payment_status <> 'PAID')) then
    raise exception 'Somente inscrições canceladas com pagamento preservado podem ser encerradas.' using errcode='P0001';
  end if;
  if p.reconciliation_closed_at is not null then
    return jsonb_build_object('closed',true,'already_closed',true,'payment_id',p.id);
  end if;
  if p.updated_at is distinct from p_expected_updated_at then
    raise exception 'Cobrança alterada durante a conferência.' using errcode='P0001';
  end if;
  before_state := jsonb_build_object('status',p.status,'amount',p.amount,'paid_at',p.paid_at,
    'next_reconciliation_at',p.next_reconciliation_at,'reconciliation_attempts',p.reconciliation_attempts,
    'registration_status',r.status,'registration_payment_status',r.payment_status);
  insert into private.tournament_reconciliation_closures(payment_id,actor_id,reason,before_state)
    values(p.id,p_actor_id,btrim(p_reason),before_state) returning id into closed_id;
  update public.tournament_payments set reconciliation_closed_at=clock_timestamp(),
    next_reconciliation_at=null,updated_at=clock_timestamp() where id=p.id;
  return jsonb_build_object('closed',true,'already_closed',false,'payment_id',p.id,'audit_id',closed_id);
end;
$$;
revoke all on function public.close_cancelled_tournament_reconciliation(uuid,uuid,timestamptz,text,numeric,text) from public,anon,authenticated,service_role;
grant execute on function public.close_cancelled_tournament_reconciliation(uuid,uuid,timestamptz,text,numeric,text) to service_role;
commit;
