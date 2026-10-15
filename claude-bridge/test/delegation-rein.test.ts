// Delegieren und Phasen-Lead (Plan 165), reine Bausteine ohne Brücke: Abschluss-Block, Übergabe (C1), Klassen/Prüfer (C6), Phasen-Modell,
// Prüfbefehle der Brücke, Unter-Worktree. Auch Prüfbefehl in .werkbank/pruefungen.json (kein Port, keine Brücke).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAbschluss, checkUebergabe, phaseModell, klasse, pickPruefer, risikoMin, abweichungen, heikleDateien, subWorktree, gitStand, pruefen, run, KAPPUNG } from '../src/delegation.ts';
import { g, block, UEB, repo } from './delegation-hilfe.ts';
import { orchestratorBlock } from '../src/tools.ts';


test('Abschluss-Block: gültig, fehlt, kein JSON, falsche Typen, Prüfer braucht Urteil', () => {
  assert.equal(parseAbschluss(block({ dateien: ['a.ts'] }), 'bauer').ok, true);
  assert.deepEqual(parseAbschluss('nur Text', 'leser'), { ok: false, why: 'Abschluss-Block fehlt' });
  assert.match((parseAbschluss('```json\n{"abschluss": {ziel: ja}}\n```', 'leser') as any).why, /kein gültiges JSON/);
  assert.match((parseAbschluss(block({ ziel: 'ja' }), 'leser') as any).why, /ziel/);
  assert.match((parseAbschluss(block({ pruefungen: ['npm test'] }), 'leser') as any).why, /pruefungen/);
  assert.match((parseAbschluss(block({}), 'pruefer') as any).why, /urteil/);
  const p = parseAbschluss(block({ urteil: 'maengel', befunde: ['x.ts:1 — y'] }), 'pruefer');
  assert.ok(p.ok && p.a.urteil === 'maengel');
  // Der letzte Block zählt (der Worker zitiert vorher ein Beispiel).
  const zwei = block({ ziel: false }) + '\n' + block({ ziel: true });
  assert.ok((parseAbschluss(zwei, 'leser') as any).a.ziel);
});

