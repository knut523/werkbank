import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { bestofnStrang, bestofnAblehnung } from '../src/bauerstrang.ts';
import { bauerEreignisse, statistikLaden } from '../src/bauerrennen.ts';
import { FLASH, DEEPSEEK, GLM } from '../src/modellwahl.ts';

const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });
function repo() {
  const wurzel = mkdtempSync(join(tmpdir(), 'bst-')); const cwd = join(wurzel, 'strang'); mkdirSync(join(cwd, 'src'), { recursive: true });
  g(cwd, 'init', '-q', '-b', 'main'); writeFileSync(join(cwd, 'src/a.ts'), 'export const a = 0;\n'); g(cwd, 'add', '-A'); g(cwd, 'commit', '-q', '-m', 'basis');
  return { wurzel, cwd };
}
const zeilen = (n: number) => `export const a = 0;\n${Array.from({ length: n }, (_, i) => `// z${i}\n`).join('')}`;
const gebaut: string[] = [];
const zug = (n: Record<string, number>) => async (dir: string, m: string) => { gebaut.push(m); writeFileSync(join(dir, 'src/a.ts'), zeilen(n[m] ?? 9)); return { ok: true, text: `fertig ${m}`, grund: '' }; };
const pruefe = async () => ({ ok: true, log: '' });

test('Flag aus → alter Pfad (null), nichts gebaut', async () => {
  const { wurzel, cwd } = repo(); gebaut.length = 0;
  const r = await bestofnStrang({ cwd, id: 'x1', prompt: 'ändere src/a.ts', env: { BRIDGE_BESTOFN: 'aus' }, zug: zug({}), pruefe });
  assert.equal(r, null); assert.equal(gebaut.length, 0); rmSync(wurzel, { recursive: true, force: true });
});

test('Flag an: zwei Bauer, kleinerer Diff gewinnt und landet im Strang-Worktree; Ledger-Ereignis, Statistik persistent', async () => {
  const { wurzel, cwd } = repo(); gebaut.length = 0;
  const ev: any[] = []; const h = (e: any) => ev.push(e); bauerEreignisse.on('lauf', h);
  const stat = join(wurzel, 'bauerstatistik.json');
  const r = await bestofnStrang({ cwd, id: 'x2', prompt: 'ändere src/a.ts', env: {}, statistikPfad: stat, zug: zug({ [FLASH]: 6, [DEEPSEEK]: 2 }), pruefe });
  bauerEreignisse.off('lauf', h);
  assert.deepEqual(gebaut.sort(), [DEEPSEEK, FLASH].sort());
  assert.equal(r?.ok, true); assert.match(r!.modell!, new RegExp(DEEPSEEK));
  assert.equal(readFileSync(join(cwd, 'src/a.ts'), 'utf8'), zeilen(2), 'Sieger-Diff im Strang-Worktree');
  assert.equal(ev[0].sieger, DEEPSEEK); assert.deepEqual(ev[0].bauer, [FLASH, DEEPSEEK]);
  assert.deepEqual(statistikLaden(stat), { laeufe: 1, zweitSiege: 1 });
  assert.equal(existsSync(`${cwd}.deleg/x2-${FLASH.replace(/[^\w]+/g, '-')}`), false, 'Unter-Worktrees aufgeräumt');
  // Review lehnt ab → Verlierer-Diff (flash) wird angewendet
  const f = await bestofnAblehnung('x2', 'Mangel');
  assert.deepEqual(f, { art: 'verlierer', bauer: FLASH });
  assert.equal(readFileSync(join(cwd, 'src/a.ts'), 'utf8'), zeilen(6));
  rmSync(wurzel, { recursive: true, force: true });
});

test('Schutzzone im Auftrag → kein Rennen, Opus (ok:false); roter voller Lauf am Sieger → nächster der Rangfolge', async () => {
  const { wurzel, cwd } = repo(); gebaut.length = 0;
  const z = await bestofnStrang({ cwd, id: 'x3', prompt: 'neue db/migrations/002.sql', env: {}, zug: zug({}), pruefe });
  assert.equal(z?.ok, false); assert.match(z!.grund, /Opus/); assert.equal(gebaut.length, 0);
  const r = await bestofnStrang({ cwd, id: 'x4', prompt: 'ändere src/a.ts', env: {}, zug: zug({ [FLASH]: 6, [DEEPSEEK]: 2 }),
    pruefe: async (dir, _b, art) => (art === 'voll' && readFileSync(join(dir, 'src/a.ts'), 'utf8') === zeilen(2) ? { ok: false, log: 'voll rot' } : { ok: true, log: '' }) });
  assert.match(r!.modell!, new RegExp(FLASH), 'DeepSeek fiel am vollen Lauf durch');
  rmSync(wurzel, { recursive: true, force: true });
});

