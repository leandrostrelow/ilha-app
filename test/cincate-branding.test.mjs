import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const admin = fs.readFileSync(new URL('../adm/index.html', import.meta.url), 'utf8');
const paletteSource = admin.slice(admin.indexOf('    function tournamentArtPalette('), admin.indexOf('    function renderTournamentArtBackgroundPreview('));
const state = {data:{torneio:{slug:'cincate-2026',settings:{}}}};
const context = vm.createContext({state});
vm.runInContext(paletteSource, context);

test('CINCATE export colors match the emblem without affecting other tournaments', () => {
  const defaults = {dark:'#00a82c',white:'#ffffff',text:'#0a3518'};
  const colors = context.tournamentArtPalette(defaults);
  assert.equal(colors.dark, '#0c2b40');
  assert.equal(colors.lime, '#abc42a');
  assert.equal(colors.white, '#ffffff');
  assert.equal(colors.text, '#0c2b40');
  assert.equal(defaults.dark, '#00a82c');
  state.data.torneio.slug='other-event';
  assert.equal(context.tournamentArtPalette(defaults), defaults);
  state.data.torneio.settings.sport='PICKLEBALL';
  assert.equal(context.tournamentArtPalette(defaults).dark, '#087e8d');
});

test('CINCATE stories and separate sponsor logos fit the PNG upload constraints', () => {
  for (const name of ['cincate-2026-art-stories','cincate-2026-art-stories-blue','cincate-2026-art-stories-clubs','cincate-2026-art-stories-navy','cincate-2026-art-poster-scene','cincate-sponsor-asscontal','cincate-sponsor-grafica-gomieri','cincate-sponsor-rio-doce']) {
    const png=fs.readFileSync(new URL('../assets/branding/'+name+'.png',import.meta.url));
    assert.equal(png.subarray(1,4).toString(),'PNG');
    assert.ok(png.length < 2*1024*1024);
    const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
    if(name.startsWith('cincate-2026-art-')) assert.ok(Math.abs(width/height - 9/16)<0.002);
    else assert.equal(width,height);
  }
});

test('CINCATE horizontal logo is an RGBA PNG and uses responsive contained sizing', () => {
  const png = fs.readFileSync(new URL('../assets/branding/cincate-2026-logo-transparente.png', import.meta.url));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png[25], 6, 'PNG keeps its alpha channel');
  assert.ok(png.readUInt32BE(16) / png.readUInt32BE(20) > 2.5);
  const page = fs.readFileSync(new URL('../torneios/index.html', import.meta.url), 'utf8');
  assert.match(page, /body\.cincate-theme \.tournament-logo\s*\{\s*width: min\(600px, 100%\);\s*height: auto;/);
  assert.match(page, /body\.cincate-theme \.event-hero \.tournament-logo\s*\{\s*width: min\(360px, 100%\);/);
});