test('Übergabe (C1): fünf Abschnitte, je ≥ 20 Zeichen oder „keine“, höchstens 8 000 Zeichen', () => {
  assert.deepEqual(checkUebergabe(UEB), { ok: true, ziel: 'Delegation bauen, Tests grün, Bericht fertig.' });
  assert.match((checkUebergabe(UEB.replace('## Prüfausgaben', '## Ausgaben')) as any).why, /fehlt: „## Prüfausgaben“/);
  assert.match((checkUebergabe(UEB.replace('claude-bridge/src/delegation.ts geschrieben, Tests laufen.', 'ok')) as any).why, /zu knapp.*„## Stand“/);
  assert.match((checkUebergabe(UEB + 'x'.repeat(KAPPUNG.uebergabe)) as any).why, /höchstens 8000/);
});

test('Phasen-Modell (Variante A) und C2-Einstufung: Opus entscheidet, Sonnet baut; Rückwirkung → Opus', () => {
  assert.deepEqual(phaseModell('plan'), { modell: 'opus', c2: false });
  assert.deepEqual(phaseModell('pass-c'), { modell: 'opus', c2: false });
  assert.deepEqual(phaseModell('bau', 'UI-Text ändern'), { modell: 'sonnet', c2: false });
  assert.deepEqual(phaseModell('bau', 'Migration der Abrechnung auf neue Tarife'), { modell: 'opus', c2: true });
  assert.deepEqual(phaseModell('push', 'Kundendaten'), { modell: 'opus', c2: false });
});

test('Prüfer (C6): anderes Modell, mindestens Autor-Klasse; keiner frei → null; Risiko nie unter dem Strang', () => {
  assert.equal(klasse('Claude opus'), 3); assert.equal(klasse('Melious glm-5.3'), 2); assert.equal(klasse('glm-5.3:eco'), 2); assert.equal(klasse('deepseek-v4.1-flash'), 1); assert.equal(klasse('haiku'), 1);
  assert.deepEqual(pickPruefer('Melious glm-5.3-flash', { melious: true, claude: true }), { anbieter: 'melious', modell: 'glm-5.3' });
  assert.deepEqual(pickPruefer('Melious glm-5.3', { melious: true, claude: true }), { anbieter: 'claude', modell: 'sonnet' });
  assert.deepEqual(pickPruefer('Claude sonnet', { melious: true, claude: true }), { anbieter: 'melious', modell: 'glm-5.3' });
  assert.equal(pickPruefer('Claude opus', { melious: true, claude: true }), null);
  // Volle Claude-Kennung aus der ersten Antwort: die Familie zählt (Sonnet prüft nie Sonnet).
  assert.equal(pickPruefer('Claude claude-sonnet-5-5', { melious: false, claude: true }), null);
  assert.deepEqual(pickPruefer('Claude claude-haiku-4-5-20251001', { melious: false, claude: true }), { anbieter: 'claude', modell: 'sonnet' });
  assert.equal(pickPruefer('Melious glm-5.3', { melious: true, claude: false }), null);
  assert.equal(risikoMin('niedrig', 'mittel'), 'mittel');
  assert.equal(risikoMin('hoch', 'mittel'), 'hoch');
  assert.equal(risikoMin('quatsch', 'niedrig'), 'niedrig');
});

test('Abschluss-Block nach einem Code-Block (Pass B, 7/8): Zäune zeilenweise, Lage des Blocks für das Herausschneiden', () => {
  const t = 'Ich habe das geändert:\n```ts\nconst x = 1;\n```\nFertig.\n```json\n{\n  "abschluss": {"ziel": true, "dateien": ["a.ts"], "pruefungen": [], "annahmen": [], "widersprueche": []}\n}\n```\n';
  const p = parseAbschluss(t, 'bauer');
  assert.ok(p.ok, JSON.stringify(p));
  assert.deepEqual(p.a.dateien, ['a.ts']);
  assert.equal(t.slice(0, p.span![0]), 'Ich habe das geändert:\n```ts\nconst x = 1;\n```\nFertig.\n');
});

test('Wächter im Strang (Pass B, 2): Referenzen umbiegen und Zweige erzwingen gesperrt, normales Arbeiten nicht', () => {
  for (const c of ['git fetch . +HEAD:refs/remotes/origin/dev', 'git fetch . HEAD:dev', 'git update-ref refs/remotes/origin/dev HEAD', 'git -C /x symbolic-ref HEAD refs/heads/dev', 'git branch -f dev HEAD', 'git branch -D dev', 'git branch --force main x'])
    assert.ok(orchestratorBlock('Bash', { command: c }), c);
  for (const c of ['git fetch origin', 'git fetch origin dev', 'git commit -m x', 'git branch', 'git branch --show-current', 'git checkout -b neu', 'git log --oneline -3'])
    assert.equal(orchestratorBlock('Bash', { command: c }), null, c);
});

test('Abweichungen und heikle Pfade', () => {
  const st = { kopf: 'k', dateien: ['a.ts', '.github/workflows/ci.yml'], stat: '', dirty: ['b.ts'], hunk: '', commits: 1 };
  const a = { ziel: false, dateien: ['a.ts', 'c.ts'], pruefungen: [{ befehl: 'npm test', ausgabe: 'ok' }], annahmen: [], widersprueche: [] };
  const ab = abweichungen(a, st, [{ name: 'tests', befehl: 'npm test', ok: false, code: 1, ausgabe: '', ms: 1 }]);
  assert.ok(ab.includes('Worker meldet: Ziel nicht erreicht'));
  assert.ok(ab.some((x) => /nicht gemeldet: \.github/.test(x)));
  assert.ok(ab.some((x) => /gemeldet, aber nicht geändert: c\.ts/.test(x)));
  assert.ok(ab.some((x) => /nicht committet: b\.ts/.test(x)));
  assert.ok(ab.some((x) => /heikle Pfade/.test(x)));
  assert.ok(ab.some((x) => /Brücken-Prüfung rot: tests.*meldete sie als ausgeführt/.test(x)));
  assert.deepEqual(heikleDateien(['web/package.json', 'src/a.ts', '.werkbank/pruefungen.json', '.claude/x']), ['web/package.json', '.werkbank/pruefungen.json', '.claude/x']);
});

test('Unter-Worktree + Prüfbefehle der Brücke (C6): aus dem Integrationszweig, ohne Shell, node_modules verlinkt und ausgeschlossen', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'deleg-wt-')));
  const dir = repo(root, 'proj');
  const w = await subWorktree(dir, 'd-abc123');
  assert.ok(!('error' in w));
  const wt = w as { dir: string; branch: string; base: string };
  assert.equal(wt.dir, join(root, 'proj.deleg', 'd-abc123'));
  assert.equal(wt.branch, 'werkbank/deleg-d-abc123');
  assert.ok(existsSync(join(wt.dir, 'pkg', 'node_modules')));
  assert.match(readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8'), /^node_modules$/m);
  // Der Worker schreibt a.txt und will die Prüfbefehle für sich umschreiben (im eigenen Zweig) — zählt nicht.
  writeFileSync(join(wt.dir, 'a.txt'), 'a\n');
  writeFileSync(join(wt.dir, '.werkbank', 'pruefungen.json'), JSON.stringify({ pruefungen: [{ name: 'alles-gruen', befehl: ['true'] }] }));
  g(wt.dir, 'add', '-A'); g(wt.dir, 'commit', '-q', '-m', 'w');
  const st = await gitStand(wt.dir, wt.base);
  assert.deepEqual(st.dateien.sort(), ['.werkbank/pruefungen.json', 'a.txt']);
  assert.deepEqual(st.dirty, []);
  assert.equal(st.commits, 1);
  const p = await pruefen(wt.dir, wt.base, process.env);
  assert.match(String(p.ref), /^dev @ [0-9a-f]{10}$/);
  assert.deepEqual(p.ergebnisse.map((r) => [r.name, r.ok]), [['diff-check', true], ['laeuft', true], ['a-da', true]]);
  assert.ok(heikleDateien(st.dateien).length > 0);
  // Ohne Integrationszweig: keine Prüfbefehle, nur diff-check.
  const ohne = repo(root, 'ohne');
  g(ohne, 'branch', '-m', 'main', 'feat'); g(ohne, 'branch', '-D', 'dev');
  const p2 = await pruefen(ohne, 'HEAD', process.env);
  assert.equal(p2.eingerichtet, false);
  assert.deepEqual(p2.ergebnisse.map((r) => r.name), ['diff-check']);
});

test('Prüfbefehl mit Zeitlimit: die ganze Prozessgruppe wird beendet (Code 124)', async () => {
  const t0 = Date.now();
  const r = await run('bash', ['-c', 'sleep 30 & sleep 30; echo nie'], { cwd: tmpdir(), timeoutMs: 400 });
  assert.equal(r.code, 124);
  assert.ok(Date.now() - t0 < 5000);
});

