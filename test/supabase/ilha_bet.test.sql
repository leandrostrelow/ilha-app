begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

select ok(
  to_regclass('public.tournament_prediction_audit_log') is not null
  and to_regclass('public.tournament_prediction_campaigns') is not null
  and to_regclass('public.tournament_prediction_entries') is not null
  and to_regclass('public.tournament_prediction_requests') is not null
  and to_regclass('public.tournament_prediction_rate_limits') is not null
  and to_regclass('public.tournament_predictions') is not null,
  'as seis tabelas do Palpite Ilha existem'
);

select ok(
  not exists (
    select 1
    from (values
      ('tournament_prediction_campaigns'),
      ('tournament_prediction_entries'),
      ('tournament_predictions'),
      ('tournament_prediction_requests'),
      ('tournament_prediction_audit_log'),
      ('tournament_prediction_rate_limits')
    ) as protected_table(relation_name)
    join pg_class as relation on relation.relname = protected_table.relation_name
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and (not relation.relrowsecurity or not relation.relforcerowsecurity)
  ),
  'todas as tabelas do Palpite Ilha forçam RLS'
);

select ok(
  not exists (
    select 1
    from (values
      ('public.tournament_prediction_campaigns'),
      ('public.tournament_prediction_entries'),
      ('public.tournament_predictions'),
      ('public.tournament_prediction_requests'),
      ('public.tournament_prediction_audit_log'),
      ('public.tournament_prediction_rate_limits')
    ) as protected_table(table_name)
    where has_table_privilege('anon', protected_table.table_name, 'SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege('authenticated', protected_table.table_name, 'SELECT,INSERT,UPDATE,DELETE')
  ),
  'navegadores não acessam diretamente campanhas, palpites ou contatos'
);

select ok(
  not has_function_privilege('anon', 'public.register_tournament_prediction_entry(uuid,uuid,text,text,text,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.register_tournament_prediction_entry(uuid,uuid,text,text,text,text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.register_tournament_prediction_entry(uuid,uuid,text,text,text,text,text)', 'EXECUTE'),
  'cadastro só pode passar pela Edge Function'
);

select ok(
  not has_function_privilege('anon', 'public.save_tournament_prediction(uuid,uuid,text,uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.save_tournament_prediction(uuid,uuid,text,uuid,uuid,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.save_tournament_prediction(uuid,uuid,text,uuid,uuid,uuid)', 'EXECUTE'),
  'salvamento de palpite só pode passar pela Edge Function'
);

select ok(
  not has_function_privilege('anon', 'public.consume_tournament_prediction_rate_limit(text,text,integer,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.consume_tournament_prediction_rate_limit(text,text,integer,integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.consume_tournament_prediction_rate_limit(text,text,integer,integer)', 'EXECUTE'),
  'rate limit interno não fica exposto ao cliente'
);

select ok(
  not exists (
    select 1
    from (values
      ('public.admin_save_tournament_prediction_campaign(uuid,uuid,text,text,boolean,timestamp with time zone,timestamp with time zone,text,smallint,smallint,smallint,boolean,text,text)'),
      ('public.admin_set_tournament_prediction_entry_status(uuid,text,uuid)'),
      ('public.admin_delete_tournament_prediction_entry(uuid,uuid)'),
      ('public.admin_finalize_tournament_prediction_campaign(uuid,uuid)'),
      ('public.admin_reopen_tournament_prediction_campaign(uuid,uuid)')
    ) as rpc(signature)
    where has_function_privilege('anon', rpc.signature, 'EXECUTE')
       or has_function_privilege('authenticated', rpc.signature, 'EXECUTE')
       or not has_function_privilege('service_role', rpc.signature, 'EXECUTE')
  ),
  'RPCs administrativas são exclusivas do backend service_role'
);

select ok(
  exists (
    select 1
    from public.tournament_prediction_campaigns as campaign
    join public.tournaments as tournament on tournament.id = campaign.tournament_id
    where tournament.slug = 'ilha-open-2026'
      and campaign.prize_enabled = false
      and campaign.published = true
      and campaign.status = 'OPEN'
  ),
  'Ilha Open recebe campanha gratuita, publicada e sem prêmio habilitado'
);

insert into public.tournaments (
  id, name, slug, status, is_published, starts_on, ends_on
) values (
  '79000000-0000-4000-8000-000000000001'::uuid,
  'Palpite Ilha sintético',
  'palpite-ilha-ci',
  'IN_PROGRESS',
  false,
  current_date,
  current_date + 30
);

insert into public.tournament_categories (
  id, tournament_id, code, name
) values (
  '79000000-0000-4000-8000-000000000011'::uuid,
  '79000000-0000-4000-8000-000000000001'::uuid,
  'CI-BET',
  'Categoria sintética do palpite'
);

insert into public.tournament_athletes (id, full_name)
values
  ('79000000-0000-4000-8000-000000000021'::uuid, 'Atleta Alfa sintético'),
  ('79000000-0000-4000-8000-000000000022'::uuid, 'Atleta Beta sintético'),
  ('79000000-0000-4000-8000-000000000023'::uuid, 'Atleta fora da partida');

insert into public.tournament_matches (
  id, tournament_id, category_id, round_no, round_code, match_no,
  side1_athlete_id, side2_athlete_id, scheduled_at, status, published
) values (
  '79000000-0000-4000-8000-000000000031'::uuid,
  '79000000-0000-4000-8000-000000000001'::uuid,
  '79000000-0000-4000-8000-000000000011'::uuid,
  1,
  'QF',
  1,
  '79000000-0000-4000-8000-000000000021'::uuid,
  '79000000-0000-4000-8000-000000000022'::uuid,
  now() + interval '23 hours',
  'SCHEDULED',
  true
);

insert into public.tournament_prediction_campaigns (
  id, tournament_id, title, status, published, opens_at, closes_at
) values (
  '79000000-0000-4000-8000-000000000041'::uuid,
  '79000000-0000-4000-8000-000000000001'::uuid,
  'Palpite Ilha CI',
  'OPEN',
  true,
  now() - interval '1 hour',
  now() + interval '1 day'
);

select lives_ok(
  $$select public.register_tournament_prediction_entry(
    '79000000-0000-4000-8000-000000000041'::uuid,
    '79000000-0000-4000-8000-000000000051'::uuid,
    'Participante Sintético',
    'Participante S.',
    'participante@tests.invalid',
    '27999999999',
    repeat('a', 64)
  )$$,
  'o primeiro cadastro idempotente é criado'
);

select lives_ok(
  $$select public.register_tournament_prediction_entry(
    '79000000-0000-4000-8000-000000000041'::uuid,
    '79000000-0000-4000-8000-000000000051'::uuid,
    'Participante Sintético',
    'Participante S.',
    'participante@tests.invalid',
    '27999999999',
    repeat('a', 64)
  )$$,
  'repetir exatamente o cadastro retorna o mesmo participante'
);

select is(
  (
    select count(*)::text || ':' ||
      (select count(*)::text from public.tournament_prediction_audit_log
       where campaign_id = '79000000-0000-4000-8000-000000000041'::uuid
         and action = 'REGISTER')
    from public.tournament_prediction_entries
    where campaign_id = '79000000-0000-4000-8000-000000000041'::uuid
  ),
  '1:1',
  'retry de cadastro não duplica participante nem auditoria'
);

select throws_ok(
  $$select public.register_tournament_prediction_entry(
    '79000000-0000-4000-8000-000000000041'::uuid,
    '79000000-0000-4000-8000-000000000051'::uuid,
    'Outro Participante',
    'Outro P.',
    'participante@tests.invalid',
    '27999999999',
    repeat('a', 64)
  )$$,
  '23505',
  'registration_conflict',
  'a chave de cadastro não aceita outro payload'
);

select throws_ok(
  $$insert into public.tournament_predictions (
    campaign_id, entry_id, match_id, predicted_winner_athlete_id
  ) values (
    '79000000-0000-4000-8000-000000000041'::uuid,
    (select id from public.tournament_prediction_entries
     where registration_request_id = '79000000-0000-4000-8000-000000000051'::uuid),
    '79000000-0000-4000-8000-000000000031'::uuid,
    '79000000-0000-4000-8000-000000000023'::uuid
  )$$,
  '23514',
  'O palpite precisa pertencer ao participante e ao torneio da própria campanha.',
  'o banco rejeita atleta que não disputa a partida'
);

insert into public.tournament_matches (
  id, tournament_id, category_id, round_no, round_code, match_no,
  side1_athlete_id, side2_athlete_id, scheduled_at, status, published
) values (
  '79000000-0000-4000-8000-000000000033'::uuid,
  '79000000-0000-4000-8000-000000000001'::uuid,
  '79000000-0000-4000-8000-000000000011'::uuid,
  1,
  'QF',
  3,
  '79000000-0000-4000-8000-000000000021'::uuid,
  '79000000-0000-4000-8000-000000000022'::uuid,
  now() + interval '2 days',
  'SCHEDULED',
  true
);

select throws_ok(
  $$insert into public.tournament_predictions (
    campaign_id, entry_id, match_id, predicted_winner_athlete_id
  ) values (
    '79000000-0000-4000-8000-000000000041'::uuid,
    (select id from public.tournament_prediction_entries
     where registration_request_id = '79000000-0000-4000-8000-000000000051'::uuid),
    '79000000-0000-4000-8000-000000000033'::uuid,
    '79000000-0000-4000-8000-000000000021'::uuid
  )$$,
  'P0001',
  'prediction_not_open',
  'o banco rejeita palpite feito antes da janela de 24 horas'
);

delete from public.tournament_matches
where id = '79000000-0000-4000-8000-000000000033'::uuid;

select throws_ok(
  $$insert into public.tournament_prediction_requests (
    request_id, campaign_id, entry_id, match_id, predicted_winner_athlete_id
  ) values (
    '79000000-0000-4000-8000-000000000069'::uuid,
    '79000000-0000-4000-8000-000000000041'::uuid,
    (select id from public.tournament_prediction_entries
     where registration_request_id = '79000000-0000-4000-8000-000000000051'::uuid),
    '79000000-0000-4000-8000-000000000031'::uuid,
    '79000000-0000-4000-8000-000000000023'::uuid
  )$$,
  '23514',
  'O palpite precisa pertencer ao participante e ao torneio da própria campanha.',
  'o ledger também rejeita atleta que não disputa a partida'
);

select lives_ok(
  $$select public.save_tournament_prediction(
    '79000000-0000-4000-8000-000000000041'::uuid,
    (select id from public.tournament_prediction_entries
     where registration_request_id = '79000000-0000-4000-8000-000000000051'::uuid),
    repeat('a', 64),
    '79000000-0000-4000-8000-000000000031'::uuid,
    '79000000-0000-4000-8000-000000000021'::uuid,
    '79000000-0000-4000-8000-000000000061'::uuid
  )$$,
  'o primeiro palpite é salvo'
);

select lives_ok(
  $$select public.save_tournament_prediction(
    '79000000-0000-4000-8000-000000000041'::uuid,
    (select id from public.tournament_prediction_entries
     where registration_request_id = '79000000-0000-4000-8000-000000000051'::uuid),
    repeat('a', 64),
    '79000000-0000-4000-8000-000000000031'::uuid,
    '79000000-0000-4000-8000-000000000021'::uuid,
    '79000000-0000-4000-8000-000000000061'::uuid
  )$$,
  'retry exato do palpite é aceito'
);

select is(
  (
    select
      (select count(*)::text from public.tournament_predictions
       where campaign_id = '79000000-0000-4000-8000-000000000041'::uuid) || ':' ||
      (select count(*)::text from public.tournament_prediction_requests
       where campaign_id = '79000000-0000-4000-8000-000000000041'::uuid) || ':' ||
      (select count(*)::text from public.tournament_prediction_audit_log
       where campaign_id = '79000000-0000-4000-8000-000000000041'::uuid
         and action = 'SAVE_PREDICTION')
  ),
  '1:1:1',
  'retry exato não duplica palpite, ledger ou auditoria'
);

select lives_ok(
  $$select public.save_tournament_prediction(
    '79000000-0000-4000-8000-000000000041'::uuid,
    (select id from public.tournament_prediction_entries
     where registration_request_id = '79000000-0000-4000-8000-000000000051'::uuid),
    repeat('a', 64),
    '79000000-0000-4000-8000-000000000031'::uuid,
    '79000000-0000-4000-8000-000000000022'::uuid,
    '79000000-0000-4000-8000-000000000062'::uuid
  )$$,
  'uma nova requisição pode alterar a escolha antes do jogo'
);

select lives_ok(
  $$select public.save_tournament_prediction(
    '79000000-0000-4000-8000-000000000041'::uuid,
    (select id from public.tournament_prediction_entries
     where registration_request_id = '79000000-0000-4000-8000-000000000051'::uuid),
    repeat('a', 64),
    '79000000-0000-4000-8000-000000000031'::uuid,
    '79000000-0000-4000-8000-000000000021'::uuid,
    '79000000-0000-4000-8000-000000000061'::uuid
  )$$,
  'retry antigo é reconhecido sem repetir a mutação'
);

select is(
  (
    select predicted_winner_athlete_id
    from public.tournament_predictions
    where campaign_id = '79000000-0000-4000-8000-000000000041'::uuid
  ),
  '79000000-0000-4000-8000-000000000022'::uuid,
  'retry antigo nunca desfaz a escolha mais recente'
);

select is(
  (
    select
      (select count(*)::text from public.tournament_predictions
       where campaign_id = '79000000-0000-4000-8000-000000000041'::uuid) || ':' ||
      (select count(*)::text from public.tournament_prediction_requests
       where campaign_id = '79000000-0000-4000-8000-000000000041'::uuid) || ':' ||
      (select count(*)::text from public.tournament_prediction_audit_log
       where campaign_id = '79000000-0000-4000-8000-000000000041'::uuid
         and action = 'SAVE_PREDICTION')
  ),
  '1:2:2',
  'edição legítima mantém um palpite e registra duas requisições efetivas'
);

select throws_ok(
  $$select public.save_tournament_prediction(
    '79000000-0000-4000-8000-000000000041'::uuid,
    (select id from public.tournament_prediction_entries
     where registration_request_id = '79000000-0000-4000-8000-000000000051'::uuid),
    repeat('a', 64),
    '79000000-0000-4000-8000-000000000031'::uuid,
    '79000000-0000-4000-8000-000000000022'::uuid,
    '79000000-0000-4000-8000-000000000061'::uuid
  )$$,
  'P0001',
  'request_conflict',
  'uma request de palpite não aceita outro payload'
);

update public.tournament_matches
set winner_athlete_id = '79000000-0000-4000-8000-000000000022'::uuid,
    status = 'FINISHED',
    started_at = now() - interval '2 hours',
    finished_at = now() - interval '1 hour'
where id = '79000000-0000-4000-8000-000000000031'::uuid;

insert into public.tournament_matches (
  id, tournament_id, category_id, round_no, round_code, match_no,
  side1_athlete_id, side2_athlete_id, winner_athlete_id, scheduled_at, status, published
) values (
  '79000000-0000-4000-8000-000000000032'::uuid,
  '79000000-0000-4000-8000-000000000001'::uuid,
  '79000000-0000-4000-8000-000000000011'::uuid,
  1,
  'QF',
  2,
  '79000000-0000-4000-8000-000000000021'::uuid,
  '79000000-0000-4000-8000-000000000022'::uuid,
  '79000000-0000-4000-8000-000000000022'::uuid,
  now() - interval '1 hour',
  'CANCELLED',
  true
);

insert into public.tournament_predictions (
  campaign_id, entry_id, match_id, predicted_winner_athlete_id
) values (
  '79000000-0000-4000-8000-000000000041'::uuid,
  (select id from public.tournament_prediction_entries
   where registration_request_id = '79000000-0000-4000-8000-000000000051'::uuid),
  '79000000-0000-4000-8000-000000000032'::uuid,
  '79000000-0000-4000-8000-000000000022'::uuid
);

update public.tournament_prediction_campaigns
set status = 'LOCKED'
where id = '79000000-0000-4000-8000-000000000041'::uuid;

select throws_ok(
  $$select public.admin_finalize_tournament_prediction_campaign(
    '79000000-0000-4000-8000-000000000001'::uuid,
    null
  )$$,
  'P0001',
  'tournament_not_finished',
  'campanha não pode coroar campeão antes de o torneio ser finalizado'
);

update public.tournaments
set status = 'FINISHED'
where id = '79000000-0000-4000-8000-000000000001'::uuid;

select lives_ok(
  $$select public.admin_finalize_tournament_prediction_campaign(
    '79000000-0000-4000-8000-000000000001'::uuid,
    null
  )$$,
  'partida cancelada não impede a finalização'
);

select is(
  (
    select status || ':' || (winner_entry_id = (
      select id from public.tournament_prediction_entries
      where registration_request_id = '79000000-0000-4000-8000-000000000051'::uuid
    ))::text
    from public.tournament_prediction_campaigns
    where id = '79000000-0000-4000-8000-000000000041'::uuid
  ),
  'FINISHED:true',
  'finalização transacional grava o vencedor correto'
);

select is(
  (
    select (metadata ->> 'score')::integer
    from public.tournament_prediction_audit_log
    where campaign_id = '79000000-0000-4000-8000-000000000041'::uuid
      and action = 'FINALIZE_CAMPAIGN'
    order by created_at desc
    limit 1
  ),
  1,
  'partida cancelada com vencedor residual nunca entra na pontuação'
);

select lives_ok(
  $$select public.admin_reopen_tournament_prediction_campaign(
    '79000000-0000-4000-8000-000000000001'::uuid,
    null
  )$$,
  'o desafio finalizado pode ser reaberto pela RPC administrativa'
);

select is(
  (
    select status || ':' || (winner_entry_id is null)::text || ':' || published::text
    from public.tournament_prediction_campaigns
    where id = '79000000-0000-4000-8000-000000000041'::uuid
  ),
  'OPEN:true:true',
  'reabertura remove o vencedor e republica a campanha'
);

select is(
  (
    select count(*)::integer
    from public.tournament_prediction_audit_log
    where campaign_id = '79000000-0000-4000-8000-000000000041'::uuid
      and action in ('FINALIZE_CAMPAIGN', 'REOPEN_CAMPAIGN')
  ),
  2,
  'finalização e reabertura deixam uma auditoria cada'
);

select * from finish();

rollback;
