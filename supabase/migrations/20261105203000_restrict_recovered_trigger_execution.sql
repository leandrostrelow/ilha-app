-- Trigger bodies are invoked by PostgreSQL, never as client RPCs.
-- This also restores the existing CI privilege contract after the recovered
-- September definitions are replayed on a clean database.
revoke all on function private.reopen_deleted_client_registration()
  from public, anon, authenticated;
revoke all on function public.guard_lesson_enrollment()
  from public, anon, authenticated;
