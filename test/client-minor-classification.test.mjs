import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../adm/index.html', import.meta.url), 'utf8');
const start = html.indexOf('    function isMinorBirthDate(');
const end = html.indexOf('    function updateClientMinorFields(', start);
const context = vm.createContext({ localDateString: () => '2026-11-10' });
vm.runInContext(html.slice(start, end), context);

test('adult birth date overrides stale responsible details', () => {
  for (const guardianPhone of ['', '27999999999']) {
    assert.equal(context.clientIsMinor({ birthDate: '1988-04-12', guardian: 'Adulto fictício', guardianPhone }), false);
  }
});
test('minors remain classified as minors even without responsible details', () => {
  assert.equal(context.clientIsMinor({ birthDate: '2015-03-20' }), true);
  assert.equal(context.clientIsMinor({ birthDate: '2008-11-11' }), true);
  assert.equal(context.clientIsMinor({ birthDate: '2008-11-10' }), false);
});
test('missing birth date preserves legacy responsible indication', () => {
  assert.equal(context.clientIsMinor({ guardian: 'Responsável fictício' }), true);
  assert.equal(context.clientIsMinor({ guardianPhone: '27999999999' }), true);
  assert.equal(context.clientIsMinor({}), false);
});
test('editor initializes the minor checkbox using birth date precedence and retains minor validation', () => {
  assert.match(html, /\$\('clientEditMinor'\)\.checked = clientIsMinor\(client\)/);
  assert.match(html, /if \(infoChanged && minor && \(!guardian \|\| !guardianPhone\)\) throw new Error\('Informe o responsável e o telefone do menor\.'/);
});
