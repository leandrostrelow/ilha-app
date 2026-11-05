begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare
  t uuid; dm uuid; dx uuid; sm uuid; sf uuid; child uuid; juvenile uuid;
  payer jsonb := '{"full_name":"Teste Pacotes","cpf":"99999999991","email":"pickleball-test@example.invalid","phone":"27999999991"}';
  athletes jsonb := '[{"key":"a","full_name":"Teste Atleta A","cpf":"99999999991","birth_date":"1990-01-01","gender":"MALE"},{"key":"b","full_name":"Teste Atleta B","cpf":"99999999992","birth_date":"1990-01-01","gender":"MALE"},{"key":"c","full_name":"Teste Atleta C","cpf":"99999999993","birth_date":"1990-01-01","gender":"FEMALE"}]';
  r jsonb; again jsonb; token uuid:=gen_random_uuid(); entries jsonb; denied boolean; actual numeric; m uuid;
begin
  select id into t from public.tournaments where slug='ilha-pickleball-open-2026';
  if t is null then raise exception 'Draft tournament missing'; end if;
  update public.tournaments set status='REGISTRATION_OPEN',registration_open=true,is_published=true where id=t;
  select id into dm from public.tournament_categories where tournament_id=t and code='PB-DM';
  select id into dx from public.tournament_categories where tournament_id=t and code='PB-DX';
  select id into sm from public.tournament_categories where tournament_id=t and code='PB-SM';
  select id into sf from public.tournament_categories where tournament_id=t and code='PB-SF';
  select id into child from public.tournament_categories where tournament_id=t and code='PB-SI';
  select id into juvenile from public.tournament_categories where tournament_id=t and code='PB-SJ';
  entries:=jsonb_build_array(jsonb_build_object('category_id',sm,'members','["a"]'::jsonb),
    jsonb_build_object('category_id',dm,'members','["a","b"]'::jsonb),jsonb_build_object('category_id',dx,'members','["a","c"]'::jsonb));
  r:=public.claim_tournament_package_checkout(t,token,payer,athletes,entries,'SANDBOX');
  if (r#>>'{registration_group,total_amount}')::numeric <> 190 or jsonb_array_length(r->'registrations')<>3 then raise exception 'Expected 90 + 50 + 50 and 3 draw entries: %',r->'registration_group'; end if;
  if r#>>'{payment,provider_environment}'<>'SANDBOX' or (r#>>'{payment,amount}')::numeric<>190 then raise exception 'Incorrect payment outbox'; end if;
  select sum(total_amount) into actual from public.tournament_registrations where registration_group_id=(r#>>'{registration_group,id}')::uuid;
  if actual<>190 then raise exception 'Registration allocation does not balance'; end if;
  update public.tournaments set registration_open=false where id=t;
  again:=public.claim_tournament_package_checkout(t,token,payer,athletes,entries,'SANDBOX');
  if again#>>'{payment,id}' is distinct from r#>>'{payment,id}' or again->>'payment_created'<>'false' then raise exception 'Retry created a second payment'; end if;
  update public.tournaments set registration_open=true where id=t;

  denied:=false;
  begin
    perform public.claim_tournament_package_checkout(t,gen_random_uuid(),payer,jsonb_build_array(athletes->1,athletes->0),
      jsonb_build_array(jsonb_build_object('category_id',dm,'members','["b","a"]'::jsonb)),'SANDBOX');
  exception when sqlstate 'P0001' then denied:=true; end;
  if not denied then raise exception 'Duplicate reversed pair accepted'; end if;

  -- Never grant a discount backed by an unpaid/abandoned first checkout.
  denied:=false;
  begin
    perform public.claim_tournament_package_checkout(t,gen_random_uuid(),payer,jsonb_build_array(athletes->2),
      jsonb_build_array(jsonb_build_object('category_id',sf,'members','["c"]'::jsonb)),'SANDBOX');
  exception when sqlstate 'P0001' then denied:=true; end;
  if not denied then raise exception 'Discount granted against an unpaid first class'; end if;
  update public.tournament_registrations set status='CONFIRMED',payment_status='PAID'
    where registration_group_id=(r#>>'{registration_group,id}')::uuid;
  -- The partner already paid one class: second class charges only R$30.
  again:=public.claim_tournament_package_checkout(t,gen_random_uuid(),payer,jsonb_build_array(athletes->2),
    jsonb_build_array(jsonb_build_object('category_id',sf,'members','["c"]'::jsonb)),'SANDBOX');
  if (again#>>'{registration_group,total_amount}')::numeric<>30 then raise exception 'Partner tier not carried forward'; end if;
  denied:=false;
  begin
    perform public.claim_tournament_package_checkout(t,gen_random_uuid(),payer,jsonb_build_array(athletes->0),
      jsonb_build_array(jsonb_build_object('category_id',child,'members','["a"]'::jsonb)),'SANDBOX');
  exception when sqlstate 'P0001' then denied:=true; end;
  if not denied then raise exception 'Adult accepted into children category'; end if;

  -- Age boundary: 9 on opening day can play Infantil, not Juvenil.
  athletes:='[{"key":"kid","full_name":"Teste Infantil","cpf":"99999999994","birth_date":"2016-09-23","gender":"FEMALE"}]';
  again:=public.claim_tournament_package_checkout(t,gen_random_uuid(),payer,athletes,
    jsonb_build_array(jsonb_build_object('category_id',child,'members','["kid"]'::jsonb)),'SANDBOX');
  if (again#>>'{registration_group,total_amount}')::numeric<>50 then raise exception 'First class not 50'; end if;
  denied:=false;
  begin
    perform public.claim_tournament_package_checkout(t,gen_random_uuid(),payer,athletes,
      jsonb_build_array(jsonb_build_object('category_id',juvenile,'members','["kid"]'::jsonb)),'SANDBOX');
  exception when sqlstate 'P0001' then denied:=true; end;
  if not denied then raise exception 'Nine year old accepted into Juvenil'; end if;

  -- Two teams in doubles must generate one match, no final.
  athletes:='[{"key":"d","full_name":"Teste Atleta D","cpf":"99999999995","birth_date":"1990-01-01","gender":"MALE"},{"key":"e","full_name":"Teste Atleta E","cpf":"99999999996","birth_date":"1990-01-01","gender":"MALE"}]';
  again:=public.claim_tournament_package_checkout(t,gen_random_uuid(),payer,athletes,
    jsonb_build_array(jsonb_build_object('category_id',dm,'members','["d","e"]'::jsonb)),'SANDBOX');
  if (again#>>'{registration_group,total_amount}')::numeric<>100 then raise exception 'First doubles should charge 100'; end if;
  update public.tournament_registrations set status='CONFIRMED',payment_status='PAID' where tournament_id=t and category_id=dm;
  perform set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',(
    select p.id from public.profiles p join auth.users u on u.id=p.id
    join public.protected_access_accounts a on a.email=lower(trim(u.email)) and a.role=p.role and a.active
    where p.role='admin' and p.active limit 1))::text,true);
  again:=public.tournament_replace_round_robin_atomic(t,dm,(select array_agg(athlete_id order by id) from public.tournament_registrations where category_id=dm),false);
  if jsonb_array_length(again->'matches')<>1 or again#>>'{matches,0,phase}'<>'GROUP' then raise exception 'Unexpected final or match count'; end if;
  m:=(again#>>'{matches,0,id}')::uuid;
  update public.tournament_matches set score='10x8 9x11 ST12x10',winner_athlete_id=side1_athlete_id,status='FINISHED' where id=m;
  denied:=false;
  begin update public.tournament_matches set score='10x9 10x8' where id=m;
  exception when sqlstate '22023' then denied:=true; end;
  if not denied then raise exception 'Invalid one point difference accepted'; end if;
  denied:=false;
  begin update public.tournament_matches set score='10x8 10x7 ST10x5' where id=m;
  exception when sqlstate '22023' then denied:=true; end;
  if not denied then raise exception 'Third set after 2-0 accepted'; end if;
  raise notice 'PASS: pricing 50/80/90, doubles, partner increments, retry, duplication, age, group and scores';
end;
$$;
rollback;
