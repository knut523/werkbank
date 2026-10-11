// Leitstand Teil B (docs/plan-leitstand.md): reine Logik — Bericht finden und sicher lesen (F7/G5), Lauf-Namen (F8),
// Gruppierung je Lauf mit 14-Tage-Regel (G6), Statuswörter (B-3), Gruppenzeile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'review-b-')));
const DIR = join(base, 'review-pakete');
mkdirSync(join(DIR, '132-leitstand'), { recursive: true });
process.env.WERKBANK_REVIEW_DIR = DIR;
const { findBericht, readBericht } = await import('../server/bericht.ts');
const { laufName } = await import('../server/orchestrator.ts');
const { groupStrands, statusWord, groupLine } = await import('../server/leitstand.ts');

test('Bericht finden (B3): aus Texten in Reihenfolge, nur review-pakete/NNN-slug/bericht.md, nie mit ..', () => {
  assert.equal(findBericht(['nichts', 'Bericht nach ~/work/knut/review-pakete/132-leitstand/bericht.md mit DoD']), join(DIR, '132-leitstand', 'bericht.md'));
  assert.equal(findBericht(['/home/knut/work/knut/review-pakete/07-x/bericht.md']), join(DIR, '07-x', 'bericht.md'), 'absolut → immer unter WERKBANK_REVIEW_DIR');
  assert.equal(findBericht(['review-pakete/1-zu-kurz/bericht.md', 'review-pakete/12-..x/bericht.md']), null, 'zu kurze Nummer und .. im Namen');
  assert.equal(findBericht(['../../etc/passwd', 'review-pakete/132-a/notiz.md']), null);
});

test('Bericht sicher lesen (F7/G5, B-16/B-26): Symlink, Nachbarordner, zu groß, FIFO, fehlt → null; HTML bleibt Text', () => {
  const ok = join(DIR, '132-leitstand', 'bericht.md');
  writeFileSync(ok, '# Bericht\n<script>alert(1)</script>\n');
  assert.equal(readBericht(ok), '# Bericht\n<script>alert(1)</script>\n', 'Inhalt unverändert als Text — die Seite zeigt ihn vorformatiert, nie als HTML');
  writeFileSync(join(base, 'geheim.md'), 'geheim');
  mkdirSync(join(DIR, '133-link'));
  symlinkSync(join(base, 'geheim.md'), join(DIR, '133-link', 'bericht.md'));
  assert.equal(readBericht(join(DIR, '133-link', 'bericht.md')), null, 'Symlink am Ende');
  symlinkSync(base, join(DIR, '134-dirlink'));
  assert.equal(readBericht(join(DIR, '134-dirlink', 'geheim.md')), null, 'Symlink im Verzeichnis davor');
  mkdirSync(join(base, 'review-pakete-x', '135-n'), { recursive: true });
  writeFileSync(join(base, 'review-pakete-x', '135-n', 'bericht.md'), 'nachbar');
  assert.equal(readBericht(join(base, 'review-pakete-x', '135-n', 'bericht.md')), null, 'Nachbarordner mit gleichem Präfix');
  assert.equal(readBericht(join(DIR, '132-leitstand', '..', '..', 'geheim.md')), null, '..');
  mkdirSync(join(DIR, '136-gross'));
  writeFileSync(join(DIR, '136-gross', 'bericht.md'), 'x'.repeat(201 * 1024));
  assert.equal(readBericht(join(DIR, '136-gross', 'bericht.md')), null, '> 200 KB');
  mkdirSync(join(DIR, '137-fifo'));
  execFileSync('mkfifo', [join(DIR, '137-fifo', 'bericht.md')]);
  const t0 = Date.now();
  assert.equal(readBericht(join(DIR, '137-fifo', 'bericht.md')), null, 'FIFO');
  assert.ok(Date.now() - t0 < 1000, 'FIFO blockiert nicht');
  assert.equal(readBericht(join(DIR, '138-fehlt', 'bericht.md')), null);
  assert.equal(readBericht(join(DIR, '132-leitstand', 'bericht.txt')), null, 'nur .md');
});

