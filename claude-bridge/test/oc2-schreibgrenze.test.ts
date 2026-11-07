// Schreibgrenze der opencode-2-Stränge am ECHTEN opencode 2.2.5 (Auftrag 07.11., Punkt 2: „zuerst beweisen, dass die Regel greift“).
// Ein Schein-Modell (test/oc2-mockmodell.ts) ruft der Reihe nach Werkzeuge auf — Fluchtversuche und erlaubte Schreibzugriffe; geprüft
// wird, was wirklich auf der Platte landet, mit den Rechten (oc2Schreibrechte), der Server-Umgebung (oc2Umgebung: Wächter im PATH,
// keine Projekt-Konfiguration) und der Nachkontrolle (oc2SchreibtDraussen) aus der Brücke. Ohne installiertes opencode 2: übersprungen.
// Kein Melious, keine Energie.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockModell, oc2MitMock, oc2Da, type MockModell, type Schritt } from './oc2-mockmodell.ts';
import { opencode2Laeufer, oc2Schreibrechte, oc2SchreibtDraussen } from '../src/laeufer.ts';
import { schreibzielProblem } from '../src/jcode-pre-tool.ts';
import { linksNachDraussen } from '../src/oc2strang.ts';

const da = oc2Da();
const PW = 'pw-schreibgrenze';
let m: MockModell, srv: Awaited<ReturnType<typeof oc2MitMock>>;
const tmp = mkdtempSync(join(tmpdir(), 'oc2-grenze-'));
const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'oc2-cwd-')));
const draussen = realpathSync(mkdtempSync(join(tmpdir(), 'oc2-draussen-')));
const nachbar = join(draussen, 'nachbar-wt');

before(async () => {
  if (!da) return;
  const g = (...a: string[]) => execFileSync('git', a, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }, stdio: 'ignore' });
  writeFileSync(join(cwd, 'a.txt'), 'hallo\n');
  g('init', '-q'); g('add', 'a.txt'); g('commit', '-q', '-m', 'start');
  g('worktree', 'add', '-q', nachbar);   // ein anderer Strang desselben Repos
  writeFileSync(join(draussen, 'vorhanden.txt'), 'draussen\n');
  symlinkSync(draussen, join(cwd, 'link'));
  mkdirSync(join(cwd, 'sub'));
  writeFileSync(join(cwd, 'sub', 'innen.txt'), 'x\n');
  symlinkSync(join(cwd, 'sub'), join(cwd, 'link-innen'));   // zeigt in den Ordner — bleibt erlaubt
  writeFileSync(join(cwd, '.env'), 'GEHEIM=1\n');
  // Eine Projekt-Konfiguration, die alles erlauben will — darf nicht gelten (OPENCODE_DISABLE_PROJECT_CONFIG).
  writeFileSync(join(cwd, 'opencode.jsonc'), JSON.stringify({ permissions: [{ action: '*', resource: '*', effect: 'allow' }] }));
  m = await mockModell();
  srv = await oc2MitMock({ tmp, mockPort: m.port, passwort: PW });
});
after(async () => { srv?.stop(); await m?.stop(); });

const lauf = (schritte: Schritt[], sitzung?: string) => {
  m.schritte.splice(0, m.schritte.length, ...schritte);
  m.neu();
  return opencode2Laeufer({ base: srv.base, passwort: PW, taktMs: 100 }).zug({
    cwd, prompt: 'los', model: 'glm-5.3', timeoutS: 60, abbruch: () => false, titel: 'grenze', sitzung,
    rechte: oc2Schreibrechte(linksNachDraussen(cwd)), pruefe: (n) => oc2SchreibtDraussen(n, (p) => !!schreibzielProblem(p, cwd)),
  });
};
const werkzeuge = async (sid: string) => {
  const auth = `Basic ${Buffer.from(`opencode:${PW}`).toString('base64')}`;
  const r = await (await fetch(`${srv.base}/api/session/${sid}/message?limit=200`, { headers: { authorization: auth } })).json() as any;
  const out: Record<string, { status: string; fehler: string; text: string }> = {};
  for (const msg of r.data) for (const c of msg.content ?? []) if (c.type === 'tool') out[c.id] = { status: c.state.status, fehler: String(c.state.error?.message ?? ''), text: JSON.stringify(c.state.content ?? '') };
  return out;
};

