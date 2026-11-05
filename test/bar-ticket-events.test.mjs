import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [migration, admin, editor, publicPage, publicScript, build, vercel, serve] = await Promise.all([
  readFile(new URL('../supabase/migrations/20261006143045_bar_ticket_events.sql', import.meta.url), 'utf8'),
  readFile(new URL('../adm/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../adm/events.js', import.meta.url), 'utf8'),
  readFile(new URL('../eventos/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../eventos/public.js', import.meta.url), 'utf8'),
  readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
  readFile(new URL('../scripts/serve.mjs', import.meta.url), 'utf8'),
]);

test('ADM Bar has an Events workspace separate from its existing calendar', () => {
  assert.match(admin, /data-bar-side-tab="ticket-events"[\s\S]*?Eventos/);
  assert.match(admin, /data-bar-panel="events"/);
  assert.match(admin, /data-bar-panel="ticket-events"/);
  assert.match(admin, /ticketEventsAdmin/);
  assert.match(editor, /repeat\('buffet','Buffet & bebidas'/);
  assert.match(editor, /Ingressos & lotes/);
  assert.ok(editor.indexOf('class="te-event-list"') < editor.indexOf('class="te-workspace"'), 'event list stays above the editor');
  assert.match(editor, /Publicar página pública/);
  assert.match(editor, /action:'save'/);
  assert.match(editor, /function createNew\(/);
});

test('Halloween starts as an unpublished October 29 draft with the supplied buffet and no invented ticket price', () => {
  assert.match(migration, /'halloween-ilha-2026',[\s\S]*?date '2026-10-29',[\s\S]*?'RASCUNHO'/);
  for (const term of ['Queijos variados', 'Coxinha', 'Torresmo', 'Pitaya', 'Strogonoff de filé-mignon', 'Água de coco', 'Campari']) assert.ok(migration.includes(term));
  assert.match(migration, /"tickets":\[\]/);
  assert.match(migration, /bar_ticket_events_public_read[\s\S]*?status = 'PUBLICADO'/);
  assert.match(migration, /has_bar_permission\('bar.events'\)/);
});

test('public event route uses guarded ticketing API and keeps checkout closed unless sales and provider are ready', () => {
  assert.match(publicPage, /eventos\/public\.js/);
  assert.match(publicScript, /action:'public',slug/);
  assert.match(publicScript, /u\.protocol==='https:'/);
  assert.match(publicScript, /Garantir meu ingresso/);
  assert.match(publicScript, /sales_state==='OPEN'&&data\.payment_ready/);
  assert.match(editor, /action:'sales',event_id:selected\.id,open/);
  assert.match(vercel, /"source":\s*"\/eventos\/:slug",\s*"destination":\s*"\/eventos"/);
  assert.ok(serve.includes("if (/^\\/eventos(?:\\/[^/]+)?\\/?$/.test(pathname))"));
  assert.match(build, /config\/site-files\.json/);
});

test('Halloween cutouts are contextual, decorative, lazy-loaded and scoped to this event', async () => {
  assert.match(publicScript, /const halloween=e\.slug==='halloween-ilha-2026'/);
  assert.match(publicScript, /halloween&&\['buffet','cheers','ticket','leony','rafa'\]\.includes\(pose\)/);
  for (const pose of ['buffet', 'cheers', 'ticket']) assert.ok(publicScript.includes(`mascot('${pose}')`));
  assert.match(publicScript, /class="festival-mascot mascot-\$\{pose\}" aria-hidden="true"/);
  assert.match(publicScript, /alt="" width="1024" height="1536" loading="lazy" decoding="async"/);
  assert.match(publicPage, /halloween-ilha-2026-poster-rafa\.png/);
  const css = await readFile(new URL('../eventos/public.css', import.meta.url), 'utf8');
  assert.match(css, /\.festival-mascot\s*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /@media print\s*\{\s*\.festival-mascot\s*\{\s*display:\s*none/);
});

test('all three mascot PNGs retain RGBA channels and explicit intrinsic dimensions', async () => {
  for (const pose of ['buffet', 'cheers', 'ticket']) {
    const png = await readFile(new URL(`../assets/events/halloween-mascot-${pose}.png`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.toString('ascii', 12, 16), 'IHDR');
    assert.equal(png.readUInt32BE(16), 1024);
    assert.equal(png.readUInt32BE(20), 1536);
    assert.equal(png[25], 6, `${pose} must keep its alpha channel`);
  }
});

test('Halloween copy is concise and the editable lineup does not invent performance times', async () => {
  const { patch } = JSON.parse(await readFile(new URL('../docs/events-copy-0308.json', import.meta.url), 'utf8'));
  assert.equal(patch.tagline, 'Leony Dial + DJ');
  assert.deepEqual(patch.program.map(p => p.title), ['Banda com Leony Dial', 'DJ']);
  assert.ok(patch.program.every(p => p.time === ''));
  assert.match(patch.description, /Todo o ambiente será decorado no tema de terror/);
  assert.equal(Object.hasOwn(patch, 'buffet'), false, 'preserve the menu');
  assert.equal(Object.hasOwn(patch, 'poster'), false, 'preserve approved artwork');
  for (const stale of ['UMA NOITE PARA SAIR DO ÓBVIO', 'Quem joga junto', 'TÊNIS & GASTRONOMIA', 'uma noite especial', 'todos os gostos', 'BOAS COMPANHIAS']) {
    assert.equal(publicScript.toLowerCase().includes(stale.toLowerCase()), false, stale);
    assert.equal(JSON.stringify(patch).toLowerCase().includes(stale.toLowerCase()), false, stale);
  }
  assert.match(publicScript, /program\.map/);
  assert.match(publicScript, /Horário a confirmar/);
  assert.match(publicPage, /Banda Leony Diall, Rafa Assis, DJ, buffet e ambiente decorado/);
  const css = await readFile(new URL('../eventos/public.css', import.meta.url), 'utf8');
  assert.match(publicScript, /halloween\?'quarantine-tape':''/);
  assert.match(publicScript, /ÁREA ASSOMBRADA/);
  assert.match(css, /\.quarantine-tape\s*\{[^}]*background:\s*#f4d53b/);
  assert.match(css, /repeating-linear-gradient\(130deg, #181a14 0 12px, #f4d53b 12px 24px\)/);
});
