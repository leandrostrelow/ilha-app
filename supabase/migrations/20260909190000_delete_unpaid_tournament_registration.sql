begin;

alter table private.tournament_expired_registration_attempts
  add column if not exists cleanup_reason text not null default 'PAYMENT_EXPIRED',
  add column if not exists cleaned_by uuid;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'tournament_expired_attempts_cleanup_reason_check'
      and conrelid = 'private.tournament_expired_registration_attempts'::regclass
  ) then
    alter table private.tournament_expired_registration_attempts
      add constraint tournament_expired_attempts_cleanup_reason_check
      check (cleanup_reason in ('PAYMENT_EXPIRED', 'ADMIN_UNPAID_DELETE'));
  end if;
end;
$$;

-- Finalizes an administrator-requested cleanup only after the Edge Function has
-- verified/cancelled the matching Asaas charge. The database repeats every
-- financial guard while holding row locks so a payment webhook always wins.
create or replace function public.delete_unpaid_tournament_registration(
  p_tournament_id uuid,
  p_payment_id uuid,
  p_expected_provider_payment_id text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.tournament_payments%rowtype;
  primary_registration_id uuid;
  target_group_id uuid;
  registration_snapshot jsonb := '[]'::jsonb;
  snapshot_athlete_ids uuid[] := '{}'::uuid[];
  removed_registrations integer := 0;
  archived_reason text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;
  if p_tournament_id is null or p_payment_id is null then
    raise exception using errcode = '22023', message = 'Cobrança inválida.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('delete-unpaid-tournament-payment:' || p_payment_id::text, 0)
  );

  select payment.*
    into payment_row
  from public.tournament_payments as payment
  where payment.id = p_payment_id
  for update;

  if not found then
    select attempt.cleanup_reason
      into archived_reason
    from private.tournament_expired_registration_attempts as attempt
    where attempt.payment_id = p_payment_id
      and attempt.tournament_id = p_tournament_id;
    if archived_reason = 'ADMIN_UNPAID_DELETE' then
      return jsonb_build_object(
        'deleted', true,
        'already_deleted', true,
        'payment_id', p_payment_id,
        'registrations_removed', 0
      );
    end if;
    raise exception using errcode = 'P0002', message = 'Cobrança não encontrada.';
  end if;

  if payment_row.tournament_id is distinct from p_tournament_id
     or payment_row.provider <> 'ASAAS'
     or payment_row.billing_type <> 'PIX'
     or coalesce(payment_row.provider_payment_id, '')
        <> coalesce(nullif(pg_catalog.btrim(p_expected_provider_payment_id), ''), '') then
    raise exception using errcode = 'P0001', message = 'A cobrança mudou durante a exclusão. Atualize a página e confira novamente.';
  end if;

  if payment_row.paid_at is not null
     or payment_row.status not in ('CREATED', 'RECONCILING', 'PENDING', 'FAILED', 'OVERDUE', 'CANCELLED') then
    raise exception using errcode = 'P0001', message = 'Esta inscrição possui pagamento confirmado ou protegido e não pode ser excluída.';
  end if;
  if payment_row.status in ('CREATED', 'RECONCILING')
     and payment_row.provider_attempted_at is not null
     and payment_row.provider_attempted_at > clock_timestamp() - interval '3 minutes' then
    raise exception using errcode = 'P0001', message = 'A cobrança ainda está sendo criada. Aguarde alguns minutos e tente novamente.';
  end if;

  select coalesce(registration.parent_registration_id, registration.id),
         registration.registration_group_id
    into primary_registration_id, target_group_id
  from public.tournament_registrations as registration
  where registration.id = payment_row.registration_id
    and registration.tournament_id = p_tournament_id
  for update;

  if primary_registration_id is null then
    raise exception using errcode = 'P0002', message = 'Inscrição vinculada à cobrança não encontrada.';
  end if;

  -- Lock the whole checkout (individual, add-on children, or family group).
  perform 1
  from public.tournament_registrations as registration
  where registration.tournament_id = p_tournament_id
    and case
      when target_group_id is not null then registration.registration_group_id = target_group_id
      else registration.id = primary_registration_id
        or registration.parent_registration_id = primary_registration_id
    end
  order by registration.id
  for update;

  if exists (
    select 1
    from public.tournament_registrations as registration
    where registration.tournament_id = p_tournament_id
      and case
        when target_group_id is not null then registration.registration_group_id = target_group_id
        else registration.id = primary_registration_id
          or registration.parent_registration_id = primary_registration_id
      end
      and (
        registration.status not in ('PENDING', 'CANCELLED')
        or registration.payment_status not in ('PENDING', 'OVERDUE', 'CANCELLED')
        or coalesce(registration.paid_amount, 0) <> 0
        or registration.confirmed_at is not null
        or registration.registration_order_id is not null
      )
  ) then
    raise exception using errcode = 'P0001', message = 'Esta inscrição já foi confirmada, paga ou vinculada ao financeiro e não pode ser excluída.';
  end if;

  select
    coalesce(jsonb_agg(to_jsonb(registration) order by registration.created_at, registration.id), '[]'::jsonb),
    coalesce(array_agg(distinct registration.athlete_id) filter (where registration.athlete_id is not null), '{}'::uuid[])
    into registration_snapshot, snapshot_athlete_ids
  from public.tournament_registrations as registration
  where registration.tournament_id = p_tournament_id
    and case
      when target_group_id is not null then registration.registration_group_id = target_group_id
      else registration.id = primary_registration_id
        or registration.parent_registration_id = primary_registration_id
    end;

  if jsonb_array_length(registration_snapshot) = 0 then
    raise exception using errcode = 'P0002', message = 'Nenhuma inscrição removível foi encontrada.';
  end if;

  if exists (
    select 1
    from public.tournament_payments as other_payment
    where other_payment.id <> payment_row.id
      and other_payment.tournament_id = p_tournament_id
      and (
        (target_group_id is not null and other_payment.registration_group_id = target_group_id)
        or other_payment.registration_id in (
          select (item ->> 'id')::uuid
          from jsonb_array_elements(registration_snapshot) as item
        )
      )
  ) then
    raise exception using errcode = 'P0001', message = 'Existe outra cobrança vinculada a esta inscrição. A exclusão foi bloqueada.';
  end if;

  if exists (
    select 1
    from public.tournament_matches as tournament_match
    where tournament_match.tournament_id = p_tournament_id
      and (
        tournament_match.side1_athlete_id = any(snapshot_athlete_ids)
        or tournament_match.side2_athlete_id = any(snapshot_athlete_ids)
        or tournament_match.winner_athlete_id = any(snapshot_athlete_ids)
      )
  ) or exists (
    select 1
    from public.tournament_live_state as live_state
    where live_state.tournament_id = p_tournament_id
      and (
        live_state.side1_athlete_id = any(snapshot_athlete_ids)
        or live_state.side2_athlete_id = any(snapshot_athlete_ids)
        or live_state.winner_athlete_id = any(snapshot_athlete_ids)
      )
  ) then
    raise exception using errcode = 'P0001', message = 'O atleta já possui chave, jogo ou placar vinculado e não pode ser excluído.';
  end if;

  insert into private.tournament_expired_registration_attempts (
    tournament_id,
    athlete_id,
    primary_registration_id,
    payment_id,
    registration_group_id,
    registration_snapshot,
    payment_snapshot,
    expired_at,
    cleanup_reason,
    cleaned_by
  ) values (
    payment_row.tournament_id,
    snapshot_athlete_ids[1],
    primary_registration_id,
    payment_row.id,
    target_group_id,
    registration_snapshot,
    to_jsonb(payment_row) - 'raw_response' - 'pix_payload' - 'pix_encoded_image',
    now(),
    'ADMIN_UNPAID_DELETE',
    p_actor_id
  ) on conflict (payment_id) do nothing;

  delete from public.tournament_payments
  where id = payment_row.id;

  if target_group_id is not null then
    delete from public.tournament_registrations
    where tournament_id = p_tournament_id
      and registration_group_id = target_group_id;
    get diagnostics removed_registrations = row_count;

    delete from public.tournament_registration_groups
    where id = target_group_id
      and tournament_id = p_tournament_id;
  else
    delete from public.tournament_registrations
    where tournament_id = p_tournament_id
      and (id = primary_registration_id or parent_registration_id = primary_registration_id);
    get diagnostics removed_registrations = row_count;
  end if;

  perform private.delete_orphaned_public_tournament_athletes(snapshot_athlete_ids);

  return jsonb_build_object(
    'deleted', true,
    'already_deleted', false,
    'payment_id', p_payment_id,
    'registrations_removed', removed_registrations,
    'group_deleted', target_group_id is not null
  );
end;
$$;

revoke all on function public.delete_unpaid_tournament_registration(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_unpaid_tournament_registration(uuid, uuid, text, uuid)
  to service_role;

commit;
