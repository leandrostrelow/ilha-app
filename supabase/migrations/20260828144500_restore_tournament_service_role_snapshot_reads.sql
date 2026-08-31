-- The authenticated administrator is validated before the privileged snapshot
-- client is used. Keep raw tournament data unavailable to anon/authenticated,
-- while allowing the Edge Function to assemble the redacted ADM response.
grant select on table
  public.tournament_courts,
  public.tournament_matches,
  public.tournament_schedule_events,
  public.tournament_live_state
to service_role;
