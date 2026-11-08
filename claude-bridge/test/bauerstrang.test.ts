import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { bestofnStrang, bestofnAblehnung, ablehnungsZiel, kandidatDiff } from '../src/bauerstrang.ts';
import { bauerEreignisse, statistikLaden, tamperGruende, SONNET } from '../src/bauerrennen.ts';
import { FLASH, DEEPSEEK, GLM } from '../src/modellwahl.ts';
import { BAUER_REGELN } from '../src/strangpruefung.ts';

const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });
function repo() {
  const wurzel = mkdtempSync(join(tmpdir(), 'bst-')); const cwd = join(wurzel, 'strang'); mkdirSync(join(cwd, 'src'), { recursive: true });
  g(cwd, 'init', '-q', '-b', 'main'); writeFileSync(join(cwd, 'src/a.ts'), 'export const a = 0;\n'); g(cwd, 'add', '-A'); g(cwd, 'commit', '-q', '-m', 'basis');
  return { wurzel, cwd };
}
const zeilen = (n: number) => `export const a = 0;\n${Array.from({ length: n }, (_, i) => `// z${i}\n`).join('')}`;
const gebaut: string[] = [];
const PRUEFER_SAUBER = { ok: true, text: 'ERGEBNIS: keine Befunde', grund: '' };   // L2: der Prüfer der Strang-Prüfung findet in diesen Tests nichts
const zug = (n: Record<string, number>) => async (dir: string, m: string, prompt = '') => { if (prompt.startsWith('Linse')) return PRUEFER_SAUBER; gebaut.push(m); writeFileSync(join(dir, 'src/a.ts'), zeilen(n[m] ?? 9)); return { ok: true, text: `fertig ${m}`, grund: '' }; };
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
  // L3a: nach 2 abgelehnten Fixrunden geht die Eskalation an Sonnet, nie an glm-5.3
  assert.equal(await bestofnAblehnung('x2', 'm2'), null); assert.equal(await bestofnAblehnung('x2', 'm3'), null);
  const e = await bestofnAblehnung('x2', 'm4') as any;
  assert.equal(e.art, 'eskalation'); assert.equal(e.modell, SONNET); assert.notEqual(e.modell, GLM); assert.ok(e.fehlerlogs.length >= 4);
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
  const riesigerZug = async (dir: string, m: string, prompt = '') => { if (prompt.startsWith('Linse')) return PRUEFER_SAUBER; gebaut.push(m); writeFileSync(join(dir, 'src/a.ts'), gross); return { ok: true, text: `fertig ${m}`, grund: '' }; };
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
    while ((dirs.some((x) => existsSync(x)) || g(cwd, 'branch', '--list', 'werkbank/deleg-*').trim()) && Date.now() < ende) await new Promise((r) => setTimeout(r, 20));   // Aufräumen = Worktree, dann Branch
    assert.ok(dirs.every((x) => !existsSync(x)), 'nach dem Ende entfernt');
    assert.equal(schriebDanach, false);
  } finally { rmSync(wurzel, { recursive: true, force: true }); }
});

test('L3b: alle Bauer bleiben rot → ok:false mit Sonnet-Klassen-Grund (Übergabe an Sonnet auf Claude), nichts angewendet', async () => {
  const { wurzel, cwd } = repo(); gebaut.length = 0;
  const rot = async () => ({ ok: false, log: 'tsc rot' });
  const r = await bestofnStrang({ cwd, id: 'x8', prompt: 'ändere src/a.ts', env: {}, zug: zug({}), pruefe: rot });
  assert.equal(r?.ok, false); assert.equal(r!.text, '');
  assert.match(r!.grund, /Sonnet-Klasse/); assert.match(r!.grund, /Sonnet baut/);
  assert.ok(gebaut.length >= 2, 'beide Bauer liefen');
  assert.equal(readFileSync(join(cwd, 'src/a.ts'), 'utf8'), 'export const a = 0;\n', 'nichts angewendet');
  rmSync(wurzel, { recursive: true, force: true });
});