test('Lauf-Name (F8): ausdrücklich gesäubert, sonst Titelteil vor „:“/„ · “', () => {
  assert.deepEqual(laufName('Flex: Speicher-Pilot'), { lauf: 'Flex', explicit: false });
  assert.deepEqual(laufName('Werkbank · Leitstand'), { lauf: 'Werkbank', explicit: false });
  assert.deepEqual(laufName('Ohne Trenner'), { lauf: 'Ohne Trenner', explicit: false });
  assert.deepEqual(laufName('x', ' Flex/Pilot·2\u0007 '), { lauf: 'Flex Pilot 2', explicit: true });
  assert.equal(laufName('x', 'a'.repeat(80)).lauf.length, 40);
  assert.deepEqual(laufName(': nur Rest', '   '), { lauf: ': nur Rest', explicit: false }, 'leerer Titelteil → ganzer Titel');
});

const D = 86400_000, T0 = 1_760_000_000_000;
const s = (o: any) => ({ _id: o.id, title: o.title ?? 'Flex: x', lauf: o.lauf, startedAt: new Date(T0 + (o.day ?? 0) * D), lastStatus: o.st ?? 'waiting', ...o });

test('Statuswort (B-3): running→läuft, waiting→wartet, done/review_ready→fertig, failed/Deckel→gestoppt', () => {
  assert.equal(statusWord({ lastStatus: 'running' }), 'läuft');
  assert.equal(statusWord({ lastStatus: 'waiting' }), 'wartet');
  assert.equal(statusWord({ lastStatus: 'done' }), 'fertig');
  assert.equal(statusWord({ lastStatus: 'waiting', reviewReadyAt: new Date() }), 'fertig');
  assert.equal(statusWord({ status: 'blocked_g0', conv: null }), 'gestoppt', 'Release 3: von G0 gestoppter Strang (ohne Chat) ist gestoppt, nicht „wartet“');
  assert.equal(statusWord({ lastStatus: 'failed' }), 'gestoppt');
  assert.equal(statusWord({ lastStatus: 'running', autoStopped: { at: new Date() } }), 'gestoppt');
  assert.equal(statusWord({ lastStatus: 'running', doneAt: new Date() }), 'läuft', 'läuft wieder nach „fertig“');
});

test('Gruppierung (G6, B-4, B-27): gleicher Name = eine Gruppe, neue nach > 14 Tagen Pause; wartet vor läuft vor fertig; ganz geprüft → Erledigt', () => {
  const g = groupStrands([
    s({ id: 'a', lauf: 'Flex', day: 0, st: 'done', doneAt: new Date() }),
    s({ id: 'b', lauf: 'Flex', day: 10, st: 'waiting' }),
    s({ id: 'c', lauf: 'Flex', day: 30, st: 'running' }),       // > 14 Tage nach b → neue Gruppe
    s({ id: 'd', lauf: 'Bot', day: 31, st: 'done', doneAt: new Date() }),
    s({ id: 'e', lauf: 'Alt', day: 29, knutReviewedAt: new Date() }),
  ], T0 + 32 * D);
  assert.deepEqual(g.offen.map((x) => `${x.lauf}:${x.strands.length}`), ['Flex:2', 'Flex:1', 'Bot:1'], 'wartet zuerst, dann läuft, dann fertig');
  assert.equal(groupLine(g.offen[0]), '2 Stränge · 1 wartet · 1 fertig');
  assert.equal(groupLine(g.offen[2]), '1 Strang · 1 fertig');
  assert.deepEqual(g.erledigt.map((x) => x.lauf), ['Alt']);
  assert.deepEqual(groupStrands([s({ id: 'z', lauf: 'Uralt', day: 0, knutReviewedAt: new Date() })], T0 + 40 * D).erledigt, [], 'Erledigt nur 14 Tage');
});
