import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wann, htmlFuerV2, istIntern, mehrzahl, chatFrage } from '../src/format.ts';

const NOW = Date.parse('2026-11-03T18:00:00Z');   // 19:00 Wien

test('wann: relative Zeit in Wiener Zeit', () => {
  assert.equal(wann('2026-11-03T17:59:40Z', NOW), 'gerade eben');
  assert.equal(wann('2026-11-03T17:55:00Z', NOW), 'vor 5 Min.');
  assert.equal(wann('2026-11-03T13:05:00Z', NOW), 'heute 14:05');
  assert.equal(wann('2026-11-02T08:10:00Z', NOW), 'gestern 09:10');
  assert.equal(wann('2026-10-28T08:10:00Z', NOW), '28.10.');
  assert.equal(wann(null, NOW), '');
});

test('htmlFuerV2: Notiz-Links, Bericht-Dateien und Bilder zeigen auf 2.0 bzw. /api', () => {
  assert.equal(htmlFuerV2('<a href="#/wissen/olaf/a%20b.md">x</a>'), '<a href="/v2/dokument?vault=olaf%2Fa%20b.md">x</a>');
  assert.equal(htmlFuerV2('<a href="api/files/agenten/435-x/plan.md">p</a>'), '<a href="/v2/dokument?paket=435-x&amp;datei=plan.md">p</a>');
  assert.equal(htmlFuerV2('<img src="api/files/agenten/435-x/s.png?inline=1">'), '<img src="/api/files/agenten/435-x/s.png?inline=1">');
  assert.equal(htmlFuerV2('<a href="https://github.com/x">g</a>'), '<a href="https://github.com/x">g</a>');
});

test('istIntern, mehrzahl, chatFrage', () => {
  assert.ok(istIntern('/v2/prs'));
  assert.ok(!istIntern('https://github.com/x'));
  assert.equal(mehrzahl(1, 'Frage', 'Fragen'), '1 Frage');
  assert.equal(mehrzahl(3, 'Frage', 'Fragen'), '3 Fragen');
  assert.match(chatFrage('Titel', 'Worum'), /^Was ist das.*„Titel“ — Worum$/);
});
