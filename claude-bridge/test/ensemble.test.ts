// Knut 06.11. (D1/D2): Review-Ensemble — drei Prüfläufe parallel, Verifizierer glm-5.2 mit den zitierten Stellen, Schatten glm-5.3-flash
// auf denselben Prüfergebnissen, Rückfall jcode je Lauf, kein Prüflauf verzichtbar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensemble, stellen, mitRueckfall, schattenAn, diffBlock, verifiziererPrompt, PRUEFER, VERIFIZIERER, SCHATTEN, type EnsLauf, type Lauf } from '../src/ensemble.ts';

const leer = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const lauf = (laeufer: 'opencode2' | 'jcode', antwort: (m: string, p: string, rolle: string) => string | null, aufrufe: { m: string; p: string; rolle: string; laeufer: string; t: number }[]): Lauf => async (m, p, rolle) => {
  aufrufe.push({ m, p, rolle, laeufer, t: Date.now() });
  await new Promise((r) => setTimeout(r, 20));
  const t = antwort(m, p, rolle);
  return { rolle, modell: m, ok: t !== null, text: t ?? '', s: 0.02, usage: leer, laeufer, gelaufen: m, ...(t === null ? { grund: 'leer' } : {}) } as EnsLauf;
};
const DATEI = Array.from({ length: 30 }, (_, i) => `zeile ${i + 1}`).join('\n');

test('drei Prüfer parallel mit Diff; Verifizierer glm-5.2 und Schatten glm-5.3-flash bekommen dieselben Ergebnisse und die Stellen', async () => {
  const aufrufe: any[] = [];
  const e = await ensemble({
    auftrag: 'Review X', bereich: 'a..b', diff: '+neu\n', dateien: ['src/a.ts', 'lib/b.ts'], lies: (f) => (f === 'src/a.ts' ? DATEI : null), schatten: true,
    lauf: lauf('opencode2', (m, _p, rolle) => (rolle.startsWith('pruefer') ? `Befund in src/a.ts:10 (${m})` : `bestätigt (${m})`), aufrufe),
  });
  assert.equal(e.ok, true);
  const pr = aufrufe.filter((a) => a.rolle.startsWith('pruefer'));
  assert.deepEqual(pr.map((a) => a.m).sort(), [...PRUEFER].sort());
  assert.ok(Math.max(...pr.map((a) => a.t)) - Math.min(...pr.map((a) => a.t)) < 15, 'parallel gestartet');
  assert.ok(pr.every((a) => a.p.includes('```diff\n+neu') && a.p.includes('Nenne jeden Befund mit Datei:Zeile')));
  const v = aufrufe.find((a) => a.rolle === `verifizierer-${VERIFIZIERER}`), s = aufrufe.find((a) => a.rolle === `schatten-${SCHATTEN}`);
  assert.ok(v && s, 'Verifizierer und Schatten liefen');
  assert.equal(v.p, s.p, 'gleiche Grundlage');
  assert.match(v.p, /--- src\/a\.ts:6-14\n {4}6 zeile 6/);
  assert.ok(PRUEFER.every((m) => v.p.includes(`=== Prüfer ${m} ===`)));
  assert.match(e.text, /^bestätigt \(glm-5\.2\)/);
  assert.match(e.text, /Schatten glm-5\.3-flash protokolliert/);
  assert.equal(e.schatten?.text, 'bestätigt (glm-5.3-flash)');
});

test('fehlt ein Prüflauf, steht das sichtbar da (keiner verzichtbar); ohne Verifizierer kein Ergebnis', async () => {
  const e = await ensemble({ auftrag: 'R', bereich: '', diff: '', dateien: [], lies: () => null, schatten: false,
    lauf: lauf('opencode2', (m, _p, r) => (r.startsWith('pruefer') && m === 'glm-5.2' ? null : 'ok'), []) });
  assert.equal(e.ok, false); assert.match(e.text, /Prüflauf fehlt: glm-5\.2/); assert.equal(e.schatten, null);
  const f = await ensemble({ auftrag: 'R', bereich: '', diff: '', dateien: [], lies: () => null, schatten: false, lauf: lauf('opencode2', (_m, _p, r) => (r.startsWith('verifizierer') ? null : 'x'), []) });
  assert.equal(f.ok, false); assert.match(String(f.grund), /Verifizierer glm-5\.2/);
  // Pass C (Fix-Runde 2, S4): nur ein Prüfergebnis → kein Verifizierer, kein Schein-Erfolg
  const b: any[] = [];
  const g = await ensemble({ auftrag: 'R', bereich: '', diff: '', dateien: [], lies: () => null, schatten: true, lauf: lauf('opencode2', (m, _p, r) => (r.startsWith('pruefer') && m !== 'glm-5.2' ? null : 'nichts bestätigt'), b) });
  assert.equal(g.ok, false); assert.equal(g.verifizierer.ok, false); assert.match(String(g.grund), /nur 1 von 3 Prüfläufen/);
  assert.ok(!b.some((x) => String(x.rolle).startsWith('verifizierer') || String(x.rolle).startsWith('schatten')), 'Verifizierer und Schatten nicht gestartet');
});

