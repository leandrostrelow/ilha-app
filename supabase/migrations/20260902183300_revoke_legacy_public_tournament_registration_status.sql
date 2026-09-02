begin;

-- Payment tracking now goes exclusively through tournament-register, which
-- applies persistent token/IP rate limits and returns a privacy-safe payload.
-- Keep the legacy RPC available only to trusted backend code so a leaked
-- public token cannot bypass those controls.
revoke all on function public.tournament_public_registration_status(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.tournament_public_registration_status(uuid)
  to service_role;

commit;
