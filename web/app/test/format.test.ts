import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wann, htmlFuerV2, istIntern, mehrzahl, chatFrage, rel, logisch } from '../src/format.ts';

const NOW = Date.parse('2026-11-03T18:00:00Z');   // 19:00 Wien

test('wann: relative Zeit in Wiener Zeit', () => {
  assert.equal(wann('2026-11-03T17:59:40Z', NOW), 'gerade eben');
  assert.equal(wann('2026-11-03T17:55:00Z', NOW), 'vor 5 Min.');
  assert.equal(wann('2026-11-03T13:05:00Z', NOW), 'heute 14:05');
  assert.equal(wann('2026-11-02T08:10:00Z', NOW), 'gestern 09:10');
  assert.equal(wann('2026-10-28T08:10:00Z', NOW), '28.10.');
  assert.equal(wann(null, NOW), '');
});

test('htmlFuerV2: Notiz-Links, Bericht-Dateien und Bilder zeigen relativ auf 2.0 bzw. api/ (S16: gehen unter jedem Präfix)', () => {
  assert.equal(htmlFuerV2('<a href="#/wissen/olaf/a%20b.md">x</a>'), '<a href="v2/dokument?vault=olaf%2Fa%20b.md">x</a>');
  assert.equal(htmlFuerV2('<a href="api/files/agenten/435-x/plan.md">p</a>'), '<a href="v2/dokument?paket=435-x&amp;datei=plan.md">p</a>');
  assert.equal(htmlFuerV2('<a href="/api/files/agenten/435-x/plan.md">p</a>'), '<a href="v2/dokument?paket=435-x&amp;datei=plan.md">p</a>');
  assert.equal(htmlFuerV2('<img src="api/files/agenten/435-x/s.png?inline=1">'), '<img src="api/files/agenten/435-x/s.png?inline=1">');
  assert.equal(htmlFuerV2('<img src="/api/files/agenten/435-x/s.png?inline=1">'), '<img src="api/files/agenten/435-x/s.png?inline=1">');
  assert.equal(htmlFuerV2('<a href="https://github.com/x">g</a>'), '<a href="https://github.com/x">g</a>');
});

test('S16: rel und logisch — Server-Adressen relativ, Präfix weg; Fremdes bleibt', () => {
  assert.equal(rel('/v2/arbeit/abcd1234'), 'v2/arbeit/abcd1234');
  assert.equal(rel('/api/files/x'), 'api/files/x');
  assert.equal(rel('/v2'), 'v2');
  assert.equal(rel('https://github.com/v2/x'), 'https://github.com/v2/x');
  assert.equal(rel('/v2x'), '/v2x');
  assert.equal(rel('//boese.example/v2'), '//boese.example/v2');
  assert.equal(logisch('/werkbank/v2/arbeit', '/werkbank'), 'v2/arbeit');
  assert.equal(logisch('/v2/arbeit', ''), 'v2/arbeit');
  assert.equal(logisch('/v2/', ''), 'v2/');
});

test('istIntern, mehrzahl, chatFrage', () => {
  assert.ok(istIntern('/v2/prs')); assert.ok(istIntern('v2/prs')); assert.ok(istIntern('v2?x=1')); assert.ok(!istIntern('v2x'));
  assert.ok(!istIntern('https://github.com/x'));
  assert.equal(mehrzahl(1, 'Frage', 'Fragen'), '1 Frage');
  assert.equal(mehrzahl(3, 'Frage', 'Fragen'), '3 Fragen');
  assert.match(chatFrage('Titel', 'Worum'), /^Was ist das.*„Titel“ — Worum$/);
});

test('S22 (B5): Tabellenzellen bekommen ihren Spaltennamen für die Handy-Ansicht', async () => {
  const { tabellenBeschriften } = await import('../src/format.ts');
  const h = '<table>\n<thead>\n<tr>\n<th>#</th>\n<th>Befund</th>\n<th style="text-align:right">Schwere</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>1</td>\n<td>Status <code>x</code></td>\n<td style="text-align:right">mittel</td>\n</tr>\n</tbody>\n</table>';
  const o = tabellenBeschriften(h);
  assert.match(o, /<td data-label="#">1<\/td>/);
  assert.match(o, /<td data-label="Befund">Status <code>x<\/code><\/td>/);
  assert.match(o, /<td style="text-align:right" data-label="Schwere">mittel<\/td>/);
  assert.equal(tabellenBeschriften('<p>keine Tabelle</p>'), '<p>keine Tabelle</p>');
});

test('Runde 4 (Knut B12): Statuszeilen der Brücke fallen aus der fertigen Antwort — Fett, Listen und Text bleiben', async () => {
  const { ohneStatuszeilen } = await import('../src/format.ts');
  const t = '*⏳ Claude arbeitet …*  \n*🔧 Read datei.ts*  \n\nHier die Antwort.\n**Wichtig:** bleibt\n* Punkt bleibt\n*a* und *b* bleiben';
  assert.equal(ohneStatuszeilen(t), 'Hier die Antwort.\n**Wichtig:** bleibt\n* Punkt bleibt\n*a* und *b* bleiben');
});

test('Pass C: echte kursive Zeilen einer Antwort bleiben — nur Statuszeilen mit Symbol am Anfang fallen weg', async () => {
  const { ohneStatuszeilen } = await import('../src/format.ts');
  assert.equal(ohneStatuszeilen('*Siehe Abschnitt 3.*\n*⏱️ Das Ergebnis steht …*\nText'), '*Siehe Abschnitt 3.*\nText');
});
