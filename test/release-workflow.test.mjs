import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRelease } from '../scripts/check-release.mjs';

test('a small site edit cannot republish the same or an older app version', () => {
  for (const version of ['2026-09-12.1929', '2026-10-09.0333']) {
    assert.throws(() => validateRelease({ baseVersion: '2026-10-09.0333', version, siteChanged: true }));
  }
  assert.doesNotThrow(() => validateRelease({ baseVersion: '2026-10-09.0333', version: '2026-11-05.0334', siteChanged: true }));
});
test('documentation changes need no app bump but a stale branch is rejected', () => {
  const current = { baseVersion: '2026-10-09.0333', version: '2026-10-09.0333', siteChanged: false };
  assert.doesNotThrow(() => validateRelease(current));
  assert.throws(() => validateRelease({ ...current, ancestor: false }), /main/);
});
