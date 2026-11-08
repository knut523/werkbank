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
