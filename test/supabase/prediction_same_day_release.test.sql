begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('app.skip_bet_release_notifications','on',true);
do $test$
declare
  t uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid();
  morning uuid:=gen_random_uuid(); final_game uuid:=gen_random_uuid(); ordinary uuid:=gen_random_uuid();
  campaign uuid:=gen_random_uuid(); entry_id uuid; request uuid; w record; opened timestamptz; result public.tournament_predictions;
  d date:=(clock_timestamp() at time zone 'America/Sao_Paulo')::date;
  n integer; q1 integer; q2 integer;
begin
  insert into public.tournaments(id,name,slug,status,is_published,timezone,starts_on,ends_on)
    values(t,'Teste transacional Bet','bet-teste-'||t,'IN_PROGRESS',false,'America/Sao_Paulo',d,d+2);
  insert into public.tournament_categories(id,tournament_id,code,name,active,is_published)
    values(c,t,'TEST','Teste',true,true);
  insert into public.tournament_athletes(id,full_name) values(a,'Atleta teste A'),(b,'Atleta teste B');
  insert into public.tournament_matches(id,tournament_id,category_id,round_no,round_code,match_no,side1_athlete_id,side2_athlete_id,match_date,match_time,status,published,winner_athlete_id)
    values(morning,t,c,1,'SF',1,a,b,d,'00:01','FINISHED',true,a);
  insert into public.tournament_prediction_campaigns(id,tournament_id,title,status,published,opens_at,closes_at)
    values(campaign,t,'Teste transacional','OPEN',true,now()-interval '1 day',now()+interval '2 days');
  select id into entry_id from public.register_tournament_prediction_entry(campaign,gen_random_uuid(),'Pessoa Teste','Pessoa T.','bet-test@tests.invalid','27999999999',repeat('a',64));

  insert into public.tournament_matches(id,tournament_id,category_id,round_no,round_code,match_no,side1_athlete_id,match_date,match_time,status,published)
    values(final_game,t,c,2,'FINAL',1,a,d,'23:59','PENDING',true);
  if (select prediction_opened_at is not null from public.tournament_matches where id=final_game) then raise exception 'Incomplete game opened'; end if;
  update public.tournament_matches set side2_athlete_id=b where id=final_game;
  select prediction_opened_at into opened from public.tournament_matches where id=final_game;
  if opened is null then raise exception 'New final did not open'; end if;
  select * into w from private.tournament_prediction_window(final_game);
  if w.closes_at is distinct from ((d+time '23:59') at time zone 'America/Sao_Paulo') then raise exception 'Final inherited morning cutoff'; end if;
  request:=gen_random_uuid();
  select * into result from public.save_tournament_prediction(campaign,entry_id,repeat('a',64),final_game,a,request);
  if result.predicted_winner_athlete_id<>a then raise exception 'Save failed'; end if;
  perform public.save_tournament_prediction(campaign,entry_id,repeat('a',64),final_game,a,request);
  select count(*) into n from public.tournament_predictions where match_id=final_game;
  if n<>1 then raise exception 'Duplicate prediction'; end if;

  update public.tournament_matches set sort_order=90 where id=final_game;
  if (select prediction_opened_at is distinct from opened from public.tournament_matches where id=final_game) then raise exception 'Editing reopened'; end if;
  update public.tournament_matches set match_time=null where id=final_game;
  select * into w from private.tournament_prediction_window(final_game);
  if w.closes_at is distinct from ((d+1)::timestamp at time zone 'America/Sao_Paulo') then raise exception 'Apos deadline wrong'; end if;
  perform public.save_tournament_prediction(campaign,entry_id,repeat('a',64),final_game,b,gen_random_uuid());

  update public.tournaments set is_published=true where id=t;
  insert into public.tournament_push_subscriptions(tournament_id,endpoint,endpoint_hash,p256dh,auth_key,subscription_token_hash)
    values(t,'https://push.tests.invalid/'||t,repeat('b',64),repeat('a',32),repeat('a',16),repeat('c',64));
  q1:=private.enqueue_prediction_release_notifications(array[final_game],'bet-test:'||final_game);
  q2:=private.enqueue_prediction_release_notifications(array[final_game],'bet-test:'||final_game);
  if q1<1 or q2<>0 then raise exception 'Notification dedupe failed: %, %',q1,q2; end if;
  update public.tournament_matches set status='IN_PROGRESS' where id=final_game;
  if (select started_at is null from public.tournament_matches where id=final_game) then raise exception 'Missing start timestamp'; end if;
  begin
    perform public.save_tournament_prediction(campaign,entry_id,repeat('a',64),final_game,a,gen_random_uuid());
    raise exception 'Started game allowed prediction';
  exception when sqlstate 'P0001' then
    if sqlerrm<>'prediction_locked' then raise; end if;
  end;
  update public.tournament_matches set status='PENDING' where id=final_game;
  begin
    perform public.save_tournament_prediction(campaign,entry_id,repeat('a',64),final_game,a,gen_random_uuid());
    raise exception 'Clearing status reopened started game';
  exception when sqlstate 'P0001' then
    if sqlerrm<>'prediction_locked' then raise; end if;
  end;
  update public.tournament_matches set match_date=d+1 where id=final_game;
  if (select prediction_opened_at is not null from public.tournament_matches where id=final_game) then raise exception 'Old release carried to next day'; end if;

  insert into public.tournament_matches(id,tournament_id,category_id,round_no,round_code,match_no,side1_athlete_id,side2_athlete_id,match_date,match_time,status,published)
    values(ordinary,t,c,1,'QF',2,a,b,d,'23:58','PENDING',true);
  update public.tournament_matches set prediction_opened_at=null,prediction_opened_on=null where id=ordinary;
  begin
    perform public.save_tournament_prediction(campaign,entry_id,repeat('a',64),ordinary,a,gen_random_uuid());
    raise exception 'Old daily game reopened';
  exception when sqlstate 'P0001' then
    if sqlerrm<>'prediction_locked' then raise; end if;
  end;
  if has_function_privilege('anon','public.claim_tournament_prediction_push_dispatches(integer)','execute')
    or has_table_privilege('authenticated','public.tournament_prediction_push_dispatches','select') then raise exception 'Queue exposed'; end if;
end;
$test$;
select 'same_day_release_save_lock_dedupe_permissions_passed' as result;
rollback;