test('L3c: beide Rennbauer rot, Retry (erster Bauer, eigener Worktree) baut wirklich, gewinnt; danach kein .deleg-Worktree, kein werkbank/deleg-Branch', async () => {
  const { wurzel, cwd } = repo();
  const aufrufe: { m: string; dir: string; prompt: string }[] = [];
  const retryZug = async (dir: string, m: string, prompt: string) => {
    if (prompt.startsWith('Linse')) return PRUEFER_SAUBER;
    aufrufe.push({ m, dir, prompt });
    writeFileSync(join(dir, 'src/a.ts'), zeilen(aufrufe.length > 2 ? 3 : 9));
    if (aufrufe.length > 2) g(dir, 'commit', '-q', '-a', '-m', 'retry');
    return { ok: true, text: `fertig ${m}`, grund: '' };
  };
  let schnellN = 0;
  const pruefeRot2 = async (_d: string, _b: string, art: 'schnell' | 'voll') => (art === 'schnell' && ++schnellN <= 2 ? { ok: false, log: 'tsc rot im Rennen' } : { ok: true, log: '' });
  const r = await bestofnStrang({ cwd, id: 'x9', prompt: 'ändere src/a.ts', env: {}, zug: retryZug, pruefe: pruefeRot2 });
  assert.equal(aufrufe.length, 3, 'zwei Rennbauer plus Retry liefen');
  assert.equal(aufrufe[2].m, FLASH, 'Retry = erster Bauer');
  assert.ok(aufrufe.slice(0, 2).every((x) => x.dir !== aufrufe[2].dir), 'Retry hat eigenen Worktree');
  assert.match(aufrufe[2].prompt, /Fehlerlogs/); assert.match(aufrufe[2].prompt, /tsc rot im Rennen/);
  assert.equal(r?.ok, true, `Retry-Sieger angewendet: ${JSON.stringify(r)}`);
  assert.equal(readFileSync(join(cwd, 'src/a.ts'), 'utf8'), zeilen(3));
  assert.ok(!/\.deleg/.test(g(cwd, 'worktree', 'list')), 'kein .deleg-Worktree übrig');
  assert.equal(g(cwd, 'branch', '--list', 'werkbank/deleg-*').trim(), '', 'kein werkbank/deleg-Branch übrig');
  rmSync(wurzel, { recursive: true, force: true });
});

test('L3b: ablehnungsZiel — Eskalation (modell sonnet) geht an die Sonnet-Klassen-Übergabe, nie als OC2-Modell weiter', async () => {
  const { wurzel, cwd } = repo(); gebaut.length = 0;
  const kl = await bestofnStrang({ cwd, id: 'x9', prompt: 'ändere src/kapazitaet.ts', env: {}, zug: zug({}), pruefe });
  const z = ablehnungsZiel({ art: 'eskalation', modell: SONNET, fehlerlogs: ['a'] });
  assert.deepEqual(z, kl, 'identisch zur Sonnet-Klasse (ok:false, text, grund)');
  assert.equal(z?.ok, false);
  assert.equal(ablehnungsZiel({ art: 'verlierer', bauer: FLASH }), null);
  assert.equal(ablehnungsZiel(null), null);
  rmSync(wurzel, { recursive: true, force: true });
});

// ---- L2: Strang-Prüfung im Best-of-N-Strang ------------------------------------------------------------------------------------------
const PRUEFTEST = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\ntest('fix da', () => assert.match(readFileSync(new URL('./a.ts', import.meta.url), 'utf8'), /\\/\\/ fix/));\n";
/** Bauer: DeepSeek baut klein (gewinnt). Prüfer (Prompt beginnt mit "Linse"): Linse 1 schreibt einen roten Test, solange der Fix fehlt; sonst "keine Befunde". Fixer ("## Fixrunde"): hängt "// fix" an. */
function l2Zug(log: { m: string; prompt: string }[], opt: { ohneErgebnis?: boolean; boese?: boolean; manip?: boolean } = {}) {
  return async (dir: string, m: string, prompt: string, _signal?: AbortSignal) => {
    log.push({ m, prompt });
    const a = join(dir, 'src/a.ts');
    if (prompt.startsWith('Linse')) {
      if (opt.ohneErgebnis) return { ok: true, text: 'ich habe nichts gesagt', grund: '' };
      const fehlt = !readFileSync(a, 'utf8').includes('// fix');
      if (fehlt && prompt.startsWith('Linse Logik')) writeFileSync(join(dir, 'src/pruef.test.ts'), PRUEFTEST);
      if (fehlt && opt.boese) { writeFileSync(a, readFileSync(a, 'utf8') + '// BÖSE\n'); writeFileSync(join(dir, 'src/extra.ts'), 'export const x = 1;\n'); }
      return { ok: true, text: fehlt && prompt.startsWith('Linse Logik') ? 'ERGEBNIS: 1 rote Tests' : 'ERGEBNIS: keine Befunde', grund: '' };
    }
    if (prompt.startsWith('## Fixrunde') && opt.manip) { writeFileSync(join(dir, 'src/pruef.test.ts'), "import { test } from 'node:test';\ntest('trivial', () => {});\n"); return { ok: true, text: 'getrickst', grund: '' }; }
    if (prompt.startsWith('## Fixrunde')) { writeFileSync(a, readFileSync(a, 'utf8') + '// fix\n'); return { ok: true, text: 'gefixt', grund: '' }; }
    writeFileSync(a, zeilen(m === DEEPSEEK ? 2 : 6)); return { ok: true, text: `fertig ${m} GEHEIMER-BAUERTEXT`, grund: '' };
  };
}

