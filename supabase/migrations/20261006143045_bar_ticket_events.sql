create table if not exists public.bar_ticket_events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  event_date date not null,
  status text not null default 'RASCUNHO' check (status in ('RASCUNHO', 'PUBLICADO', 'CANCELADO')),
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bar_ticket_events_public_date_idx
  on public.bar_ticket_events (event_date)
  where status = 'PUBLICADO';

alter table public.bar_ticket_events enable row level security;
grant select on public.bar_ticket_events to anon;
grant select, insert, update, delete on public.bar_ticket_events to authenticated;
grant all on public.bar_ticket_events to service_role;

drop policy if exists bar_ticket_events_public_read on public.bar_ticket_events;
create policy bar_ticket_events_public_read
  on public.bar_ticket_events for select to anon
  using (status = 'PUBLICADO');

drop policy if exists bar_ticket_events_staff_read on public.bar_ticket_events;
create policy bar_ticket_events_staff_read
  on public.bar_ticket_events for select to authenticated
  using ((select public.has_bar_permission('bar.events')));

drop policy if exists bar_ticket_events_staff_manage on public.bar_ticket_events;
create policy bar_ticket_events_staff_manage
  on public.bar_ticket_events for all to authenticated
  using ((select public.has_bar_permission('bar.events')))
  with check ((select public.has_bar_permission('bar.events')));

insert into public.bar_ticket_events (slug, event_date, status, content)
values (
  'halloween-ilha-2026',
  date '2026-10-29',
  'RASCUNHO',
  '{
    "title":"Halloween no Ilha",
    "eyebrow":"ILHA TENIS APRESENTA · FESTIVAL DE HALLOWEEN",
    "subtitle":"Uma noite de tênis, sabores e mistério no clube.",
    "description":"Prepare a fantasia e venha viver uma noite especial de Halloween no Ilha. Um encontro para reunir alunos, famílias e amigos, com clima de festival, boa comida e muita diversão dentro e fora das quadras.",
    "location":"Ilha Tênis · Colatina",
    "time":"Horário a confirmar",
    "audience":"Alunos, tenistas, familiares e convidados",
    "tennis":["Encontro da comunidade do tênis","Atividades e surpresas nas quadras (programação a confirmar)","Venha fantasiado e participe do clima de Halloween"],
    "buffet":[
      {"title":"Entradas e frios","items":["Queijos variados","Salaminhos","Frutas","Terrines com torradas (5 sabores: cream cheese, ricota e requeijão)","Quibe cru"]},
      {"title":"Salgadinhos","items":["Quibe","Coxinha","Pasteizinhos","Canudinhos","Empadinhas","Barquetes"]},
      {"title":"Mesa mineira","items":["Torresmo","Aipim","Linguicinha","Polenta frita","Batata calabresa"]},
      {"title":"Frutas","items":["Uvas variadas","Morango","Abacaxi","Pitaya","Goiaba","Limão","Manga"]},
      {"title":"Carnes e petiscos","items":["Carne de pernil"]},
      {"title":"Prato principal","items":["Strogonoff de filé-mignon","Arroz","Batata palha"]},
      {"title":"Bebidas sem álcool","items":["Refrigerante","Água de coco","Suco de laranja","Água sem gás","Água com gás"]},
      {"title":"Bebidas alcoólicas","items":["Chopp","Vinho","Vodka","Gin","Campari"]}
    ],
    "tickets":[],
    "salesNote":"Ingressos, valores e abertura das vendas serão divulgados em breve.",
    "salesOpen":false
  }'::jsonb
)
on conflict (slug) do nothing;
