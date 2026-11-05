-- Leads are not enrollments. Public intake is validated by lesson-leads-api;
-- only service_role can write, so clients cannot forge progress/history.
create table public.lesson_leads (
  id uuid primary key default gen_random_uuid(),
  request_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  nome text not null check (length(nome) between 2 and 120),
  telefone text not null check (telefone ~ '^55[0-9]{10,11}$'),
  idade integer check (idade between 1 and 110),
  publico text not null,
  genero text not null default '',
  responsavel text not null default '',
  dias_disponiveis jsonb not null default '[]' check (jsonb_typeof(dias_disponiveis) = 'array'),
  periodo text not null default '',
  ja_fez_aula text not null default '',
  nivel text not null default '',
  frequencia text not null default '',
  objetivo text not null default '',
  observacoes text not null default '',
  status text not null default 'novo' check (status in ('novo','contato','encaminhado','agendado','matriculado','arquivado')),
  teacher_id uuid references public.teachers(id) on delete set null,
  professor_nome text not null default '',
  professor_telefone text not null default '',
  encaminhado_em timestamptz,
  proximo_contato date,
  aula_em timestamptz,
  anotacoes text not null default '',
  consent_at timestamptz,
  consent_version text,
  source text not null default 'aulas',
  source_key text unique,
  source_note text not null default '',
  utm jsonb not null default '{}',
  ip_hash text,
  sheet_sync text not null default 'pending' check (sheet_sync in ('pending','sending','synced','failed','uncertain','imported')),
  sheet_attempt_at timestamptz,
  sheet_synced_at timestamptz,
  sheet_error text
);
create index lesson_leads_created_idx on public.lesson_leads (created_at desc, id);
create index lesson_leads_status_idx on public.lesson_leads (status, created_at desc);
create index lesson_leads_teacher_idx on public.lesson_leads (teacher_id);
create index lesson_leads_phone_idx on public.lesson_leads (telefone, created_at desc);
create index lesson_leads_ip_idx on public.lesson_leads (ip_hash, created_at desc);
create table public.lesson_lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.lesson_leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null,
  detail text not null
);
create index lesson_lead_events_lead_idx on public.lesson_lead_events (lead_id, created_at desc);
create index lesson_lead_events_actor_idx on public.lesson_lead_events (actor_id);
alter table public.lesson_leads enable row level security;
alter table public.lesson_lead_events enable row level security;
revoke all on public.lesson_leads, public.lesson_lead_events from anon, authenticated;
grant select, insert, update, delete on public.lesson_leads, public.lesson_lead_events to service_role;
-- No authenticated table grants: the API projects only safe administrative fields.
create policy lesson_leads_service on public.lesson_leads to service_role using (true) with check (true);
create policy lesson_lead_events_service on public.lesson_lead_events to service_role using (true) with check (true);

create function public.lesson_lead_submit(p_request uuid, p_ip_hash text, p_data jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('lesson-lead-ip:' || p_ip_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('lesson-lead-phone:' || (p_data->>'telefone'), 0));
  select id into v_id from public.lesson_leads where request_id = p_request;
  if v_id is not null then return v_id; end if;
  if (select count(*) from public.lesson_leads where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 10
     or (select count(*) from public.lesson_leads where telefone = p_data->>'telefone' and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'LEAD_RATE_LIMIT';
  end if;
  insert into public.lesson_leads (request_id,nome,telefone,idade,publico,genero,responsavel,dias_disponiveis,periodo,ja_fez_aula,nivel,frequencia,objetivo,observacoes,consent_at,consent_version,utm,ip_hash)
  values (p_request,p_data->>'nome',p_data->>'telefone',nullif(p_data->>'idade','')::integer,p_data->>'publico',p_data->>'genero',p_data->>'responsavel',p_data->'dias_disponiveis',p_data->>'periodo',p_data->>'ja_fez_aula',p_data->>'nivel',p_data->>'frequencia',p_data->>'objetivo',p_data->>'observacoes',now(),'aulas-v1',p_data->'utm',p_ip_hash)
  returning id into v_id;
  insert into public.lesson_lead_events (lead_id,kind,detail) values (v_id,'cadastro','Interesse recebido pelo formulário /aulas.');
  return v_id;
end $$;
revoke all on function public.lesson_lead_submit(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.lesson_lead_submit(uuid,text,jsonb) to service_role;

create function public.lesson_lead_update(p_id uuid, p_revision integer, p_patch jsonb, p_actor uuid, p_detail text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.lesson_leads set
    status = p_patch->>'status', teacher_id = nullif(p_patch->>'teacher_id','')::uuid,
    professor_nome = p_patch->>'professor_nome', professor_telefone = p_patch->>'professor_telefone',
    proximo_contato = nullif(p_patch->>'proximo_contato','')::date,
    aula_em = nullif(p_patch->>'aula_em','')::timestamptz,
    anotacoes = p_patch->>'anotacoes',
    encaminhado_em = case when p_patch->>'confirm_forward' = 'true' then now() else encaminhado_em end,
    revision = revision + 1, updated_at = now()
  where id = p_id and revision = p_revision;
  if not found then raise exception 'LEAD_CONFLICT'; end if;
  insert into public.lesson_lead_events (lead_id,actor_id,kind,detail)
  values (p_id,p_actor,case when p_patch->>'confirm_forward' = 'true' then 'encaminhamento' else 'atualizacao' end,p_detail);
end $$;
revoke all on function public.lesson_lead_update(uuid,integer,jsonb,uuid,text) from public, anon, authenticated;
grant execute on function public.lesson_lead_update(uuid,integer,jsonb,uuid,text) to service_role;
