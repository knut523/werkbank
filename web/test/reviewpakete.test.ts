// Agenten-Ergebnisse: Review-Pakete lesen (docs/plan-dateien-vollstaendig.md, S3) — Titel, Dateifilter, Deckel,
// Pfadprüfung, Strang-Zuordnung. Nur ein Fixture-Ordner, nie die echten Pakete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listPakete, readPaket, paketFile, strandFor, clearPaketCache } from '../server/reviewpakete.ts';
import { parseSchemaName } from '../server/ablage.ts';

const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'wb-pakete-')));
const put = (rel: string, s = 'x') => { mkdirSync(join(ROOT, rel, '..'), { recursive: true }); writeFileSync(join(ROOT, rel), s); };
put('134-dateien-vollstaendig/bericht.md', '---\nx: 1\n---\n\n# 134 — Dateien vollständig\n\nText');
put('134-dateien-vollstaendig/plan.md', '# Plan');
put('134-dateien-vollstaendig/screens/01-desktop.png', 'PNG');
put('134-dateien-vollstaendig/screens/probe.sh', 'rm -rf /');
put('134-dateien-vollstaendig/.geheim.md', 'nein');
put('134-dateien-vollstaendig/repo/node_modules/x/readme.md', 'nein');
put('134-dateien-vollstaendig/a/b/c/zu-tief.md', 'nein');
put('9-ohne-bericht/notiz.md', 'kein Titel hier');
put('61-gross/README.md', '# Großes Paket');
for (let i = 0; i < 80; i++) put(`61-gross/shots/s${String(i).padStart(2, '0')}.png`);
put('kein-paket/bericht.md', '# nein');
put('00-dienste-bericht.md', '# Datei, kein Ordner');
mkdirSync(join(ROOT, 'draussen'));
writeFileSync(join(ROOT, 'draussen', 'geheim.md'), 'geheim');
symlinkSync(join(ROOT, 'draussen'), join(ROOT, '134-dateien-vollstaendig', 'link'));
symlinkSync(join(ROOT, 'draussen', 'geheim.md'), join(ROOT, '134-dateien-vollstaendig', 'link.md'));

test('Pakete: nur NNN-slug-Ordner, neueste Nummer zuerst, Titel aus bericht.md', () => {
  clearPaketCache();
  const l = listPakete(ROOT);
  assert.deepEqual(l.map((p) => p.name), ['134-dateien-vollstaendig', '61-gross', '9-ohne-bericht']);
  assert.equal(l[0].title, '134 — Dateien vollständig');
  assert.equal(l[1].title, 'Großes Paket', 'ohne bericht.md: erste Markdown-Datei');
  assert.equal(l[2].title, 'ohne bericht', 'ohne Überschrift: Ordnername');
});

test('Dateien: nur Ergebnisse bis Tiefe 3, ohne Versteckte/node_modules/Symlinks/Skripte, bericht.md zuerst', () => {
  const p = readPaket(ROOT, '134-dateien-vollstaendig')!;
  assert.deepEqual(p.files.map((f) => f.rel), ['bericht.md', 'plan.md', 'screens/01-desktop.png']);
  const g = readPaket(ROOT, '61-gross')!;
  assert.equal(g.files.length, 60);
  assert.equal(g.more, 21, 'Deckel mit Zähler');
});

test('Pfadprüfung: nur gelistete Dateien, kein Ausbruch', () => {
  assert.ok(paketFile(ROOT, '134-dateien-vollstaendig', 'screens/01-desktop.png'));
  for (const [n, r] of [
    ['134-dateien-vollstaendig', '../9-ohne-bericht/notiz.md'], ['134-dateien-vollstaendig', '/etc/passwd'],
    ['134-dateien-vollstaendig', 'screens/probe.sh'], ['134-dateien-vollstaendig', '.geheim.md'],
    ['134-dateien-vollstaendig', 'link/geheim.md'], ['134-dateien-vollstaendig', 'link.md'],
    ['134-dateien-vollstaendig', 'repo/node_modules/x/readme.md'], ['134-dateien-vollstaendig', 'a/b/c/zu-tief.md'],
    ['..', 'draussen/geheim.md'], ['kein-paket', 'bericht.md'], ['134-dateien-vollstaendig', 'fehlt.md'],
  ]) assert.equal(paketFile(ROOT, n, r), null, `${n}/${r}`);
});

test('Strang: Paketname in Auftrag/Artefakten oder „Paket NNN“ im Titel; der neueste gewinnt', () => {
  const runs = [
    { _id: 'o1', title: 'Alt', url: 'u1', prompt: 'Bericht nach ~/work/knut/review-pakete/134-dateien-vollstaendig/bericht.md', startedAt: new Date('2026-10-01') },
    { _id: 'o2', title: 'Neu', url: 'u2', prompt: 'x', review: { artefakte: ['review-pakete/134-dateien-vollstaendig/bericht.md'] }, startedAt: new Date('2026-10-11') },
    { _id: 'o3', title: 'Merge Paket 61: groß', url: 'u3', startedAt: new Date('2026-10-02') },
    { _id: 'o4', title: 'nennt 1340-dateien-vollstaendig-x', prompt: '134-dateien-vollstaendig-zwei', startedAt: new Date('2026-10-12') },
  ];
  assert.equal(strandFor({ name: '134-dateien-vollstaendig', nr: 134 }, runs)?.id, 'o2');
  assert.equal(strandFor({ name: '61-gross', nr: 61 }, runs)?.id, 'o3');
  assert.equal(strandFor({ name: '9-ohne-bericht', nr: 9 }, runs), null);
});

test('Schema-Name zerlegen', () => {
  assert.deepEqual(parseSchemaName('2026-10-06_deck_plattform-stand-und-ausblick_v5.pptx'), { datum: '2026-10-06', art: 'deck', slug: 'plattform-stand-und-ausblick', version: 'v5' });
  assert.deepEqual(parseSchemaName('undatiert_notiz_x_2.md'), { datum: null, art: 'notiz', slug: 'x', version: '' });
  assert.deepEqual(parseSchemaName('2026-10-08_deck_nax-slide-repo-q3-2023_undatiert.pdf'), { datum: '2026-10-08', art: 'deck', slug: 'nax-slide-repo-q3-2023_undatiert', version: '' });
  assert.deepEqual(parseSchemaName('upload_server.py'), { datum: null, art: null, slug: 'upload_server', version: '' });
  assert.deepEqual(parseSchemaName('2026-10-01_quatsch_x.pdf'), { datum: null, art: null, slug: '2026-10-01_quatsch_x', version: '' });
});