test('Symlinks nach draußen werden gefunden (nur die, nicht die nach innen)', { skip: !da && 'opencode 2 nicht installiert' }, () => {
  assert.deepEqual(linksNachDraussen(cwd), ['link']);
});

test('opencode 2.2.5: Schreiben außerhalb des Arbeitsordners scheitert auf jedem Weg, innen geht es', { skip: !da && 'opencode 2 nicht installiert' }, async () => {
  const r = await lauf([
    { tool: 'write', args: { path: join(draussen, 'abs.txt'), content: 'x' } },              // call_1 absolut draußen
    { tool: 'write', args: { path: '../flucht.txt', content: 'x' } },                        // call_2 ../
    { tool: 'write', args: { path: 'link/sym.txt', content: 'x' } },                         // call_3 Symlink nach draußen
    { tool: 'edit', args: { path: 'link/vorhanden.txt', oldString: 'draussen', newString: 'weg' } },   // call_4 vorhandene Datei über den Symlink
    { tool: 'write', args: { path: '.git/config', content: 'x' } },                          // call_5 Git-Verwaltung
    { tool: 'write', args: { path: 'node_modules/p/index.js', content: 'x' } },              // call_6
    { tool: 'write', args: { path: 'opencode.jsonc', content: '{}' } },                       // call_7 eigene Konfiguration
    { tool: 'read', args: { path: '.env' } },                                                // call_8 Zugangsdatei oben
    { tool: 'opencode_worktree_remove', args: { directory: nachbar, force: true } },         // call_9 fremder Worktree
    { tool: 'execute', args: { code: 'return 1' } },                                         // call_10 Code Mode
    { tool: 'subagent', args: { agent: 'general', description: 'x', prompt: 'x' } },         // call_11
    { tool: 'webfetch', args: { url: 'http://127.0.0.1:1/' } },                              // call_12
    { tool: 'write', args: { path: 'innen.txt', content: 'innen\n' } },                      // call_13 erlaubt
    { tool: 'edit', args: { path: 'link-innen/innen.txt', oldString: 'x', newString: 'y' } }, // call_14 Symlink nach innen: erlaubt
    { tool: 'opencode_worktree_remove', args: { directory: cwd, force: true } },            // call_15 den eigenen Ordner
    { text: 'FERTIG Zug 1' },
  ]);
  assert.equal(r.code, 0, r.grund); assert.equal(r.text, 'FERTIG Zug 1'); assert.ok(r.sitzung);
  const w = await werkzeuge(r.sitzung!);
  for (const id of ['call_1', 'call_2', 'call_3', 'call_4', 'call_5', 'call_6', 'call_7', 'call_8']) assert.equal(w[id]?.status, 'error', `${id}: ${JSON.stringify(w[id])}`);
  for (const id of ['call_10', 'call_11', 'call_12']) assert.match(w[id]?.fehler ?? '', /No tool named|denied/i, id);
  assert.equal(w.call_15?.status, 'error', JSON.stringify(w.call_15)); assert.match(w.call_15?.fehler ?? '', /denied/i, JSON.stringify(w.call_15)); assert.ok(existsSync(join(cwd, 'a.txt')));
  assert.equal(w.call_13?.status, 'completed'); assert.equal(w.call_14?.status, 'completed');
  // Auf der Platte: draußen nichts, a.txt unverändert, innen geschrieben
  assert.deepEqual(execFileSync('ls', ['-A', draussen]).toString().trim().split('\n').filter((x) => x !== 'nachbar-wt'), ['vorhanden.txt']);
  assert.equal(readFileSync(join(draussen, 'vorhanden.txt'), 'utf8'), 'draussen\n');
  assert.ok(!existsSync(join(cwd, '..', 'flucht.txt')));
  assert.equal(readFileSync(join(cwd, 'a.txt'), 'utf8'), 'hallo\n');
  assert.equal(readFileSync(join(cwd, 'innen.txt'), 'utf8'), 'innen\n');
  assert.equal(readFileSync(join(cwd, 'sub', 'innen.txt'), 'utf8'), 'y\n');
  assert.ok(!existsSync(join(cwd, 'node_modules')));
  // Der fremde Worktree steht noch; ein ausgeführter worktree_remove würde von der Nachkontrolle gemeldet
  if (process.env.OC2_BELEG) console.log('BELEG', JSON.stringify({ eigener: w.call_15, worktree_remove: w.call_9, execute: w.call_10, zugang: w.call_8, link: w.call_3 }));
  assert.ok(existsSync(join(nachbar, 'a.txt')), `Nachbar-Worktree weg: ${JSON.stringify(w.call_9)}`);
  assert.equal(w.call_9?.status, 'error'); assert.match(w.call_9?.fehler ?? '', /denied/i, 'worktree_remove an der Rechte-Prüfung gescheitert, nicht erst am Projekt');
  assert.deepEqual(r.draussen, []);
});

