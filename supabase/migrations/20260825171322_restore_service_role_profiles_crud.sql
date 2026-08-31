-- Restore the narrow table privileges required by trusted Edge Functions that
-- use the Supabase service role to manage linked Club/Bar/client profiles.
-- RLS remains enabled and no privileges are granted to anon/authenticated.
grant select, insert, update, delete
on table public.profiles
to service_role;