test('L2: Prüfer schreibt roten Test, Fixrunde, Runde 2 sauber → Strang bekommt Fix + Prüfer-Test; Ledger mit phasen (≥ 2 Runden) und gateLog; Prüfer-Prompt nur Diff/DoD/Tests', async () => {
  const { wurzel, cwd } = repo(); const log: { m: string; prompt: string }[] = [];
  const ev: any[] = []; const h = (e: any) => ev.push(e); bauerEreignisse.on('lauf', h);
  try {
    const r = await bestofnStrang({ cwd, id: 'l2a', prompt: 'ändere src/a.ts, DoD-MARKER', env: {}, zug: l2Zug(log), pruefe });
    assert.equal(r?.ok, true, JSON.stringify(r));
    assert.equal(readFileSync(join(cwd, 'src/a.ts'), 'utf8'), zeilen(2) + '// fix\n', 'Fix im Strang');
    assert.equal(readFileSync(join(cwd, 'src/pruef.test.ts'), 'utf8'), PRUEFTEST, 'Prüfer-Test im Strang');
    const e = ev.find((x) => x.id === 'l2a');
    assert.ok(e.phasen.length >= 2, `phasen: ${JSON.stringify(e.phasen)}`); assert.ok(Array.isArray(e.gateLog) && e.gateLog.length > 0, 'gateLog');
    const pruefer = log.filter((x) => x.prompt.startsWith('Linse'));
    assert.ok(pruefer.length >= 4, 'beide Linsen, zwei Runden');
    assert.ok(pruefer.every((x) => x.m === FLASH), 'Prüfer = das andere Modell als der Sieger (DeepSeek)');
    assert.ok(log.filter((x) => x.prompt.startsWith('## Fixrunde')).every((x) => x.m === DEEPSEEK), 'Fixer = Siegermodell');
    for (const x of pruefer) { assert.match(x.prompt, /DoD-MARKER/); assert.match(x.prompt, /^diff --git/m); assert.ok(!x.prompt.includes('GEHEIMER-BAUERTEXT'), 'kein Bauertext'); assert.ok(!x.prompt.includes(BAUER_REGELN), 'keine Bauerregeln'); }
    assert.ok(log.filter((x) => !x.prompt.startsWith('Linse') && !x.prompt.startsWith('## Fixrunde')).every((x) => x.prompt.includes(BAUER_REGELN)), 'Bauer-Prompt hat BAUER_REGELN');
  } finally { bauerEreignisse.off('lauf', h); rmSync(wurzel, { recursive: true, force: true }); }
});

test('L2: BRIDGE_STRANGPRUEFUNG=aus → alter Pfad: kein Prüfer, keine Regeln im Prompt, Diff unverändert, kein phasen im Ledger', async () => {
  const { wurzel, cwd } = repo(); const log: { m: string; prompt: string }[] = [];
  const ev: any[] = []; const h = (e: any) => ev.push(e); bauerEreignisse.on('lauf', h);
  try {
    const r = await bestofnStrang({ cwd, id: 'l2b', prompt: 'ändere src/a.ts', env: { BRIDGE_STRANGPRUEFUNG: 'aus' }, zug: l2Zug(log), pruefe });
    assert.equal(r?.ok, true);
    assert.equal(readFileSync(join(cwd, 'src/a.ts'), 'utf8'), zeilen(2)); assert.equal(existsSync(join(cwd, 'src/pruef.test.ts')), false);
    assert.equal(log.length, 2, 'nur die zwei Bauer'); assert.ok(log.every((x) => !x.prompt.includes(BAUER_REGELN)));
    assert.equal(ev.find((x) => x.id === 'l2b').phasen, undefined);
  } finally { bauerEreignisse.off('lauf', h); rmSync(wurzel, { recursive: true, force: true }); }
});

