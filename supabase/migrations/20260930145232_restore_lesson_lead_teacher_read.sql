-- The lesson lead administrator uses the service role to load the active teacher
-- selector alongside the protected lead list. Keep this explicit because a partial
-- table grant previously caused the auxiliary lookup to hide every saved lead.
grant select on table public.teachers to service_role;
