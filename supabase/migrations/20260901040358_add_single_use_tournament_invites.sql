begin;

create table public.tournament_registration_invites (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  token_hash text not null unique,
  athlete_limit smallint not null,
  status text not null default 'ACTIVE',
  used_registration_group_id uuid references public.tournament_registration_groups(id) on delete set null,
  expires_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  revoked_at timestamptz,
  constraint tournament_registration_invites_token_hash_check
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint tournament_registration_invites_athlete_limit_check
    check (athlete_limit between 1 and 6),
  constraint tournament_registration_invites_status_check
    check (status in ('ACTIVE', 'USED', 'REVOKED')),
  constraint tournament_registration_invites_state_check
    check (
      (status = 'ACTIVE' and used_at is null and revoked_at is null)
      or (status = 'USED' and used_at is not null and revoked_at is null and used_registration_group_id is not null)
      or (status = 'REVOKED' and revoked_at is not null and used_at is null)
    )
);

create index tournament_registration_invites_tournament_status_idx
  on public.tournament_registration_invites(tournament_id, status, created_at desc);

create index tournament_registration_invites_used_group_idx
  on public.tournament_registration_invites(used_registration_group_id)
  where used_registration_group_id is not null;

alter table public.tournament_registration_invites enable row level security;
revoke all on table public.tournament_registration_invites from public, anon, authenticated;
grant select, insert, update, delete on table public.tournament_registration_invites to service_role;

-- O antigo token era reutilizável. Ao anulá-lo, qualquer link antigo deixa de
-- conceder isenção assim que esta migração entra em produção.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournaments'
      and column_name = 'courtesy_registration_token'
  ) then
    execute 'update public.tournaments
      set courtesy_registration_token = null,
          updated_at = now()
      where courtesy_registration_token is not null';
  end if;
end;
$$;

create or replace function public.claim_public_tournament_invite_bundle(
  p_invite_token_hash text,
  p_tournament_id uuid,
  p_request_token uuid,
  p_payer_name text,
  p_payer_email text,
  p_payer_phone text,
  p_payer_cpf text,
  p_entries jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  invite_row public.tournament_registration_invites%rowtype;
  existing_group public.tournament_registration_groups%rowtype;
  claim_result jsonb;
  claimed_group_id uuid;
  athlete_count integer;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;
  if p_tournament_id is null
     or p_request_token is null
     or coalesce(p_invite_token_hash, '') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_entries) <> 'array' then
    raise exception using errcode = '22023', message = 'Convite inválido.';
  end if;

  athlete_count := jsonb_array_length(p_entries);
  if athlete_count < 1 or athlete_count > 6 then
    raise exception using errcode = '22023', message = 'Informe de um a seis atletas.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_entries) as entry(value)
    where greatest(coalesce((entry.value ->> 'primary_amount')::numeric, 0), 0) <> 0
  ) then
    raise exception using errcode = '22023', message = 'Um convite não pode gerar cobrança.';
  end if;

  select invitation.*
    into invite_row
  from public.tournament_registration_invites as invitation
  where invitation.token_hash = p_invite_token_hash
  for update;

  if not found or invite_row.tournament_id <> p_tournament_id then
    raise exception using errcode = 'P0001', message = 'Este convite é inválido.';
  end if;

  select registration_group.*
    into existing_group
  from public.tournament_registration_groups as registration_group
  where registration_group.request_token = p_request_token;

  if invite_row.status = 'USED' then
    if existing_group.id is null
       or invite_row.used_registration_group_id is distinct from existing_group.id then
      raise exception using errcode = 'P0001', message = 'Este convite já foi utilizado.';
    end if;
  elsif invite_row.status = 'REVOKED' then
    raise exception using errcode = 'P0001', message = 'Este convite foi cancelado.';
  elsif invite_row.expires_at is not null and invite_row.expires_at < now() then
    raise exception using errcode = 'P0001', message = 'Este convite expirou.';
  elsif athlete_count > invite_row.athlete_limit then
    raise exception using errcode = 'P0001', message = format(
      'Este convite permite no máximo %s atleta(s).', invite_row.athlete_limit
    );
  end if;

  select public.claim_public_tournament_family_bundle(
    p_tournament_id,
    p_request_token,
    p_payer_name,
    p_payer_email,
    p_payer_phone,
    p_payer_cpf,
    p_entries
  ) into claim_result;

  claimed_group_id := nullif(claim_result #>> '{registration_group,id}', '')::uuid;
  if claimed_group_id is null then
    raise exception using errcode = 'P0002', message = 'A inscrição do convite não foi criada.';
  end if;

  if invite_row.status = 'ACTIVE' then
    update public.tournament_registration_invites
    set status = 'USED',
        used_registration_group_id = claimed_group_id,
        used_at = now()
    where id = invite_row.id;
  end if;

  return claim_result || jsonb_build_object(
    'invitation', jsonb_build_object(
      'id', invite_row.id,
      'athlete_limit', invite_row.athlete_limit,
      'status', 'USED'
    )
  );
end;
$$;

revoke all on function public.claim_public_tournament_invite_bundle(
  text, uuid, uuid, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.claim_public_tournament_invite_bundle(
  text, uuid, uuid, text, text, text, text, jsonb
) to service_role;

commit;