test('L2: roter voller Lauf nach der Schleife → L3-Kette, am Ende nie ok (Sonnet-Übergabe), nichts angewendet', async () => {
  const { wurzel, cwd } = repo(); const log: { m: string; prompt: string }[] = [];
  const voll = async (dir: string, _b: string, art: 'schnell' | 'voll') => (art === 'voll' && existsSync(join(dir, 'src/pruef.test.ts')) ? { ok: false, log: 'voll rot nach Schleife' } : { ok: true, log: '' });
  try {
    const r = await bestofnStrang({ cwd, id: 'l2c', prompt: 'ändere src/a.ts', env: {}, zug: l2Zug(log), pruefe: voll });
    assert.equal(r?.ok, false, JSON.stringify(r)); assert.match(r!.grund, /Sonnet-Klasse/);
    assert.equal(readFileSync(join(cwd, 'src/a.ts'), 'utf8'), 'export const a = 0;\n', 'nichts angewendet');
  } finally { rmSync(wurzel, { recursive: true, force: true }); }
});

test('L2: Prüfer ohne ERGEBNIS-Zeile gilt nie als sauber → nicht ok', async () => {
  const { wurzel, cwd } = repo(); const log: { m: string; prompt: string }[] = [];
  try {
    const r = await bestofnStrang({ cwd, id: 'l2d', prompt: 'ändere src/a.ts', env: {}, zug: l2Zug(log, { ohneErgebnis: true }), pruefe });
    assert.equal(r?.ok, false, JSON.stringify(r));
  } finally { rmSync(wurzel, { recursive: true, force: true }); }
});

test('L2: Prüfer hängt → 10-min-Deckel geht über das Abort-Signal an zug, Aufruf wird wirklich beendet', async () => {
  const { wurzel, cwd } = repo(); let signalAbgebrochen = false, beendet = false; const tor: { auf?: () => void } = {};
  const zug = async (dir: string, m: string, prompt: string, signal?: AbortSignal) => {
    if (!prompt.startsWith('Linse')) { writeFileSync(join(dir, 'src/a.ts'), zeilen(m === DEEPSEEK ? 2 : 6)); return { ok: true, text: 'x', grund: '' }; }
    await new Promise<void>((res) => { signal?.addEventListener('abort', () => { signalAbgebrochen = true; res(); }); tor.auf = res; });
    beendet = true; return { ok: false, text: '', grund: 'abgebrochen' };
  };
  try {
    const r = await bestofnStrang({ cwd, id: 'l2e', prompt: 'ändere src/a.ts', env: { BRIDGE_PRUEFER_DECKEL_S: '0.05' }, zug, pruefe });
    assert.equal(signalAbgebrochen, true); assert.equal(beendet, true, 'gekappter Prüfer ist beendet, nicht liegengelassen');
    assert.equal(r?.ok, false, 'Prüfer ohne Ergebnis ist nie sauber');
  } finally { tor.auf?.(); rmSync(wurzel, { recursive: true, force: true }); }
});

test('L2: Prüfer ändert Produktcode und legt Nicht-Test an → verworfen (Builder-Stand im Strang), Test bleibt, gateLog nennt es', async () => {
  const { wurzel, cwd } = repo(); const log: { m: string; prompt: string }[] = [];
  const ev: any[] = []; const h = (e: any) => ev.push(e); bauerEreignisse.on('lauf', h);
  try {
    const r = await bestofnStrang({ cwd, id: 'l2f', prompt: 'ändere src/a.ts', env: {}, zug: l2Zug(log, { boese: true }), pruefe });
    assert.equal(r?.ok, true, JSON.stringify(r));
    assert.equal(readFileSync(join(cwd, 'src/a.ts'), 'utf8'), zeilen(2) + '// fix\n', 'Prüfer-Änderung am Produktcode verworfen');
    assert.equal(existsSync(join(cwd, 'src/extra.ts')), false, 'neue Nicht-Test-Datei verworfen');
    assert.equal(readFileSync(join(cwd, 'src/pruef.test.ts'), 'utf8'), PRUEFTEST, 'Prüfer-Test bleibt');
    assert.ok(ev.find((x) => x.id === 'l2f').gateLog.some((l: string) => /Prüfer änderte Nicht-Test: .*src\/a\.ts.*src\/extra\.ts.*verworfen|Prüfer änderte Nicht-Test: .*src\/extra\.ts.*src\/a\.ts.*verworfen/.test(l)), 'gateLog');
  } finally { bauerEreignisse.off('lauf', h); rmSync(wurzel, { recursive: true, force: true }); }
});

