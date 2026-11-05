import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../eventos/public.js', import.meta.url), 'utf8');
const escapeSource = source.match(/  const esc=.*;/)[0];
const cardSource = source.slice(source.indexOf('  function menuCard('), source.indexOf('  function render('));
const card = vm.runInNewContext(`${escapeSource}\n${cardSource}\nmenuCard`);
const categories = ['Entradas e frios', 'Salgadinhos', 'Mesa mineira', 'Frutas', 'Carnes e petiscos', 'Lanches e caldos', 'Bebidas sem álcool', 'Bebidas alcoólicas'];

test('each Halloween menu category gets a distinct, decorative, lazy PNG', async () => {
  const paths = new Set();
  for (const [index, title] of categories.entries()) {
    const html = card({ title, items: ['Item do cadastro'] }, index, true);
    const path = html.match(/src="([^"]+)"/)[1];
    paths.add(path);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /alt="".*loading="lazy" decoding="async"/);
    assert.match(html, /Item do cadastro/);
    assert.match(html, new RegExp(`data-menu-kind="${title.startsWith('Bebidas') ? 'drink' : 'food'}"`));
    const png = await readFile(new URL('..' + path, import.meta.url));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png[25], 6, `${title} keeps RGBA transparency`);
  }
  assert.equal(paths.size, 8);
});

test('menu stays editable, escapes content and does not decorate unrelated events or unknown categories', () => {
  assert.doesNotMatch(card({ title: 'Frutas', items: [] }, 0, false), /<img/);
  assert.doesNotMatch(card({ title: 'Nova categoria', items: [] }, 0, true), /<img/);
  assert.doesNotMatch(card({ title: 'constructor', items: [] }, 0, true), /<img/);
  assert.match(card({ title: ' BEBIDAS SEM ÁLCOOL ', items: [] }, 0, true), /halloween-sem-alcool\.png/);
  const escaped = card({ title: '<script>x</script>', items: ['<img onerror="x">'] }, 0, true);
  assert.doesNotMatch(escaped, /<script>|<img/);
  assert.match(escaped, /&lt;script&gt;/);
  assert.match(escaped, /&quot;x&quot;/);
});

test('the current menu replacement contains only the requested snacks and soup', async () => {
  const change = JSON.parse(await readFile(new URL('../docs/halloween-menu-2026-10-06.json', import.meta.url), 'utf8'));
  assert.equal(change.after.title, 'Lanches e caldos');
  assert.deepEqual(change.after.items, ['Cachorro-quente', 'Mini pizza', 'Caldo verde']);
  assert.doesNotMatch(source, /prato principal|strogonoff/i);
  assert.match(source, /buffet\.map\(\(group,index\)=>menuCard\(group,index,halloween,c\.drinksNote\)\)/);
});

test('alcohol card uses only the beer artwork and escapes the editable bring-your-own note', () => {
  const html = card({title:'Bebidas alcoólicas',items:['Chopp']},7,true,'Outras bebidas: <traga a sua>');
  assert.match(html,/halloween-chopp\.png/);
  assert.match(html,/Outras bebidas: &lt;traga a sua&gt;/);
  assert.doesNotMatch(card({title:'Bebidas sem álcool',items:[]},6,true,'BYOB'),/BYOB/);
});
