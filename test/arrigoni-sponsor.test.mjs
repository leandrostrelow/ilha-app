import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../torneios/index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('    function scheduleArrigoniInvite()'), html.indexOf('    setTimeout(scheduleArrigoniInvite,8000)'));
test('sponsor invitation alternates visits and remains tournament-specific', () => {
  for (const [slug, seen, registrationOnly, expected] of [
    ['ilha-open-2026', 0, false, 1],
    ['another-event', 0, false, 0],
    ['ilha-open-2026', 'skip', false, 0],
    ['ilha-open-2026', 'show', false, 1],
    ['ilha-open-2026', 0, true, 0],
  ]) {
    let scheduled = 0;
    const context = { state: { slug, registrationOnly }, localStorage: { getItem: () => seen, setItem: () => {} }, Date, setInterval: () => scheduled++ };
    vm.runInNewContext(source + '\nscheduleArrigoniInvite();', context);
    assert.equal(scheduled, expected);
  }
});
test('sponsor uses provided logo and direct contact links with accessible dismissal', () => {
  assert.match(html, /arrigoni-contabilidade\.png/);
  assert.match(html, /https:\/\/www.instagram.com\/contabilidade.arrigoni\//);
  assert.match(html, /https:\/\/contate.me\/contabilidadearrigoni/);
  assert.match(source, /dialog.showModal\(\)/);
  assert.match(source, /modal-open/);
  assert.match(source, /Fechar convite/);
  assert.match(source, /Agora não/);
});