test('opencode 2.2.5: Shell nur über den Wächter — lesen ja, schreiben und Umgebung nein', { skip: !da && 'opencode 2 nicht installiert' }, async () => {
  const r = await lauf([
    { tool: 'shell', args: { command: 'cat a.txt' } },                          // call_1
    { tool: 'shell', args: { command: 'echo x > shell.txt' } },                 // call_2 Umleitung
    { tool: 'shell', args: { command: 'touch shell2.txt' } },                   // call_3
    { tool: 'shell', args: { command: 'env' } },                                // call_4
    { tool: 'shell', args: { command: 'cat /proc/self/environ' } },             // call_5
    { tool: 'shell', args: { command: 'touch ../draussen.txt', workdir: draussen } },   // call_6
    { text: 'FERTIG Shell' },
  ]);
  assert.equal(r.code, 0, r.grund);
  const w = await werkzeuge(r.sitzung!);
  assert.match(w.call_1.text, /hallo/);
  for (const id of ['call_2', 'call_3', 'call_4', 'call_5', 'call_6']) assert.match(`${w[id]?.text} ${w[id]?.fehler}`, /Werkbank-Wächter|denied|external/i, `${id}: ${JSON.stringify(w[id])}`);
  assert.ok(!existsSync(join(cwd, 'shell.txt')) && !existsSync(join(cwd, 'shell2.txt')));
  assert.ok(!/sk-mock|pw-schreibgrenze/.test(JSON.stringify(w)), 'weder Schlüssel noch Server-Passwort in einer Ausgabe');
});

test('opencode 2.2.5: eine Sitzung über zwei Züge — der zweite sieht den ersten, Antwort und Nutzung nur des Zugs', { skip: !da && 'opencode 2 nicht installiert' }, async () => {
  const z1 = await lauf([{ tool: 'write', args: { path: 'zug1.txt', content: '1' } }, { text: 'Antwort Zug 1' }]);
  assert.equal(z1.code, 0, z1.grund);
  const anfragen = m.anfragen.length;
  const z2 = await lauf([{ text: 'Antwort Zug 2' }], z1.sitzung);
  assert.equal(z2.code, 0, z2.grund); assert.equal(z2.sitzung, z1.sitzung); assert.equal(z2.text, 'Antwort Zug 2');
  // Der Kontext bleibt: das Modell bekommt im zweiten Zug die Nachrichten des ersten mit
  assert.match(JSON.stringify(m.anfragen.slice(anfragen).map((a) => a.nachrichten)), /zug1\.txt/);
  // Nutzung: nur dieser Zug (eine Modellanfrage à 100 + 10 Tokens im Schein-Modell)
  assert.equal(z2.usage.input, m.anfragen.length - anfragen === 1 ? 100 : z2.usage.input);
  assert.ok(z2.usage.input < z1.usage.input + z2.usage.input && z2.usage.input <= 100 * (m.anfragen.length - anfragen));
});