test('Rückfall: liefert opencode 2 nichts, läuft derselbe Auftrag über jcode; ohne Server alles über jcode', async () => {
  const a: any[] = [];
  const r = await mitRueckfall(lauf('opencode2', () => null, a), lauf('jcode', () => 'aus jcode', a), () => false)('glm-5.2', 'P', 'pruefer-glm-5.2');
  assert.equal(r.ok, true); assert.equal(r.laeufer, 'jcode'); assert.match(String(r.grund), /opencode 2: leer → jcode/);
  assert.deepEqual(a.map((x) => x.laeufer), ['opencode2', 'jcode']);
  const b: any[] = [];
  await mitRueckfall(null, lauf('jcode', () => 'j', b), () => false)('m', 'P', 'r');
  assert.deepEqual(b.map((x) => x.laeufer), ['jcode']);
});

test('Stellen: nur Dateien des Repos, höchstens 60 Zeilen, ± 4; Schatten bis 20.11. (übersteuerbar); Diff gekürzt', () => {
  const st = stellen(['siehe ./src/a.ts:2 und a.ts:20-22, fremd.ts:3, src/a.ts:1-200'], ['src/a.ts'], () => DATEI);
  assert.equal(st.length, 2);
  assert.deepEqual(st.map((s) => s.split('\n')[0]).sort(), ['--- src/a.ts:1-6', '--- src/a.ts:16-26']);
  // K4: mehrdeutiges Dateiende („index.ts“ in zwei Ordnern) → keine Stelle statt der falschen Datei; K5: überlappende Stellen derselben
  // Datei werden ein Ausschnitt
  assert.deepEqual(stellen(['index.ts:3'], ['a/index.ts', 'b/index.ts'], () => DATEI), []);
  assert.deepEqual(stellen(['b/index.ts:3'], ['a/index.ts', 'b/index.ts'], () => DATEI).map((s) => s.split('\n')[0]), ['--- b/index.ts:1-7']);
  assert.deepEqual(stellen(['src/a.ts:10 und src/a.ts:12, src/a.ts:30'], ['src/a.ts'], () => DATEI).map((s) => s.split('\n')[0]), ['--- src/a.ts:6-16', '--- src/a.ts:26-30']);
  // K5: Stellen nur ganz — eine zu große zweite Stelle fällt weg statt halb im Prompt zu stehen
  const vp = verifiziererPrompt('A', '', [], ['--- a:1-1\n' + 'x'.repeat(30_000), '--- b:1-1\n' + 'y'.repeat(30_000)], false);
  assert.ok(vp.includes('--- a:1-1') && !vp.includes('--- b:1-1') && !vp.includes('yyyy'), 'zweite Stelle ganz weggelassen');
  assert.equal(schattenAn({}, '2026-11-20'), true); assert.equal(schattenAn({}, '2026-11-21'), false);
  assert.equal(schattenAn({ BRIDGE_ENSEMBLE_SCHATTEN: 'aus' }, '2026-11-07'), false); assert.equal(schattenAn({ BRIDGE_ENSEMBLE_SCHATTEN: 'an' }, '2027-01-01'), true);
  assert.match(diffBlock('a..b', 'x'.repeat(90_000)), /\[… Diff gekürzt\]/); assert.equal(diffBlock('a..b', '  '), '');
});

test('Pass A (Fix-Runde 2, S4): jcode-Prompt bleibt unter der Grenze eines Befehlszeilen-Arguments', async () => {
  const { jcodePromptArg, JCODE_PROMPT_MAX } = await import('../src/sessions.ts');
  assert.equal(jcodePromptArg('kurz'), 'kurz');
  const lang = jcodePromptArg('ä'.repeat(200_000));
  assert.ok(Buffer.byteLength(lang) < 128 * 1024 && Buffer.byteLength(lang) <= JCODE_PROMPT_MAX + 200); assert.match(lang, /gekürzt/);
});
