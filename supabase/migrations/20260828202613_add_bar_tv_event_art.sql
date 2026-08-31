create table if not exists public.bar_tv_event_art (
  id boolean primary key default true check (id is true),
  image_url text not null default '',
  active boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint bar_tv_event_art_image_url_check check (
    image_url = ''
    or image_url ~ '^https://lkqtgptebkgfwguykxhv[.]supabase[.]co/storage/v1/object/public/bar-products/eventos/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+$'
  )
);

comment on table public.bar_tv_event_art is
  'Singleton public event poster shown on the Ilha Bar television menu.';

alter table public.bar_tv_event_art enable row level security;

revoke all on table public.bar_tv_event_art from public, anon, authenticated;
grant select on table public.bar_tv_event_art to anon, authenticated;
grant insert, update, delete on table public.bar_tv_event_art to authenticated;

drop policy if exists "public reads active bar tv event art" on public.bar_tv_event_art;
create policy "public reads active bar tv event art"
on public.bar_tv_event_art for select
to anon, authenticated
using (active is true and image_url <> '');

drop policy if exists "bar menu staff reads tv event art" on public.bar_tv_event_art;
create policy "bar menu staff reads tv event art"
on public.bar_tv_event_art for select
to authenticated
using ((select public.has_bar_permission('bar.menu')));

drop policy if exists "bar menu staff inserts tv event art" on public.bar_tv_event_art;
create policy "bar menu staff inserts tv event art"
on public.bar_tv_event_art for insert
to authenticated
with check (
  id is true
  and (select public.has_bar_permission('bar.menu'))
  and updated_by = (select auth.uid())
);

drop policy if exists "bar menu staff updates tv event art" on public.bar_tv_event_art;
create policy "bar menu staff updates tv event art"
on public.bar_tv_event_art for update
to authenticated
using ((select public.has_bar_permission('bar.menu')))
with check (
  id is true
  and (select public.has_bar_permission('bar.menu'))
  and updated_by = (select auth.uid())
);

drop policy if exists "bar menu staff deletes tv event art" on public.bar_tv_event_art;
create policy "bar menu staff deletes tv event art"
on public.bar_tv_event_art for delete
to authenticated
using ((select public.has_bar_permission('bar.menu')));

insert into public.bar_tv_event_art (id, image_url, active)
values (true, '', false)
on conflict (id) do nothing;
