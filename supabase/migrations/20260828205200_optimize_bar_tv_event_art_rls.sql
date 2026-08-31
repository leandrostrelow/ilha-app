drop policy if exists "public reads active bar tv event art" on public.bar_tv_event_art;

create policy "public reads active bar tv event art"
on public.bar_tv_event_art
for select
to anon
using (active is true and image_url <> '');