test('L2: Fixer ändert den roten Prüfer-Test → Test wiederhergestellt, Schleife endet "manipuliert", nie ok, nichts angewendet', async () => {
  const { wurzel, cwd } = repo(); const log: { m: string; prompt: string }[] = [];
  const ev: any[] = []; const h = (e: any) => ev.push(e); bauerEreignisse.on('lauf', h);
  try {
    const r = await bestofnStrang({ cwd, id: 'l2g', prompt: 'ändere src/a.ts', env: {}, zug: l2Zug(log, { manip: true }), pruefe });
    assert.equal(r?.ok, false, JSON.stringify(r));
    assert.equal(readFileSync(join(cwd, 'src/a.ts'), 'utf8'), 'export const a = 0;\n'); assert.equal(existsSync(join(cwd, 'src/pruef.test.ts')), false, 'nichts angewendet');
    assert.ok(ev.find((x) => x.id === 'l2g').gateLog.some((l: string) => /Fixer änderte Prüfer-Test: src\/pruef\.test\.ts/.test(l)), 'gateLog');
  } finally { bauerEreignisse.off('lauf', h); rmSync(wurzel, { recursive: true, force: true }); }
});

// ---- wb21/fx-rennen: Tamper-Guard-Lücken, Retry-Sieger ohne Schleife, leere Prüfkonfiguration ----------------------------------------------
/** Repo mit bestehendem Test src/b.test.ts (+ Nicht-ASCII-Test src/ü.test.ts) und src/alt.test.ts mit zwei Assertions. */
function repoMitTests() {
  const r = repo();
  writeFileSync(join(r.cwd, 'src/b.test.ts'), "import { test } from 'node:test';\ntest('b', () => {});\n");
  writeFileSync(join(r.cwd, 'src/ü.test.ts'), "import { test } from 'node:test';\ntest('u', () => {});\n");
  writeFileSync(join(r.cwd, 'src/alt.test.ts'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('alt', () => {\n  assert.equal(1, 1);\n  assert.equal(2, 2);\n});\n");
  g(r.cwd, 'add', '-A'); g(r.cwd, 'commit', '-q', '-m', 'tests');
  return r;
}

test('Fix 1: kandidatDiff ohne Renames — Test per git mv aus dem Muster (auch Nicht-ASCII, .bak) → tamperGruende meldet gelöschte Testdatei', async () => {
  for (const [von, nach] of [['src/b.test.ts', 'src/b.ts'], ['src/b.test.ts', 'src/b.test.ts.bak'], ['src/ü.test.ts', 'src/ü.ts']]) {
    const { wurzel, cwd } = repoMitTests();
    try {
      const base = g(cwd, 'rev-parse', 'HEAD').trim();
      g(cwd, 'mv', von, nach);
      const diff = await kandidatDiff(cwd, base);
      const gr = tamperGruende(diff);
      assert.ok(gr.some((x) => /Testdatei gelöscht/.test(x)), `${von} → ${nach}: ${JSON.stringify(gr)}\n${diff}`);
    } finally { rmSync(wurzel, { recursive: true, force: true }); }
  }
});

test('Fix 1 (Ende zu Ende): beide Bauer benennen den Test aus dem Muster → kein Sieger, nichts angewendet', async () => {
  const { wurzel, cwd } = repoMitTests();
  const renameZug = async (dir: string, _m: string, prompt = '') => { if (prompt.startsWith('Linse')) return PRUEFER_SAUBER; g(dir, 'mv', 'src/b.test.ts', 'src/b.ts'); return { ok: true, text: 'fertig', grund: '' }; };
  try {
    const r = await bestofnStrang({ cwd, id: 'fx1', prompt: 'ändere src/a.ts', env: {}, zug: renameZug, pruefe });
    assert.equal(r?.ok, false, JSON.stringify(r));
    assert.equal(existsSync(join(cwd, 'src/b.test.ts')), true, 'Test im Strang unberührt'); assert.equal(existsSync(join(cwd, 'src/b.ts')), false);
  } finally { rmSync(wurzel, { recursive: true, force: true }); }
});

/** Zug wie l2Zug (DeepSeek baut klein, Prüfer schreibt roten Test), aber der Fixer richtet zusätzlich `fixerTut` an. */
function fixerZug(fixerTut: (dir: string) => void, builderTut: (dir: string) => void = () => {}) {
  return async (dir: string, m: string, prompt: string) => {
    const a = join(dir, 'src/a.ts');
    if (prompt.startsWith('Linse')) {
      const fehlt = !readFileSync(a, 'utf8').includes('// fix');
      if (fehlt && prompt.startsWith('Linse Logik')) writeFileSync(join(dir, 'src/pruef.test.ts'), PRUEFTEST);
      return { ok: true, text: fehlt && prompt.startsWith('Linse Logik') ? 'ERGEBNIS: 1 rote Tests' : 'ERGEBNIS: keine Befunde', grund: '' };
    }
    if (prompt.startsWith('## Fixrunde')) { writeFileSync(a, readFileSync(a, 'utf8') + '// fix\n'); fixerTut(dir); return { ok: true, text: 'gefixt', grund: '' }; }
    writeFileSync(a, zeilen(m === DEEPSEEK ? 2 : 6)); builderTut(dir); return { ok: true, text: `fertig ${m}`, grund: '' };
  };
}
const zeileWeg = (datei: string, muster: RegExp) => (dir: string) => { const f = join(dir, datei); writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter((z) => !muster.test(z)).join('\n')); };

test('Fix 2: Fixer löscht Assertion in bestehendem Repo-Test → nicht ok, Grund im gateLog, nichts angewendet', async () => {
  const { wurzel, cwd } = repoMitTests(); const ev: any[] = []; const h = (e: any) => ev.push(e); bauerEreignisse.on('lauf', h);
  try {
    const r = await bestofnStrang({ cwd, id: 'fx2a', prompt: 'ändere src/a.ts', env: {}, zug: fixerZug(zeileWeg('src/alt.test.ts', /assert\.equal\(2, 2\)/)), pruefe });
    assert.equal(r?.ok, false, JSON.stringify(r));
    assert.equal(readFileSync(join(cwd, 'src/a.ts'), 'utf8'), 'export const a = 0;\n', 'nichts angewendet');
    assert.ok(ev.find((x) => x.id === 'fx2a').gateLog.some((l: string) => /Tamper-Guard nach der Strang-Prüfung.*alt\.test\.ts/.test(l)), JSON.stringify(ev.find((x) => x.id === 'fx2a')?.gateLog));
  } finally { bauerEreignisse.off('lauf', h); rmSync(wurzel, { recursive: true, force: true }); }
});

test('Fix 2: Fixer schwächt den EIGENEN neuen Test des Bauers → nicht ok, Grund im gateLog', async () => {
  const { wurzel, cwd } = repoMitTests(); const ev: any[] = []; const h = (e: any) => ev.push(e); bauerEreignisse.on('lauf', h);
  const neuerTest = (dir: string) => writeFileSync(join(dir, 'src/neu.test.ts'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('neu', () => {\n  assert.equal(1, 1);\n  assert.equal(2, 2);\n});\n");
  try {
    const r = await bestofnStrang({ cwd, id: 'fx2b', prompt: 'ändere src/a.ts', env: {}, zug: fixerZug(zeileWeg('src/neu.test.ts', /assert\.equal\(2, 2\)/), neuerTest), pruefe });
    assert.equal(r?.ok, false, JSON.stringify(r));
    assert.ok(ev.find((x) => x.id === 'fx2b').gateLog.some((l: string) => /Tamper-Guard nach der Strang-Prüfung.*neu\.test\.ts/.test(l)), JSON.stringify(ev.find((x) => x.id === 'fx2b')?.gateLog));
  } finally { bauerEreignisse.off('lauf', h); rmSync(wurzel, { recursive: true, force: true }); }
});
