import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../adm/index.html', import.meta.url), 'utf8');
const functions = new Map([...source.matchAll(/^    function (\w+)\([^\n]*\) \{[\s\S]*?^    \}/gm)].map(match => [match[1], match[0]]));
const names = ['getDrawLayout', 'placeColumnMatches', 'instagramLayoutProfile', 'instagramColumnPositions', 'instagramRowToY', 'drawFinalConnectors'];
const context = vm.createContext({ roundLabels: { FINAL: 'Final', SEMIFINAL: 'Semifinal', QUARTAS: 'Quartas' }, DRAW_TITLE_SPACE: 32, DRAW_ROW_STEP: 80, DRAW_MATCH_HEIGHT: 70 });
vm.runInContext(names.map(name => functions.get(name)).join('\n'), context);

function makeMatches(size, firstRound = 1) {
  const matches = [];
  for (let count = size / 2, round = firstRound; count >= 1; count /= 2, round++) {
    for (let index = 0; index < count; index++) matches.push({ jogo_id: `${round}-${index}`, rodada: round, fase: count === 1 ? 'FINAL' : count === 2 ? 'SEMIFINAL' : 'QUARTAS', posicao_chave: index + 1 });
  }
  return matches;
}

function geometry(matches, hasBackground = true) {
  const layout = context.getDrawLayout(matches);
  const profile = context.instagramLayoutProfile(layout, hasBackground);
  const positions = context.instagramColumnPositions(layout, profile);
  const rowToY = (row, side, index) => context.instagramRowToY(profile, row, side, index, profile.areaTop, profile.areaBottom, profile.cardHeight, layout);
  const cards = ['left', 'right'].flatMap(side => layout[side].flatMap((column, index) => column.matches.map(item => ({ id: item.match.jogo_id, x: positions[side][index].x, y: rowToY(item.row, side, index), w: positions[side][index].w, h: profile.cardHeight }))));
  const finalX = profile.finalX ?? (1080 - profile.finalW) / 2;
  cards.push({ id: layout.final.jogo_id, x: finalX, y: profile.finalY, w: profile.finalW, h: profile.finalH });
  return { layout, profile, positions, rowToY, cards, finalX };
}

for (const firstRound of [1, 2, 3]) {
  test(`four-player semifinal artwork does not overlap (first round ${firstRound})`, () => {
    const matches = makeMatches(4, firstRound);
    const before = JSON.stringify(matches);
    const { cards, profile } = geometry(matches);
    assert.equal(profile.kind, 'draw4');
    assert.equal(cards.length, 3);
    for (let i = 0; i < cards.length; i++) {
      const a = cards[i];
      assert.ok(a.x >= 24 && a.x + a.w <= 1056 && a.y >= 520 && a.y + a.h <= 1180);
      for (const b of cards.slice(i + 1)) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `overlap: ${a.id}, ${b.id}`);
    }
    const [left, right, final] = cards;
    assert.equal(left.y, right.y);
    assert.ok(right.x - (left.x + left.w) >= 40);
    assert.ok(final.y - (left.y + left.h) >= 100);
    assert.equal(final.x + final.w / 2, 540);
    assert.equal(JSON.stringify(matches), before, 'rendering must not change matches');
  });
}

test('the two semifinals have branches joining the centered final', () => {
  const { layout, profile, positions, rowToY, cards, finalX } = geometry(makeMatches(4));
  const paths = [];
  const ctx = { save() {}, restore() {}, beginPath() { paths.push([]); }, moveTo(x, y) { paths.at(-1).push([x, y]); }, lineTo(x, y) { paths.at(-1).push([x, y]); }, stroke() {} };
  context.drawFinalConnectors(ctx, layout, positions, finalX, profile.finalY, profile.finalW, profile.finalH, rowToY, profile.cardHeight, {});
  for (const card of cards.slice(0, 2)) assert.ok(paths.some(path => path[0][0] === card.x + card.w / 2 && path[0][1] === card.y + card.h), 'a semifinal is missing its connection');
  assert.ok(paths.some(path => path.at(-1)[0] === 540 && path.at(-1)[1] === profile.finalY - 14));
});

test('a final-only artwork is centered without phantom semifinal columns', () => {
  const { cards, layout } = geometry(makeMatches(2));
  assert.equal(cards.length, 1);
  assert.equal(layout.left.length + layout.right.length, 0);
  assert.equal(cards[0].x + cards[0].w / 2, 540);
});

test('eight- and sixteen-player background layouts keep their established profiles', () => {
  assert.equal(geometry(makeMatches(8)).profile.kind, 'draw8');
  assert.equal(geometry(makeMatches(16)).profile.kind, 'draw16');
  assert.equal(geometry(makeMatches(8)).profile.finalY, 1080);
  assert.equal(geometry(makeMatches(16)).profile.finalY, 816);
});

test('the non-background renderer stays supported', () => {
  const { cards } = geometry(makeMatches(4), false);
  assert.equal(cards.length, 3);
  assert.ok(cards[0].x + cards[0].w < cards[1].x);
});
