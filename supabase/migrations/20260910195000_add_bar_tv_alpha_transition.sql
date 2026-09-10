-- Optional transparent WebM overlay played while the TV switches between the
-- menu and configured event media. It is stored separately from slideshow
-- items, so it does not consume one of the five available slots.
alter table public.bar_tv_event_art
  add column if not exists transition_url text not null default '',
  add column if not exists transition_active boolean not null default false;

alter table public.bar_tv_event_art
  drop constraint if exists bar_tv_event_art_transition_url_check,
  drop constraint if exists bar_tv_event_art_transition_active_check;

alter table public.bar_tv_event_art
  add constraint bar_tv_event_art_transition_url_check check (
    transition_url = ''
    or transition_url ~* '^https://lkqtgptebkgfwguykxhv[.]supabase[.]co/storage/v1/object/public/bar-tv-media/eventos/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+[.]webm$'
  ),
  add constraint bar_tv_event_art_transition_active_check check (
    transition_active is false or transition_url <> ''
  );

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']
where id = 'bar-tv-media';

comment on column public.bar_tv_event_art.transition_url is
  'Public URL of the short transparent WebM overlay used between TV slideshow items.';

comment on column public.bar_tv_event_art.transition_active is
  'Whether the transparent transition overlay is enabled on the Bar TV.';
