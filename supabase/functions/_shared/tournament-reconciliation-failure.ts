// PostgREST failures are plain objects, not Error instances. Keep diagnostics
// useful without logging provider responses, personal information or PIX codes.
function errorCode(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "";
  return /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : "reconciliation_error";
}

export async function deferTournamentReconciliation(
  error: unknown,
  schedule: () => Promise<boolean>,
): Promise<{ code: string; rescheduled: boolean; retry_error_code?: string }> {
  try {
    return { code: errorCode(error), rescheduled: await schedule() };
  } catch (retryError) {
    return {
      code: errorCode(error),
      rescheduled: false,
      retry_error_code: errorCode(retryError),
    };
  }
}
