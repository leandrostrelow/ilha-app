import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const publicPage = await readFile(new URL('../torneios/index.html', import.meta.url), 'utf8');

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `função ausente: ${name}`);
  const next = source.indexOf('\n    function ', start + 1);
  return source.slice(start, next >= 0 ? next : undefined);
}

test('convite privado abre o cadastro mesmo com inscrições públicas encerradas', () => {
  const renderer = functionSource(publicPage, 'renderRegistrationOnly');
  const opener = functionSource(publicPage, 'openRegistration');
  assert.match(renderer, /state\.inviteMode \|\| isRegistrationOpen\(item\)/);
  assert.match(opener, /!state\.inviteMode && !isRegistrationOpen\(item\)/);
});

test('cabeçalho identifica que o convite continua liberado', () => {
  const hero = functionSource(publicPage, 'heroMetaHtml');
  assert.match(hero, /state\.inviteMode === true/);
  assert.match(hero, /Convite liberado/);
});

test('convite privado enxerga classes fechadas ao público, mas nunca classes inativas', () => {
  const availability = functionSource(publicPage, 'categoryAcceptsRegistration');
  assert.ok(
    availability.indexOf("active === false") < availability.indexOf('state.inviteMode'),
    'a validação da classe inativa deve acontecer antes da exceção do convite',
  );
  assert.ok(
    availability.indexOf('state.inviteMode') < availability.indexOf("['CLOSED','ENCERRADA','INATIVA']"),
    'o convite deve ignorar apenas o fechamento público da classe',
  );
});
