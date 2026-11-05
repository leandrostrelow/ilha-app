alter table public.lesson_leads
  add column como_conheceu text not null default ''
  check (como_conheceu in ('', 'Instagram', 'Google', 'Indicação', 'Passando em frente', 'Evento ou torneio', 'WhatsApp', 'Outro'));

create or replace function public.lesson_lead_submit(p_request uuid, p_ip_hash text, p_data jsonb)
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
  insert into public.lesson_leads (request_id,nome,telefone,idade,publico,genero,responsavel,dias_disponiveis,periodo,ja_fez_aula,nivel,frequencia,objetivo,como_conheceu,observacoes,consent_at,consent_version,utm,ip_hash)
  values (p_request,p_data->>'nome',p_data->>'telefone',nullif(p_data->>'idade','')::integer,p_data->>'publico',p_data->>'genero',p_data->>'responsavel',p_data->'dias_disponiveis',p_data->>'periodo',p_data->>'ja_fez_aula',p_data->>'nivel',p_data->>'frequencia',p_data->>'objetivo',p_data->>'como_conheceu',p_data->>'observacoes',now(),'aulas-v1',p_data->'utm',p_ip_hash)
  returning id into v_id;
  insert into public.lesson_lead_events (lead_id,kind,detail) values (v_id,'cadastro','Interesse recebido pelo formulário /aulas.');
  return v_id;
end $$;

revoke all on function public.lesson_lead_submit(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.lesson_lead_submit(uuid,text,jsonb) to service_role;
