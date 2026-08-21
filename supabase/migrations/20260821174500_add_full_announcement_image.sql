alter table public.app_announcements
  add column if not exists image_full_url text;

comment on column public.app_announcements.image_url is
  'Recorte 16:9 usado como capa do comunicado.';
comment on column public.app_announcements.image_full_url is
  'Imagem completa exibida ao abrir o comunicado.';