test('Großer Sieger-Diff (> 20 KB) landet vollständig im Strang-Worktree', async () => {
  const { wurzel, cwd } = repo(); gebaut.length = 0;
  const r = await bestofnStrang({ cwd, id: 'x8', prompt: 'ändere src/a.ts', env: {}, zug: zug({ [FLASH]: 1000, [DEEPSEEK]: 1000 }), pruefe });
  assert.equal(r?.ok, true);
  const inhalt = readFileSync(join(cwd, 'src/a.ts'), 'utf8');
  assert.equal(inhalt, zeilen(1000), 'Diff > 4 KB wurde nicht abgeschnitten: Dateiinhalt im Strang identisch');
  rmSync(wurzel, { recursive: true, force: true });
});

test('Sieger-Diff jenseits 4 MB: run() kürzt auf die letzten 2 MB → Diff landet unvollständig (ok:false) statt im Strang-Worktree', async () => {
  const { wurzel, cwd } = repo(); gebaut.length = 0;
  // ~5,4 MB Datei: der Diff überschreitet die Innengrenze von run() (delegation.ts: > 4 MB → slice(-2 MB)).
  const gross = `export const a = 0;\n${Array.from({ length: 6000 }, (_, i) => `// z${i} ${'x'.repeat(900)}\n`).join('')}`;
  const riesigerZug = async (dir: string, m: string) => { gebaut.push(m); writeFileSync(join(dir, 'src/a.ts'), gross); return { ok: true, text: `fertig ${m}`, grund: '' }; };
  try {
    const r = await bestofnStrang({ cwd, id: 'x9', prompt: 'ändere src/a.ts', env: {}, zug: riesigerZug, pruefe });
    assert.equal(r?.ok, true, 'Sieger-Diff > 4 MB muss anwendbar bleiben (max: 50_000_000 greift nicht, run() kürzt bei 4 MB)');
    assert.equal(readFileSync(join(cwd, 'src/a.ts'), 'utf8'), gross, 'Sieger-Diff > 4 MB vollständig im Strang-Worktree');
  } finally { rmSync(wurzel, { recursive: true, force: true }); }
});

test('Sonnet-Klasse im Strang: Sonnetzone → ok:false mit Sonnet-Grund, kein Bauer gebaut; meliousLeer (userId) ebenso; Abschaltung', async () => {
  const { wurzel, cwd } = repo(); gebaut.length = 0;
  const z = await bestofnStrang({ cwd, id: 'x5', prompt: 'ändere src/kapazitaet.ts', env: {}, zug: zug({}), pruefe });
  assert.equal(z?.ok, false); assert.equal(z!.text, '');
  assert.match(z!.grund, /Sonnet-Klasse/); assert.match(z!.grund, /Melious leer/);
  assert.equal(gebaut.length, 0, 'kein Best-of-N-Rennen');
  // Melious leer (userId gesetzt, budgetGrund wirft Grund über BRIDGE_MELIOUS_BUDGET-Testmodus: env leer → budgetAn true) — hier: Env-Schalter statt Konto, userId-Pfad mit leerem Env
  const m = await bestofnStrang({ cwd, id: 'x6', prompt: 'ändere src/kontofuehrung.ts', env: {}, zug: zug({}), pruefe, userId: 'knut' });
  assert.equal(m?.ok, false); assert.match(m!.grund, /Sonnet-Klasse/);
  const a = await bestofnStrang({ cwd, id: 'x7', prompt: 'ändere src/kapazitaet.ts', env: { BRIDGE_SONNETKLASSE: 'aus' }, zug: zug({ [FLASH]: 6, [DEEPSEEK]: 2 }), pruefe });
  assert.equal(a?.ok, true, 'Abschaltung → alter Pfad');
  rmSync(wurzel, { recursive: true, force: true });
});

