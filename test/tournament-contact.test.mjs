import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../torneios/index.html', import.meta.url), 'utf8');
function section(start, end) {
  const index = source.indexOf('    function ' + start);
  assert.ok(index >= 0);
  const last = source.indexOf('    function ' + end, index);
  assert.ok(last > index);
  return source.slice(index, last);
}
function fixture(slug = 'cincate-2026') {
  const nodes = { registrationPrivacyNotice: {}, registrationPrivacyLink: {} };
  const context = vm.createContext({
    state: { slug },
    tournament: () => ({ slug, name: slug === 'cincate-2026' ? 'CINCATE 2026' : 'Ilha Open 2026' }),
    field: (row, ...keys) => keys.map(key => row[key]).find(Boolean) || '',
    clean: value => String(value || '').trim(),
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;'),
    safeHref: value => value,
    tournamentSettings: () => ({}),
    aboutEventSettings: () => ({}),
    allSponsors: () => [],
    publicRegistrationCtaHtml: () => '',
    privacyPolicyUrl: () => '',
    $: id => nodes[id],
  });
  for (const [start, end] of [
    ['tournamentContact', 'tournamentIntroSettings'],
    ['sponsorsHtml', 'installAppHtml'],
    ['aboutHtml', 'infoRow'],
    ['configureRegistrationPrivacy', 'configuredSponsors'],
  ]) vm.runInContext(section(start, end), context);
  return { context, nodes };
}

test('CINCATE contact, sponsorship and privacy fallback all use the supplied WhatsApp', () => {
  const { context, nodes } = fixture();
  const contact = context.tournamentContact();
  assert.equal(contact.phone, '5527996133327');
  assert.equal(contact.label, '(27) 99613-3327');
  const about = context.aboutHtml();
  assert.match(about, /\(27\) 99613-3327/);
  assert.doesNotMatch(about, /99980.?5814/);
  const urls = Array.from(about.matchAll(/href="(https:\/\/wa\.me\/[^" ]+)"/g), match => new URL(match[1]));
  assert.equal(urls.length, 2, 'about contact and sponsorship links');
  for (const url of urls) assert.equal(url.pathname, '/5527996133327');
  const sponsor = new URL(context.tournamentSponsorUrl());
  assert.equal(sponsor.pathname, '/5527996133327');
  assert.match(sponsor.searchParams.get('text'), /patrocínio do torneio CINCATE 2026/);
  context.configureRegistrationPrivacy();
  assert.equal(new URL(nodes.registrationPrivacyLink.href).pathname, '/5527996133327');
  assert.equal(nodes.registrationPrivacyNotice.hidden, false);
});

test('header sponsorship shares the same URL and no longer hardcodes Ilha Open', () => {
  assert.match(source, /id="headSponsorLink"/);
  const render = section('renderTournament', 'renderRegistrationOnly');
  assert.match(render, /\$\('headSponsorLink'\)\.href = tournamentSponsorUrl\(\)/);
  assert.ok(render.indexOf("$('headSponsorLink').href") < render.indexOf("$('tournamentHeadActions').hidden = false"));
  assert.equal((source.match(/5527999805814/g) || []).length, 1, 'old number only remains as other tournaments default');
});

test('other tournaments keep their contact and configured privacy URLs are preserved', () => {
  const { context, nodes } = fixture('ilha-open-2026');
  assert.equal(context.tournamentContact().phone, '5527999805814');
  assert.equal(new URL(context.tournamentSponsorUrl()).pathname, '/5527999805814');
  assert.match(new URL(context.tournamentSponsorUrl()).searchParams.get('text'), /Ilha Open 2026/);
  context.privacyPolicyUrl = () => 'https://example.org/privacy';
  context.configureRegistrationPrivacy();
  assert.equal(nodes.registrationPrivacyLink.href, 'https://example.org/privacy');
});
