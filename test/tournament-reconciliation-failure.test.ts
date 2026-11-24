import { deferTournamentReconciliation } from '../supabase/functions/_shared/tournament-reconciliation-failure.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(JSON.stringify({ actual, expected }));
}

Deno.test('PostgREST reconciliation error schedules retry and preserves safe code', async () => {
  let attempts = 0;
  const result = await deferTournamentReconciliation({ code: 'P0001', message: 'Private payment details' }, () => {
    attempts += 1;
    return Promise.resolve(true);
  });
  equal(attempts, 1);
  equal(result, { code: 'P0001', rescheduled: true });
});

Deno.test('CAS conflict does not claim retry was scheduled over newer state', async () => {
  equal(await deferTournamentReconciliation({ code: '23514' }, () => Promise.resolve(false)), {
    code: '23514', rescheduled: false,
  });
});

Deno.test('Failure to persist retry is visible without leaking provider payload', async () => {
  equal(await deferTournamentReconciliation(new Error('Sensitive provider payload'), () => {
    throw { code: '08006', message: 'Private database details' };
  }), { code: 'reconciliation_error', rescheduled: false, retry_error_code: '08006' });
});
