begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare
  t uuid; dm uuid; dx uuid; sm uuid; si uuid; di uuid;
  payer jsonb := '{"full_name":"Teste Responsável Simples","cpf":"99999999981","email":"simple-test@example.invalid","phone":"27999999981"}';
  people jsonb := '[{"key":"a","full_name":"Teste Criança Simplificada","birth_date":"2017-01-01","gender":"MALE"},{"key":"b","full_name":"Teste Parceiro Simplificado","gender":"MALE"},{"key":"c","full_name":"Teste Parceira Simplificada","gender":"FEMALE"}]';
  r jsonb; again jsonb; entries jsonb; token uuid:=gen_random_uuid(); denied boolean; original_id uuid;
begin
  select id into t from public.tournaments where slug='ilha-pickleball-open-2026';
  select id into dm from public.tournament_categories where tournament_id=t and code='PB-DM';
  select id into dx from public.tournament_categories where tournament_id=t and code='PB-DX';
  select id into sm from public.tournament_categories where tournament_id=t and code='PB-SM';
  select id into si from public.tournament_categories where tournament_id=t and code='PB-SI';
  select id into di from public.tournament_categories where tournament_id=t and code='PB-DI';
  entries:=jsonb_build_array(jsonb_build_object('category_id',dm,'members','["a","b"]'::jsonb),
    jsonb_build_object('category_id',dx,'members','["a","c"]'::jsonb),jsonb_build_object('category_id',sm,'members','["a"]'::jsonb));
  r:=public.claim_tournament_package_checkout(t,token,payer,people,entries,'SANDBOX');
  if (r#>>'{registration_group,total_amount}')::numeric<>190 then raise exception 'Names-only first three tiers failed'; end if;
  select athlete_id into original_id from public.tournament_registrations where registration_group_id=(r#>>'{registration_group,id}')::uuid limit 1;
  if exists(select 1 from public.tournament_athletes where id=original_id and cpf is not null) then raise exception 'Participant CPF invented'; end if;
  if exists(select 1 from public.tournament_athletes where full_name='Teste Parceiro Simplificado' and birth_date is not null) then raise exception 'Adult birthday invented'; end if;
  again:=public.claim_tournament_package_checkout(t,token,payer,people,entries,'SANDBOX');
  if again#>>'{payment,id}' is distinct from r#>>'{payment,id}' then raise exception 'Repeat created a second charge'; end if;
  update public.tournament_registrations set status='CONFIRMED',payment_status='PAID' where registration_group_id=(r#>>'{registration_group,id}')::uuid;
  -- The same name with case/accents/spacing changes is the same participant.
  again:=public.claim_tournament_package_checkout(t,gen_random_uuid(),payer,
    '[{"key":"kid","full_name":"  teste crianca   simplificada  ","birth_date":"2017-01-01","gender":"NOT_INFORMED"}]',
    jsonb_build_array(jsonb_build_object('category_id',si,'members','["kid"]'::jsonb)),'SANDBOX');
  if (again#>>'{registration_group,total_amount}')::numeric<>10 then raise exception 'Fourth class must complete R$100 with R$10'; end if;
  if (again#>>'{registrations,0,athlete_id}')::uuid<>original_id then raise exception 'Name reuse duplicated participant'; end if;
  update public.tournament_registrations set status='CONFIRMED',payment_status='PAID' where registration_group_id=(again#>>'{registration_group,id}')::uuid;
  denied:=false;
  begin
    perform public.claim_tournament_package_checkout(t,gen_random_uuid(),payer,
      jsonb_build_array(people->0,'{"key":"kid2","full_name":"Teste Segunda Criança","birth_date":"2017-01-01","gender":"NOT_INFORMED"}'::jsonb),
      jsonb_build_array(jsonb_build_object('category_id',di,'members','["a","kid2"]'::jsonb)),'SANDBOX');
  exception when sqlstate 'P0001' then denied:=true; end;
  if not denied then raise exception 'Fifth class accepted'; end if;
  denied:=false;
  begin
    perform public.claim_tournament_package_checkout(t,gen_random_uuid(),payer,
      '[{"key":"kid","full_name":"Teste Sem Nascimento","gender":"NOT_INFORMED"}]',
      jsonb_build_array(jsonb_build_object('category_id',si,'members','["kid"]'::jsonb)),'SANDBOX');
  exception when sqlstate 'P0001' then denied:=true; end;
  if not denied then raise exception 'Age category without birthday accepted'; end if;
  -- Multiple different teams in one category share a single checkout.
  again:=public.claim_tournament_package_checkout(t,gen_random_uuid(),payer,
    '[{"key":"d","full_name":"Teste Outra Dupla D","gender":"MALE"},{"key":"e","full_name":"Teste Outra Dupla E","gender":"MALE"},{"key":"f","full_name":"Teste Outra Dupla F","gender":"MALE"},{"key":"g","full_name":"Teste Outra Dupla G","gender":"MALE"}]',
    jsonb_build_array(jsonb_build_object('category_id',dm,'members','["d","e"]'::jsonb),jsonb_build_object('category_id',dm,'members','["f","g"]'::jsonb)),'SANDBOX');
  if (again#>>'{registration_group,total_amount}')::numeric<>200 or jsonb_array_length(again->'registrations')<>2 then raise exception 'Multiple teams billing failed'; end if;
  raise notice 'PASS: names only, optional adult birthdays, normalized identity, 4 classes=100, fifth denied, minors and multiple teams';
end;
$$;
rollback;
