import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'halloween-prelista.html'), 'utf8');

test('pre-list has a distinct share URL and no ticket/payment flow', () => {
  assert.match(html, /rel="canonical" href="https:\/\/app.ilhatenis.com\/halloween-prelista"/);
  assert.doesNotMatch(html, /<form\b|<dialog\b|event-ticketing|qrcode-generator|event-ticket-tools|eventos\/public\.(?:js|css)|data-checkout/i);
  assert.doesNotMatch(html, /href="[^"\n]*(?:\/eventos\/|ingressos|checkout|pedido)/i);
  assert.doesNotMatch(html, /<script\b/);
});

test('prices are informational with all four tiers and the free-child condition', () => {
  const section = html.match(/<section class="prices shell"[\s\S]*?<\/section>/)?.[0];
  assert.ok(section);
  assert.equal((section.match(/class="price-card"/g) || []).length, 4);
  for (const text of ['Casal', 'R$ 350,00', 'Para 2 pessoas a partir de 15 anos.', 'Individual', 'R$ 195,00', 'Criança · 9 a 14 anos', 'R$ 97,50', 'Criança · até 8 anos', 'Grátis', 'junto com um ingresso individual ou de casal', 'Idade considerada no dia do evento']) {
    assert.ok(section.includes(text), text);
  }
  assert.doesNotMatch(section, /<(?:button|input|form)\b/);
  assert.ok(html.indexOf('id="valores"') > html.indexOf('id="prelista"'));
  assert.match(html, /<section class="prices shell"[\s\S]*?<\/section>\s*<\/main>/);
});

test('event details, artists and actual videos are present', () => {
  for (const text of ['30 de outubro de 2026', 'sexta-feira', '18h30 às 00h30', 'Leony Diall', 'Rafa Assis', 'Colatina', 'Cachorro-quente', 'mini pizza', 'caldo verde', 'Chopp']) {
    assert.ok(html.includes(text), text);
  }
  assert.match(html, /youtube-nocookie.com\/embed\/TBwuvu7hlJo/);
  assert.match(html, /<video controls playsinline preload="none"/);
  assert.doesNotMatch(html, /\bautoplay\b/);
});

test('all local assets and section links resolve', () => {
  for (const [, link] of html.matchAll(/(?:src|href|poster)="(\/[^"?]+)(?:\?[^"<>]*)?"/g)) {
    assert.ok(fs.existsSync(path.join(root, link)), link);
  }
  for (const [, id] of html.matchAll(/href="#([^"<>]+)"/g)) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
});

test('poster uses exact portrait 3:4 dimensions without cropping', () => {
  const file = 'assets/events/halloween-ilha-2026-poster-rafa-3x4.png';
  const png = fs.readFileSync(path.join(root, file));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.equal(width * 4, height * 3);
  assert.match(html, /class="hero-art hero-art--portrait"/);
  assert.ok(html.includes(`src="/${file}"`));
  assert.ok(html.includes(`href="/${file}"`));
  assert.ok(html.includes(`width="${width}" height="${height}" fetchpriority="high"`));
  const css = fs.readFileSync(path.join(root, 'halloween-prelista.css'), 'utf8');
  assert.match(css, /\.hero-art--portrait\{[^}]*max-width:600px;[^}]*aspect-ratio:3\/4;object-fit:contain/);
});

test('pre-list and WhatsApp action buttons are absent while the informational invitation remains', () => {
  assert.doesNotMatch(html, /href="#prelista"|wa\.me|api\.whatsapp|share-link|Vamos montar a pré-lista|Compartilhar no WhatsApp|halloween-prelista\.js/);
  const section = html.match(/<section class="section shell" id="prelista"[\s\S]*?<\/section>/)?.[0];
  assert.ok(section);
  assert.doesNotMatch(section, /<(?:a|button|form)\b/);
  assert.ok(section.includes('Quem vem'));
  assert.ok(section.includes('Informe o nome de cada participante'));
});
