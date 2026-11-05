import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('new private invitations remain available after public registration closes', () => {
  const source = readFileSync(new URL('../supabase/functions/tournament-admin-api/index.ts', import.meta.url), 'utf8');
  const create = source.slice(source.indexOf('async function createRegistrationInvite('), source.indexOf('async function getRegistrationInviteShareLink('));
  assert.match(create, /const expiresAt = null;/);
  assert.match(create, /\["REGISTRATION_OPEN", "REGISTRATION_CLOSED", "IN_PROGRESS"\]/);
  assert.doesNotMatch(create, /tournament\.registration_open !== true/);
  assert.match(create, /expires_at: expiresAt/);
  assert.doesNotMatch(create, /const expiresAt = tournament\.registration_closes_at/);
});
