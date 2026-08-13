-- Expande somente o torneio fictício para testar chaves completas de 16.
-- 64 inscrições (16 por classe/equipe) e 60 partidas (15 por chave).

do $$
declare
  demo_tournament_id uuid;
  category_row record;
  roster_count integer;
  match_count integer;
begin
  select t.id into demo_tournament_id
  from public.tournaments t
  where t.slug = 'ilha-open-2026-teste'
    and coalesce(t.settings->>'demo', 'false') = 'true';

  if demo_tournament_id is null then
    raise exception 'O torneio fictício esperado não foi encontrado.';
  end if;

  create temporary table _demo_roster (
    category_code text not null,
    seed_number integer not null,
    source_key text not null,
    full_name text not null,
    gender text not null,
    city text not null,
    club_name text not null,
    partner_name text,
    public_name text not null,
    primary key (category_code, seed_number),
    unique (category_code, source_key)
  ) on commit drop;

  insert into _demo_roster values
    ('A-M',1,'demo16:a:andre-azevedo','André Azevedo','MALE','Colatina','Ilha Tênis',null,'André Azevedo'),
    ('A-M',2,'demo16:a:bruno-valenca','Bruno Valença','MALE','Vitória','Clube Vitória',null,'Bruno Valença'),
    ('A-M',3,'demo16:a:caio-menezes','Caio Menezes','MALE','Linhares','Arena Norte',null,'Caio Menezes'),
    ('A-M',4,'demo16:a:daniel-tavares','Daniel Tavares','MALE','Aracruz','Tênis Aracruz',null,'Daniel Tavares'),
    ('A-M',5,'demo16:a:enzo-ribeiro','Enzo Ribeiro','MALE','Colatina','Ilha Tênis',null,'Enzo Ribeiro'),
    ('A-M',6,'demo16:a:fabio-lacerda','Fábio Lacerda','MALE','Serra','Tênis Serra',null,'Fábio Lacerda'),
    ('A-M',7,'demo16:a:gustavo-neves','Gustavo Neves','MALE','Colatina','Ilha Tênis',null,'Gustavo Neves'),
    ('A-M',8,'demo16:a:heitor-braga','Heitor Braga','MALE','Linhares','Arena Norte',null,'Heitor Braga'),
    ('A-M',9,'demo16:a:icaro-peixoto','Ícaro Peixoto','MALE','Vitória','Clube Vitória',null,'Ícaro Peixoto'),
    ('A-M',10,'demo16:a:julio-brandao','Júlio Brandão','MALE','Colatina','Ilha Tênis',null,'Júlio Brandão'),
    ('A-M',11,'demo16:a:kaua-siqueira','Kauã Siqueira','MALE','Aracruz','Tênis Aracruz',null,'Kauã Siqueira'),
    ('A-M',12,'demo16:a:leonardo-paiva','Leonardo Paiva','MALE','Serra','Tênis Serra',null,'Leonardo Paiva'),
    ('A-M',13,'demo16:a:murilo-campos','Murilo Campos','MALE','Colatina','Ilha Tênis',null,'Murilo Campos'),
    ('A-M',14,'demo16:a:nicolas-dutra','Nicolas Dutra','MALE','Linhares','Arena Norte',null,'Nicolas Dutra'),
    ('A-M',15,'demo16:a:otavio-farias','Otávio Farias','MALE','Vitória','Clube Vitória',null,'Otávio Farias'),
    ('A-M',16,'demo16:a:pedro-vilela','Pedro Vilela','MALE','Colatina','Ilha Tênis',null,'Pedro Vilela'),

    ('B-M',1,'demo:eduardo-nunes','Eduardo Nunes','MALE','Colatina','Ilha Tênis',null,'Eduardo Nunes'),
    ('B-M',2,'demo:felipe-costa','Felipe Costa','MALE','Linhares','Arena Norte',null,'Felipe Costa'),
    ('B-M',3,'demo:igor-freitas','Igor Freitas','MALE','Colatina','Ilha Tênis',null,'Igor Freitas'),
    ('B-M',4,'demo:joao-dias','João Dias','MALE','Aracruz','Tênis Aracruz',null,'João Dias'),
    ('B-M',5,'demo:lucas-serra','Lucas Serra','MALE','Colatina','Ilha Tênis',null,'Lucas Serra'),
    ('B-M',6,'demo16:b:rafael-coutinho','Rafael Coutinho','MALE','Vitória','Clube Vitória',null,'Rafael Coutinho'),
    ('B-M',7,'demo16:b:samuel-moraes','Samuel Moraes','MALE','Linhares','Arena Norte',null,'Samuel Moraes'),
    ('B-M',8,'demo:gabriel-melo','Gabriel Melo','MALE','Colatina','Ilha Tênis',null,'Gabriel Melo'),
    ('B-M',9,'demo:henrique-silva','Henrique Silva','MALE','Vitória','Clube Vitória',null,'Henrique Silva'),
    ('B-M',10,'demo16:b:tiago-bastos','Tiago Bastos','MALE','Serra','Tênis Serra',null,'Tiago Bastos'),
    ('B-M',11,'demo16:b:vinicius-prado','Vinícius Prado','MALE','Colatina','Ilha Tênis',null,'Vinícius Prado'),
    ('B-M',12,'demo16:b:wesley-martins','Wesley Martins','MALE','Aracruz','Tênis Aracruz',null,'Wesley Martins'),
    ('B-M',13,'demo16:b:yuri-cardoso','Yuri Cardoso','MALE','Linhares','Arena Norte',null,'Yuri Cardoso'),
    ('B-M',14,'demo16:b:arthur-lopes','Arthur Lopes','MALE','Colatina','Ilha Tênis',null,'Arthur Lopes'),
    ('B-M',15,'demo16:b:bernardo-ferraz','Bernardo Ferraz','MALE','Vitória','Clube Vitória',null,'Bernardo Ferraz'),
    ('B-M',16,'demo:marcos-reis','Marcos Reis','MALE','Linhares','Arena Norte',null,'Marcos Reis'),

    ('C-F',1,'demo:ana-lima','Ana Lima','FEMALE','Colatina','Ilha Tênis',null,'Ana Lima'),
    ('C-F',2,'demo:bruna-matos','Bruna Matos','FEMALE','Linhares','Arena Norte',null,'Bruna Matos'),
    ('C-F',3,'demo:camila-rocha','Camila Rocha','FEMALE','Colatina','Ilha Tênis',null,'Camila Rocha'),
    ('C-F',4,'demo:diana-pires','Diana Pires','FEMALE','Baixo Guandu','Tênis BG',null,'Diana Pires'),
    ('C-F',5,'demo16:c:elisa-monteiro','Elisa Monteiro','FEMALE','Vitória','Clube Vitória',null,'Elisa Monteiro'),
    ('C-F',6,'demo16:c:fernanda-alves','Fernanda Alves','FEMALE','Colatina','Ilha Tênis',null,'Fernanda Alves'),
    ('C-F',7,'demo16:c:gabriela-torres','Gabriela Torres','FEMALE','Linhares','Arena Norte',null,'Gabriela Torres'),
    ('C-F',8,'demo16:c:helena-duarte','Helena Duarte','FEMALE','Aracruz','Tênis Aracruz',null,'Helena Duarte'),
    ('C-F',9,'demo16:c:isabela-gomes','Isabela Gomes','FEMALE','Colatina','Ilha Tênis',null,'Isabela Gomes'),
    ('C-F',10,'demo16:c:julia-rezende','Júlia Rezende','FEMALE','Vitória','Clube Vitória',null,'Júlia Rezende'),
    ('C-F',11,'demo16:c:larissa-pinto','Larissa Pinto','FEMALE','Serra','Tênis Serra',null,'Larissa Pinto'),
    ('C-F',12,'demo16:c:marina-coelho','Marina Coelho','FEMALE','Colatina','Ilha Tênis',null,'Marina Coelho'),
    ('C-F',13,'demo16:c:natalia-barros','Natália Barros','FEMALE','Linhares','Arena Norte',null,'Natália Barros'),
    ('C-F',14,'demo16:c:olivia-castro','Olívia Castro','FEMALE','Aracruz','Tênis Aracruz',null,'Olívia Castro'),
    ('C-F',15,'demo16:c:paula-teixeira','Paula Teixeira','FEMALE','Colatina','Ilha Tênis',null,'Paula Teixeira'),
    ('C-F',16,'demo16:c:renata-nogueira','Renata Nogueira','FEMALE','Vitória','Clube Vitória',null,'Renata Nogueira'),

    ('D-MIX',1,'demo16:d:alice-moura','Alice Moura','FEMALE','Colatina','Ilha Tênis','Alexandre Rocha','Alice Moura / Alexandre Rocha'),
    ('D-MIX',2,'demo16:d:beatriz-freire','Beatriz Freire','FEMALE','Vitória','Clube Vitória','Carlos Viana','Beatriz Freire / Carlos Viana'),
    ('D-MIX',3,'demo16:d:carolina-luz','Carolina Luz','FEMALE','Linhares','Arena Norte','Diego Amaral','Carolina Luz / Diego Amaral'),
    ('D-MIX',4,'demo16:d:debora-falcao','Débora Falcão','FEMALE','Aracruz','Tênis Aracruz','Emanuel Pacheco','Débora Falcão / Emanuel Pacheco'),
    ('D-MIX',5,'demo16:d:estela-barcellos','Estela Barcellos','FEMALE','Colatina','Ilha Tênis','Fernando Queiroz','Estela Barcellos / Fernando Queiroz'),
    ('D-MIX',6,'demo16:d:flavia-moreira','Flávia Moreira','FEMALE','Serra','Tênis Serra','Guilherme Rios','Flávia Moreira / Guilherme Rios'),
    ('D-MIX',7,'demo16:d:giovana-sales','Giovana Sales','FEMALE','Linhares','Arena Norte','Hugo Matias','Giovana Sales / Hugo Matias'),
    ('D-MIX',8,'demo16:d:heloisa-porto','Heloísa Porto','FEMALE','Colatina','Ilha Tênis','Ian Carvalho','Heloísa Porto / Ian Carvalho'),
    ('D-MIX',9,'demo16:d:iara-mendes','Iara Mendes','FEMALE','Vitória','Clube Vitória','José Antunes','Iara Mendes / José Antunes'),
    ('D-MIX',10,'demo16:d:karen-batista','Karen Batista','FEMALE','Aracruz','Tênis Aracruz','Leandro Nóbrega','Karen Batista / Leandro Nóbrega'),
    ('D-MIX',11,'demo16:d:luana-salles','Luana Salles','FEMALE','Colatina','Ilha Tênis','Mateus Galvão','Luana Salles / Mateus Galvão'),
    ('D-MIX',12,'demo16:d:manuela-prado','Manuela Prado','FEMALE','Linhares','Arena Norte','Nathan Rezende','Manuela Prado / Nathan Rezende'),
    ('D-MIX',13,'demo16:d:nicole-freitas','Nicole Freitas','FEMALE','Serra','Tênis Serra','Oscar Vieira','Nicole Freitas / Oscar Vieira'),
    ('D-MIX',14,'demo16:d:priscila-cunha','Priscila Cunha','FEMALE','Colatina','Ilha Tênis','Paulo Afonso','Priscila Cunha / Paulo Afonso'),
    ('D-MIX',15,'demo16:d:raquel-vasconcelos','Raquel Vasconcelos','FEMALE','Vitória','Clube Vitória','Ricardo Mota','Raquel Vasconcelos / Ricardo Mota'),
    ('D-MIX',16,'demo16:d:sofia-andrade','Sofia Andrade','FEMALE','Linhares','Arena Norte','Thiago Camargo','Sofia Andrade / Thiago Camargo');

  update public.tournament_categories
  set draw_size = 16,
      max_entries = 16,
      registration_open = true,
      active = true,
      is_published = true,
      updated_at = now()
  where tournament_id = demo_tournament_id
    and code in ('A-M','B-M','C-F','D-MIX');

  insert into public.tournament_athletes (
    source_key, full_name, nickname, gender, city, club_name, ranking,
    status, active, notes
  )
  select distinct on (r.source_key)
    r.source_key, r.full_name, split_part(r.full_name, ' ', 1), r.gender,
    r.city, r.club_name, r.seed_number, 'ACTIVE', true, 'DEMO — atleta fictício'
  from _demo_roster r
  order by r.source_key, r.category_code
  on conflict (source_key) do update set
    full_name = excluded.full_name,
    gender = excluded.gender,
    city = excluded.city,
    club_name = excluded.club_name,
    active = true,
    notes = 'DEMO — atleta fictício',
    updated_at = now();

  -- Remove cobranças fictícias órfãs antes de substituir inscrições antigas.
  delete from public.tournament_payments payment
  using public.tournament_registrations registration,
        public.tournament_categories category,
        public.tournament_athletes athlete
  where payment.registration_id = registration.id
    and registration.tournament_id = demo_tournament_id
    and category.id = registration.category_id
    and category.code in ('A-M','B-M','C-F','D-MIX')
    and athlete.id = registration.athlete_id
    and registration.source = 'DEMO'
    and not exists (
      select 1 from _demo_roster roster
      where roster.category_code = category.code
        and roster.source_key = athlete.source_key
    );

  -- Remove somente inscrições fictícias antigas que não pertencem ao roster final.
  delete from public.tournament_registrations registration
  using public.tournament_categories category, public.tournament_athletes athlete
  where registration.tournament_id = demo_tournament_id
    and category.id = registration.category_id
    and category.code in ('A-M','B-M','C-F','D-MIX')
    and athlete.id = registration.athlete_id
    and registration.source = 'DEMO'
    and not exists (
      select 1 from _demo_roster roster
      where roster.category_code = category.code
        and roster.source_key = athlete.source_key
    );

  insert into public.tournament_registrations (
    tournament_id, category_id, athlete_id, public_name, public_city,
    public_club, partner_name, seed_number, status, payment_status,
    total_amount, paid_amount, source, published, confirmed_at, notes
  )
  select demo_tournament_id, category.id, athlete.id, roster.public_name,
    roster.city, roster.club_name, roster.partner_name, roster.seed_number,
    'CONFIRMED', 'PAID', category.registration_fee, category.registration_fee,
    'DEMO', true, now(), 'DEMO — inscrição fictícia'
  from _demo_roster roster
  join public.tournament_categories category
    on category.tournament_id = demo_tournament_id
   and category.code = roster.category_code
  join public.tournament_athletes athlete on athlete.source_key = roster.source_key
  on conflict (tournament_id, category_id, athlete_id) do update set
    public_name = excluded.public_name,
    public_city = excluded.public_city,
    public_club = excluded.public_club,
    partner_name = excluded.partner_name,
    seed_number = excluded.seed_number,
    status = 'CONFIRMED',
    payment_status = 'PAID',
    total_amount = excluded.total_amount,
    paid_amount = excluded.paid_amount,
    source = 'DEMO',
    published = true,
    confirmed_at = coalesce(public.tournament_registrations.confirmed_at, now()),
    updated_at = now();

  -- Mantém a área financeira coerente para os testes do torneio fictício.
  insert into public.tournament_payments (
    tournament_id, registration_id, provider, provider_payment_id,
    external_reference, billing_type, status, amount, raw_response, paid_at
  )
  select registration.tournament_id, registration.id, 'DEMO',
    'demo16-' || registration.id,
    'demo16-' || registration.id,
    'PIX', 'CONFIRMED', registration.total_amount,
    jsonb_build_object('demo', true, 'generated', true), now()
  from public.tournament_registrations registration
  join public.tournament_categories category on category.id = registration.category_id
  where registration.tournament_id = demo_tournament_id
    and category.code in ('A-M','B-M','C-F','D-MIX')
    and registration.status = 'CONFIRMED'
    and registration.source = 'DEMO'
  on conflict (registration_id) do update set
    provider = excluded.provider,
    provider_payment_id = excluded.provider_payment_id,
    external_reference = excluded.external_reference,
    billing_type = excluded.billing_type,
    status = excluded.status,
    amount = excluded.amount,
    raw_response = excluded.raw_response,
    paid_at = excluded.paid_at,
    updated_at = now();

  -- A chave anterior é substituída somente neste torneio fictício.
  delete from public.tournament_matches match
  using public.tournament_categories category
  where match.category_id = category.id
    and category.tournament_id = demo_tournament_id
    and category.code in ('A-M','B-M','C-F','D-MIX');

  create temporary table _demo_matches (
    category_id uuid not null,
    category_code text not null,
    id uuid primary key,
    round_no integer not null,
    round_code text not null,
    match_no integer not null,
    source1_match_id uuid,
    source2_match_id uuid,
    side1_seed integer,
    side2_seed integer,
    match_date date not null,
    match_time time not null,
    court_name text not null,
    sort_order integer not null
  ) on commit drop;

  insert into _demo_matches
  select category.id, category.code,
    md5('ilha-open-2026-teste|' || category.code || '|r1|m' || pair.match_no)::uuid,
    1, 'R16', pair.match_no, null, null, pair.seed1, pair.seed2,
    '2026-09-18'::date,
    ('08:00'::time + (((category.sort_order / 10 - 1) * 8 + pair.match_no - 1) / 3) * interval '1 hour')::time,
    'Quadra ' || (1 + (((category.sort_order / 10 - 1) * 8 + pair.match_no - 1) % 3)),
    1000 + pair.match_no * 10
  from public.tournament_categories category
  cross join (values
    (1,1,16),(2,8,9),(3,5,12),(4,4,13),
    (5,3,14),(6,6,11),(7,7,10),(8,2,15)
  ) as pair(match_no,seed1,seed2)
  where category.tournament_id = demo_tournament_id
    and category.code in ('A-M','B-M','C-F','D-MIX');

  insert into _demo_matches
  select category.id, category.code,
    md5('ilha-open-2026-teste|' || category.code || '|r2|m' || game.match_no)::uuid,
    2, 'QF', game.match_no,
    md5('ilha-open-2026-teste|' || category.code || '|r1|m' || game.source1)::uuid,
    md5('ilha-open-2026-teste|' || category.code || '|r1|m' || game.source2)::uuid,
    null, null, '2026-09-19'::date,
    ('08:00'::time + (((category.sort_order / 10 - 1) * 4 + game.match_no - 1) / 3) * interval '1 hour')::time,
    'Quadra ' || (1 + (((category.sort_order / 10 - 1) * 4 + game.match_no - 1) % 3)),
    2000 + game.match_no * 10
  from public.tournament_categories category
  cross join (values (1,1,2),(2,3,4),(3,5,6),(4,7,8)) as game(match_no,source1,source2)
  where category.tournament_id = demo_tournament_id
    and category.code in ('A-M','B-M','C-F','D-MIX');

  insert into _demo_matches
  select category.id, category.code,
    md5('ilha-open-2026-teste|' || category.code || '|r3|m' || game.match_no)::uuid,
    3, 'SF', game.match_no,
    md5('ilha-open-2026-teste|' || category.code || '|r2|m' || game.source1)::uuid,
    md5('ilha-open-2026-teste|' || category.code || '|r2|m' || game.source2)::uuid,
    null, null, '2026-09-20'::date,
    ('08:00'::time + (((category.sort_order / 10 - 1) * 2 + game.match_no - 1) / 3) * interval '1 hour')::time,
    'Quadra ' || (1 + (((category.sort_order / 10 - 1) * 2 + game.match_no - 1) % 3)),
    3000 + game.match_no * 10
  from public.tournament_categories category
  cross join (values (1,1,2),(2,3,4)) as game(match_no,source1,source2)
  where category.tournament_id = demo_tournament_id
    and category.code in ('A-M','B-M','C-F','D-MIX');

  insert into _demo_matches
  select category.id, category.code,
    md5('ilha-open-2026-teste|' || category.code || '|r4|m1')::uuid,
    4, 'FINAL', 1,
    md5('ilha-open-2026-teste|' || category.code || '|r3|m1')::uuid,
    md5('ilha-open-2026-teste|' || category.code || '|r3|m2')::uuid,
    null, null, '2026-09-20'::date,
    ('15:00'::time + ((category.sort_order / 10 - 1) / 3) * interval '1 hour')::time,
    'Quadra ' || (1 + ((category.sort_order / 10 - 1) % 3)),
    4000 + 10
  from public.tournament_categories category
  where category.tournament_id = demo_tournament_id
    and category.code in ('A-M','B-M','C-F','D-MIX');

  insert into public.tournament_matches (
    id, legacy_key, tournament_id, category_id, round_no, round_code,
    phase, match_no, side1_athlete_id, side2_athlete_id,
    source1_match_id, source2_match_id, court_name, match_date, match_time,
    status, sort_order, published, metadata
  )
  select game.id,
    'demo16:' || lower(game.category_code) || ':r' || game.round_no || ':m' || game.match_no,
    demo_tournament_id, game.category_id, game.round_no, game.round_code,
    game.round_code, game.match_no,
    side1.id, side2.id, game.source1_match_id, game.source2_match_id,
    game.court_name, game.match_date, game.match_time,
    'SCHEDULED', game.sort_order, true,
    jsonb_build_object('demo', true, 'generated', true, 'draw_size', 16)
  from _demo_matches game
  left join _demo_roster roster1
    on roster1.category_code = game.category_code and roster1.seed_number = game.side1_seed
  left join _demo_roster roster2
    on roster2.category_code = game.category_code and roster2.seed_number = game.side2_seed
  left join public.tournament_athletes side1 on side1.source_key = roster1.source_key
  left join public.tournament_athletes side2 on side2.source_key = roster2.source_key;

  -- Valida a carga antes de concluir a transação.
  if (select count(*) from public.tournament_registrations r
      join public.tournament_categories c on c.id = r.category_id
      where r.tournament_id = demo_tournament_id
        and c.code in ('A-M','B-M','C-F','D-MIX')
        and r.status = 'CONFIRMED') <> 64 then
    raise exception 'A carga demo não produziu 64 inscrições confirmadas.';
  end if;

  if (select count(*) from public.tournament_matches m
      join public.tournament_categories c on c.id = m.category_id
      where m.tournament_id = demo_tournament_id
        and c.code in ('A-M','B-M','C-F','D-MIX')) <> 60 then
    raise exception 'A carga demo não produziu 60 partidas.';
  end if;

  if (select count(*) from public.tournament_payments payment
      join public.tournament_registrations registration on registration.id = payment.registration_id
      join public.tournament_categories category on category.id = registration.category_id
      where registration.tournament_id = demo_tournament_id
        and category.code in ('A-M','B-M','C-F','D-MIX')
        and registration.source = 'DEMO'
        and payment.status = 'CONFIRMED') <> 64 then
    raise exception 'A carga demo não produziu 64 pagamentos confirmados.';
  end if;

  for category_row in
    select c.id, c.code from public.tournament_categories c
    where c.tournament_id = demo_tournament_id
      and c.code in ('A-M','B-M','C-F','D-MIX')
  loop
    select count(*) into roster_count
    from public.tournament_registrations r
    where r.category_id = category_row.id and r.status = 'CONFIRMED';

    select count(*) into match_count
    from public.tournament_matches m
    where m.category_id = category_row.id;

    if roster_count <> 16 or match_count <> 15 then
      raise exception 'Classe % incompleta: % inscrições, % partidas.', category_row.code, roster_count, match_count;
    end if;

    if exists (
      select 1 from (values (1,8),(2,4),(3,2),(4,1)) expected(round_no,amount)
      where (select count(*) from public.tournament_matches m
             where m.category_id = category_row.id
               and m.round_no = expected.round_no) <> expected.amount
    ) then
      raise exception 'Distribuição de rodadas inválida na classe %.', category_row.code;
    end if;
  end loop;

  if exists (
    select 1
    from public.tournament_matches m
    where m.tournament_id = demo_tournament_id
      and m.round_no = 1
      and (m.side1_athlete_id is null or m.side2_athlete_id is null)
  ) then
    raise exception 'Há confronto da primeira rodada sem dois lados.';
  end if;

  if exists (
    select 1
    from public.tournament_matches m
    where m.tournament_id = demo_tournament_id
      and not exists (
        select 1 from public.tournament_registrations r
        where r.tournament_id = m.tournament_id
          and r.category_id = m.category_id
          and r.status = 'CONFIRMED'
          and r.athlete_id = m.side1_athlete_id
      )
      and m.side1_athlete_id is not null
  ) then
    raise exception 'Há atleta na chave sem inscrição confirmada.';
  end if;

  if exists (
    select 1
    from public.tournament_matches m
    where m.tournament_id = demo_tournament_id
      and not exists (
        select 1 from public.tournament_registrations r
        where r.tournament_id = m.tournament_id
          and r.category_id = m.category_id
          and r.status = 'CONFIRMED'
          and r.athlete_id = m.side2_athlete_id
      )
      and m.side2_athlete_id is not null
  ) then
    raise exception 'Há atleta no segundo lado da chave sem inscrição confirmada.';
  end if;

  if exists (
    select 1 from public.tournament_matches m
    where m.tournament_id = demo_tournament_id
      and m.match_date is not null and m.match_time is not null and m.court_name is not null
    group by m.match_date, m.match_time, m.court_name
    having count(*) > 1
  ) then
    raise exception 'A agenda fictícia contém choque de quadra e horário.';
  end if;
end
$$;