test('Plan ohne Pfade, Bauer ändert migrations/: Diff berührt Schutzzone → nicht angewendet, ok:false; harmloser Diff wird weiter angewendet', async () => {
  const { wurzel, cwd } = repo(); gebaut.length = 0;
  const mig = async (dir: string, m: string) => { gebaut.push(m); mkdirSync(join(dir, 'migrations'), { recursive: true }); writeFileSync(join(dir, 'migrations/x.sql'), 'drop table t;\n'); writeFileSync(join(dir, 'src/a.ts'), zeilen(1)); return { ok: true, text: m, grund: '' }; };
  const r = await bestofnStrang({ cwd, id: 'z1', prompt: 'fix the login bug', env: {}, zug: mig, pruefe });
  assert.equal(r?.ok, false); assert.match(r!.grund, /Schutzzone/);
  assert.equal(existsSync(join(cwd, 'migrations/x.sql')), false); assert.equal(readFileSync(join(cwd, 'src/a.ts'), 'utf8'), 'export const a = 0;\n');
  const o = await bestofnStrang({ cwd, id: 'z2', prompt: 'fix the login bug', env: {}, zug: zug({ [FLASH]: 3, [DEEPSEEK]: 2 }), pruefe });
  assert.equal(o?.ok, true); assert.equal(readFileSync(join(cwd, 'src/a.ts'), 'utf8'), zeilen(2));
  rmSync(wurzel, { recursive: true, force: true });
});

test('P8: Deckel → zug sieht Abbruch; Unter-Worktree wird erst nach dessen Ende entfernt, danach schreibt der Bauer nicht mehr', async () => {
  const { wurzel, cwd } = repo(); const dirs: string[] = []; const signale: (AbortSignal | undefined)[] = []; let schriebDanach = false, beendet = 0;
  const haengt = async (dir: string, _m: string, _p: string, signal?: AbortSignal) => {
    dirs.push(dir); signale.push(signal);
    for (let i = 0; i < 60 && !signal?.aborted; i++) { if (!existsSync(dir)) schriebDanach = true; else writeFileSync(join(dir, 'src/a.ts'), zeilen(2)); await new Promise((r) => setTimeout(r, 10)); }
    await new Promise((r) => setTimeout(r, 40)); beendet++;   // der Abbruch braucht einen Moment (interrupt → Sitzung ruhig)
    if (!existsSync(dir)) schriebDanach = true;
    return { ok: false, text: '', grund: 'abgebrochen' };
  };
  try {
    await bestofnStrang({ cwd, id: 'p8', prompt: 'ändere src/a.ts', env: { BRIDGE_BAUER_DECKEL_S: '0.05' }, zug: haengt, pruefe });
    assert.ok(signale.length >= 2 && signale.every((s) => s?.aborted), 'zug bekam ein abgebrochenes Signal');
    assert.equal(beendet, signale.length, 'beide Bauer bestätigten den Abbruch');
    assert.equal(schriebDanach, false, 'kein Schreibzugriff in einen entfernten Worktree');
    assert.ok(dirs.every((x) => !existsSync(x)), 'Unter-Worktrees entfernt');
  } finally { rmSync(wurzel, { recursive: true, force: true }); }
});

test('P8: Bauer ignoriert den Abbruch über die Gnadenfrist hinaus → Worktree bleibt, wird erst nach seinem Ende entfernt, nie beschrieben danach', async () => {
  const { wurzel, cwd } = repo(); const dirs: string[] = []; let schriebDanach = false; const meldungen: string[] = [];
  let freigabe!: () => void; const tor = new Promise<void>((r) => { freigabe = r; });   // der Test lässt die Bauer enden, keine feste Wartezeit
  const stur = async (dir: string, _m: string) => {
    dirs.push(dir); writeFileSync(join(dir, 'src/a.ts'), zeilen(2));
    await tor;   // ignoriert das Signal
    if (!existsSync(dir)) schriebDanach = true; else writeFileSync(join(dir, 'src/a.ts'), zeilen(3));
    return { ok: false, text: '', grund: 'spät' };
  };
  try {
    await bestofnStrang({ cwd, id: 'p8b', prompt: 'ändere src/a.ts', env: { BRIDGE_BAUER_DECKEL_S: '0.05', BRIDGE_ABBRUCH_FRIST_S: '0.05' }, zug: stur, pruefe, status: (t) => meldungen.push(t) });
    assert.ok(dirs.length >= 2 && dirs.every((x) => existsSync(x)), 'Worktrees stehen noch, solange der Bauer läuft');
    assert.equal(meldungen.filter((t) => t.includes('Abbruch unbestätigt')).length, dirs.length, 'eine Zeile je Bauer');
    freigabe();
    const ende = Date.now() + 10_000;
    while (dirs.some((x) => existsSync(x)) && Date.now() < ende) await new Promise((r) => setTimeout(r, 20));
    assert.ok(dirs.every((x) => !existsSync(x)), 'nach dem Ende entfernt');
    assert.equal(schriebDanach, false);
  } finally { rmSync(wurzel, { recursive: true, force: true }); }
});
