insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tournament-branding', 'tournament-branding', true, 2097152, array['image/png'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "tournament staff upload branding" on storage.objects;
drop policy if exists "tournament staff update branding" on storage.objects;
drop policy if exists "tournament staff delete branding" on storage.objects;

create policy "tournament staff upload branding"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'tournament-branding'
  and (select public.has_tournament_permission('tournaments.write'))
);

create policy "tournament staff update branding"
on storage.objects for update to authenticated
using (
  bucket_id = 'tournament-branding'
  and (select public.has_tournament_permission('tournaments.write'))
)
with check (
  bucket_id = 'tournament-branding'
  and (select public.has_tournament_permission('tournaments.write'))
);

create policy "tournament staff delete branding"
on storage.objects for delete to authenticated
using (
  bucket_id = 'tournament-branding'
  and (select public.has_tournament_permission('tournaments.write'))
);
