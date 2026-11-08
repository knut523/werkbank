import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bauerFuer, inSchutzzone, inSonnetzone, tamperGruende, waehle, rennen, nachAblehnung, Semaphor, neueStatistik, zaehle, abgeschaltet, bestofnAn, bauerDeckelMs, diffGroesse, pruefLauf, groupKill, OPUS, SONNET, VERLIERER_MS, type Deps, type Schnell, type BauErgebnis } from '../src/bauerrennen.ts';
import { laeuft, gruppeWeg } from '../src/prozesse.ts';
import { FLASH, DEEPSEEK, GLM } from '../src/modellwahl.ts';

const gruen: Schnell = { tsc: true, lint: true, tests: true };
const diffN = (n: number, datei = 'src/a.ts') => `diff --git a/${datei} b/${datei}\n--- a/${datei}\n+++ b/${datei}\n` + Array.from({ length: n }, (_, i) => `+zeile ${i}`).join('\n');
const A = { id: 't1', plan: 'p', dateien: ['src/a.ts'] };
const mk = (o: Record<string, { diff: string; ok?: boolean; schnell?: Schnell }>): Deps & { aufrufe: string[]; ev: any[] } => {
  const aufrufe: string[] = [], ev: any[] = [];
  return { aufrufe, ev,
    bauen: async (b) => { aufrufe.push(b); return { bauer: b, ok: o[b]?.ok ?? true, diff: o[b]?.diff ?? '' }; },
    schnell: async (k) => o[k.bauer]?.schnell ?? gruen,
    ledger: (e) => ev.push(e) };
};

test('Schutzzonen-Routing: Migrationen/Auth/Billing/Workflows/.env → Opus allein, sonst beide Flash-Bauer', () => {
  for (const d of ['db/migrations/001.sql', 'src/auth/login.ts', 'web/billing/x.ts', 'src/abrechnung/a.ts', 'x/payment/y.ts', '.github/workflows/ci.yml', '.env.local', 'app/.env.prod']) {
    assert.ok(inSchutzzone([d], {}), d); assert.deepEqual(bauerFuer([d], {}), [OPUS], d);
  }
  assert.deepEqual(bauerFuer(['src/a.ts', 'README.md'], {}), [FLASH, DEEPSEEK]);
  assert.deepEqual(bauerFuer(['src/auth.ts'], {}), [FLASH, DEEPSEEK], 'auth.ts ist keine auth-Ordner');
  assert.deepEqual(bauerFuer(['src/geheim/x.ts'], { BRIDGE_SCHUTZZONEN: 'src/geheim/**' }), [OPUS], 'konfigurierbar');
  assert.deepEqual(bauerFuer(['src/a.ts'], { BRIDGE_BESTOFN: 'aus' }), [FLASH]);
});

test('Sonnet-Klasse: kapazitaet.ts → sonnet, Schutzzone schlägt Sonnetzone, meliousLeer, BRIDGE_SONNETZONEN überschreibt', () => {
  assert.deepEqual(bauerFuer(['src/kapazitaet.ts'], {}), [SONNET], 'Kapazität ist Geld → Sonnet');
  assert.deepEqual(bauerFuer(['src/kontofuehrung.ts'], {}), [SONNET], '*konto* Glob');
  assert.deepEqual(bauerFuer(['src/a.ts'], {}, undefined, true), [SONNET], 'Melious leer → Sonnet');
  assert.deepEqual(bauerFuer(['src/a.ts'], {}, undefined, false), [FLASH, DEEPSEEK], 'ohne Sonnet-Grund wie bisher');
  assert.deepEqual(bauerFuer(['src/kapazitaet.ts'], { BRIDGE_SONNETKLASSE: 'aus' }), [FLASH, DEEPSEEK], 'Env-Abschaltung');
  // Schutzzone bleibt vorrangig: auth/kapazitaet.ts → Opus
  assert.deepEqual(bauerFuer(['src/auth/kapazitaet.ts'], {}), [OPUS]);
  assert.ok(inSonnetzone(['web/accounts.ts'], {}));
  assert.deepEqual(bauerFuer(['src/eigen/x.ts'], { BRIDGE_SONNETZONEN: 'src/eigen/**' }), [SONNET], 'überschreibbar');
  assert.deepEqual(bauerFuer(['src/kapazitaet.ts'], { BRIDGE_SONNETZONEN: 'src/eigen/**' }), [FLASH, DEEPSEEK], 'Überschreibung ersetzt die Vorgabe');
});

test('Tamper-Guard: entfernte Assertion, geänderte Zeile, Skip-Marker, gelöschte Testdatei; neue Tests sind erlaubt', () => {
  const t = 'test/a.test.ts';
  const kopf = `diff --git a/${t} b/${t}\n--- a/${t}\n+++ b/${t}\n`;
  assert.equal(tamperGruende(kopf + '-  assert.equal(a, 1);\n+  assert.equal(a, 2);').length, 1);
  assert.equal(tamperGruende(kopf + "+test.skip('x', () => {});").length, 1);
  assert.equal(tamperGruende(kopf + "+it.only('x', () => {});").length, 1);
  assert.equal(tamperGruende(`diff --git a/${t} b/${t}\ndeleted file mode 100644\n--- a/${t}\n+++ /dev/null\n-x`).length, 1);
  assert.deepEqual(tamperGruende(kopf + "+test('neu', () => assert.ok(1));"), []);
  assert.deepEqual(tamperGruende(`diff --git a/test/n.test.ts b/test/n.test.ts\nnew file mode 100644\n--- /dev/null\n+++ b/test/n.test.ts\n+x`), []);
  assert.deepEqual(tamperGruende(diffN(3).replace(/-/g, '-')), [], 'Quellcode ist frei');
});

test('Tamper-Guard: erweiterte Import-Zeile (auch mehrzeilig) ist kein Tamper, entfernte Assertion daneben schon', () => {
  const t = 'test/a.test.ts';
  const kopf = `diff --git a/${t} b/${t}\n--- a/${t}\n+++ b/${t}\n`;
  assert.deepEqual(tamperGruende(kopf + "-import { a } from '../src/a.ts';\n+import { a, b } from '../src/a.ts';\n+test('b', () => assert.ok(b()));"), []);
  assert.deepEqual(tamperGruende(kopf + "-import {\n-  a,\n-} from '../src/a.ts';\n+import {\n+  a,\n+  b,\n+} from '../src/a.ts';"), []);
  assert.equal(tamperGruende(kopf + "-import { a } from '../src/a.ts';\n+import { a, b } from '../src/a.ts';\n-  assert.equal(a(), 1);").length, 1);
});

test('Tamper-Guard: Import-Quelle entfernt/umgelenkt in bestehender Testdatei ist Tamper, Erweiterung derselben Quelle nicht', () => {
  const t = 'test/a.test.ts';
  const kopf = `diff --git a/${t} b/${t}\n--- a/${t}\n+++ b/${t}\n`;
  const r1 = tamperGruende(kopf + "-import assert from 'node:assert/strict';\n+import assert from './fake-assert.ts';");
  assert.equal(r1.length, 1); assert.match(r1[0], /Import-Quelle entfernt\/umgelenkt \(„node:assert\/strict“\)/);
  assert.equal(tamperGruende(kopf + "-import { a } from '../src/a.ts';\n-import '../src/setup.ts';").length, 2);
  assert.deepEqual(tamperGruende(kopf + "-import { a } from '../src/x.ts';\n+import { a, b } from '../src/x.ts';"), []);
  assert.deepEqual(tamperGruende(kopf + "-import {\n-  a,\n-} from '../src/x.ts';\n+import {\n+  a,\n+  b,\n+} from '../src/x.ts';"), []);
  assert.deepEqual(tamperGruende(`diff --git a/test/n.test.ts b/test/n.test.ts\nnew file mode 100644\n--- /dev/null\n+++ b/test/n.test.ts\n+import assert from './fake.ts';`), []);
});

test('Auswahl: Tamper disqualifiziert den kleineren Diff; sonst kleinerer Diff; Gleichstand → glm-flash; Repro/tsc/Tests rot raus', () => {
  const tamper = `diff --git a/test/a.test.ts b/test/a.test.ts\n--- a/test/a.test.ts\n+++ b/test/a.test.ts\n-assert.ok(1)\n`;
  const w1 = waehle([{ bauer: FLASH, ok: true, diff: tamper, schnell: gruen }, { bauer: DEEPSEEK, ok: true, diff: diffN(9), schnell: gruen }]);
  assert.equal(w1.sieger?.bauer, DEEPSEEK); assert.match(w1.abgelehnt[0].grund, /Tamper/);
  assert.equal(waehle([{ bauer: FLASH, ok: true, diff: diffN(9), schnell: gruen }, { bauer: DEEPSEEK, ok: true, diff: diffN(4), schnell: gruen }]).sieger?.bauer, DEEPSEEK);
  assert.equal(waehle([{ bauer: DEEPSEEK, ok: true, diff: diffN(4), schnell: gruen }, { bauer: FLASH, ok: true, diff: diffN(4), schnell: gruen }]).sieger?.bauer, FLASH);
  assert.equal(waehle([{ bauer: FLASH, ok: true, diff: diffN(2), schnell: { ...gruen, tsc: false } }, { bauer: DEEPSEEK, ok: true, diff: diffN(9), schnell: gruen }]).sieger?.bauer, DEEPSEEK);
  assert.equal(waehle([{ bauer: FLASH, ok: true, diff: diffN(2), schnell: { ...gruen, repro: false } }, { bauer: DEEPSEEK, ok: true, diff: diffN(9), schnell: { ...gruen, repro: true } }]).sieger?.bauer, DEEPSEEK);
  assert.equal(waehle([{ bauer: FLASH, ok: false, diff: '' }]).sieger, null);
});

test('Semaphor: höchstens 3 Prüfläufe gleichzeitig, der Rest wartet in der Schlange', async () => {
  const s = new Semaphor(3); let lauf = 0, spitze = 0;
  const frei: (() => void)[] = [];
  const ps = Array.from({ length: 7 }, () => s.run(async () => { spitze = Math.max(spitze, ++lauf); await new Promise<void>((r) => frei.push(r)); lauf--; }));
  await new Promise((r) => setImmediate(r));
  assert.equal(lauf, 3); assert.equal(s.wartend, 4);
  while (frei.length || lauf) { frei.shift()?.(); await new Promise((r) => setImmediate(r)); }
  await Promise.all(ps);
  assert.equal(spitze, 3); assert.equal(s.spitze, 3);
});

test('Rennen: beide bauen, Sieger gewählt, Verlierer 24 h aufgehoben, Ledger meldet bauer/sieger/abgelehnt', async () => {
  const d = mk({ [FLASH]: { diff: diffN(8) }, [DEEPSEEK]: { diff: diffN(3) } });
  const l = await rennen(d, A, { env: {} });
  assert.deepEqual(d.aufrufe.sort(), [DEEPSEEK, FLASH].sort());
  assert.equal(l.sieger?.bauer, DEEPSEEK); assert.equal(l.verlierer?.bauer, FLASH);
  assert.deepEqual(d.ev[0].bauer, [FLASH, DEEPSEEK]); assert.equal(d.ev[0].sieger, DEEPSEEK); assert.equal(d.ev[0].abgelehnt[0].bauer, FLASH);
});

test('Rennen: Schutzzone → nur Opus; beide scheitern → derselbe erste Bauer mit beiden Fehlerlogs, dann Sonnet', async () => {
  const d1 = mk({ [OPUS]: { diff: diffN(2, 'db/migrations/1.sql') } });
  const l1 = await rennen(d1, { ...A, dateien: ['db/migrations/1.sql'] }, { env: {} });
  assert.deepEqual(d1.aufrufe, [OPUS]); assert.equal(l1.sieger?.bauer, OPUS);
  const logs: string[][] = [];
  const d2 = mk({ [FLASH]: { diff: diffN(2), schnell: { ...gruen, tsc: false, log: 'TSFEHLER' } }, [DEEPSEEK]: { diff: diffN(2), schnell: { ...gruen, lint: false, log: 'LINTFEHLER' } } });
  const b = d2.bauen; d2.bauen = (x, a, o) => { if (o?.fehlerlogs) logs.push(o.fehlerlogs); return b(x, a, o); };
  const l2 = await rennen(d2, A, { env: {} });
  assert.equal(l2.sieger, null); assert.equal(l2.weiter, 'sonnet'); assert.deepEqual(d2.aufrufe, [FLASH, DEEPSEEK, FLASH]); assert.ok(!d2.aufrufe.includes(GLM));
  const text = logs[0].join('\n'); assert.match(text, /TSFEHLER/); assert.match(text, /LINTFEHLER/);
  assert.deepEqual(d2.ev[0].bauer, [FLASH, DEEPSEEK, FLASH]);
});

test('Ablehnung: erst Verlierer-Diff (24 h), danach Fixrunden, nach 2 abgelehnten Fixrunden → sonnet', async () => {
  const d = mk({ [FLASH]: { diff: diffN(8) }, [DEEPSEEK]: { diff: diffN(3) } });
  const l = await rennen(d, A, { env: {} });
  const t0 = l.verlierer!.at;
  const f1 = nachAblehnung(l, 'Review: Mangel 1', t0 + 1000);
  assert.deepEqual([f1.art, (f1 as any).bauer], ['verlierer', FLASH]);
  assert.equal(nachAblehnung(l, 'm2', t0 + 2000).art, 'fix');
  assert.equal(nachAblehnung(l, 'm3', t0 + 3000).art, 'fix');
  const e = nachAblehnung(l, 'm4', t0 + 4000);
  assert.equal(e.art, 'sonnet'); assert.equal((e as any).fehlerlogs.length, 4);
  // nach Ablauf der 24 h kein Verlierer-Retry
  const l2 = await rennen(d, A, { env: {} });
  assert.equal(nachAblehnung(l2, 'x', l2.verlierer!.at + VERLIERER_MS + 1).art, 'fix');
});

test('Abschaltregel: Zweitbauer < 15 % nach 30 Läufen → aus; Env BRIDGE_BESTOFN=aus', () => {
  const s = neueStatistik();
  for (let i = 0; i < 29; i++) zaehle(s, FLASH);
  assert.equal(abgeschaltet(s, {}), false, 'erst ab 30 Läufen');
  zaehle(s, FLASH);
  assert.equal(abgeschaltet(s, {}), true);
  const ok = neueStatistik(); for (let i = 0; i < 30; i++) zaehle(ok, i < 5 ? DEEPSEEK : FLASH);
  assert.equal(abgeschaltet(ok, {}), false, '5/30 ≥ 15 %');
  assert.equal(abgeschaltet(neueStatistik(), { BRIDGE_BESTOFN: 'aus' }), true); assert.equal(bestofnAn({ BRIDGE_BESTOFN: 'aus' }), false);
  assert.deepEqual(bauerFuer(['a.ts'], {}, s), [FLASH], 'abgeschaltet → nur glm-flash');
});

// ---- Zeitdeckel (wb21/i-f-deckel): ein zu großer Punkt ist ein Signal an den Plan, keine Eskalation --------------------------------
test('Deckel-Vorgabe: BRIDGE_BAUER_DECKEL_S, ungültig/leer/0 → 600 s', () => {
  assert.equal(bauerDeckelMs({}), 600_000);
  assert.equal(bauerDeckelMs({ BRIDGE_BAUER_DECKEL_S: '30' }), 30_000);
  assert.equal(bauerDeckelMs({ BRIDGE_BAUER_DECKEL_S: '0.05' }), 50);
  for (const x of ['', '  ', 'x', '0', '-5']) assert.equal(bauerDeckelMs({ BRIDGE_BAUER_DECKEL_S: x }), 600_000, JSON.stringify(x));
});

const mkLahm = (b: Record<string, { ms: number; n: number }>): Deps & { aufrufe: string[]; ev: any[] } => {
  const aufrufe: string[] = [], ev: any[] = [];
  return { aufrufe, ev,
    bauen: async (x) => { aufrufe.push(x); await new Promise((r) => setTimeout(r, b[x]?.ms ?? 400)); return { bauer: x, ok: true, diff: diffN(b[x]?.n ?? 3) }; },
    schnell: async () => gruen,
    ledger: (e) => ev.push(e) };
};
test('Zeitdeckel: beide Bauer zu langsam → zerlegen: true, kein GLM-Aufruf', async () => {
  const d = mkLahm({ [FLASH]: { ms: 400, n: 3 }, [DEEPSEEK]: { ms: 400, n: 2 } });
  const l = await rennen(d, A, { env: { BRIDGE_BAUER_DECKEL_S: '0.05' } });
  assert.equal(l.zerlegen, true); assert.equal(l.sieger, null);
  assert.equal(d.aufrufe.includes(GLM), false, 'keine Eskalation an glm-5.3');
  assert.deepEqual(d.ev[0].bauer, [FLASH, DEEPSEEK]);
});
test('Zeitdeckel: nur ein Bauer zu langsam → der schnelle siegt (ohne Deckel gewänne der kleinere Diff), kein zerlegen', async () => {
  const d = mkLahm({ [FLASH]: { ms: 0, n: 6 }, [DEEPSEEK]: { ms: 400, n: 2 } });
  const l = await rennen(d, A, { env: { BRIDGE_BAUER_DECKEL_S: '0.05' } });
  assert.equal(l.sieger?.bauer, FLASH); assert.equal(!!l.zerlegen, false);
  assert.equal(d.aufrufe.includes(GLM), false);
  assert.equal(diffGroesse(l.sieger!.diff), 6);
});

// ---- P7: Prüflauf ohne Shell, eigene Prozessgruppe ----
test('P7: Dateiname mit $(…) wird nicht von einer Shell ausgeführt', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'p7-'));
  await pruefLauf(cwd, 'node', ['--test', 'x$(touch PWNED).test.ts']);
  assert.equal(existsSync(join(cwd, 'PWNED')), false);
});
test('P7: Timeout tötet die ganze Gruppe (Enkel sleep 600)', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'p7-'));
  const r = await pruefLauf(cwd, 'sh', ['-c', 'sleep 600 & echo $$ > pgid; echo $! > enkel; wait'], { timeoutMs: 2000 });
  assert.equal(r.ok, false);
  const enkel = Number(readFileSync(join(cwd, 'enkel'), 'utf8'));
  // 'läuft nicht' = weg oder Zombie; pruefLauf kehrt erst zurück, wenn kein Gruppenmitglied mehr läuft (keine Wartezeit hier).
  assert.equal(laeuft(enkel), false, 'Enkel läuft nicht mehr');
  assert.equal(await gruppeWeg(Number(readFileSync(join(cwd, 'pgid'), 'utf8')), 0), true, 'Gruppe weg');
});
test('P7: Kill einer toten Gruppe wirft nicht', () => {
  assert.doesNotThrow(() => groupKill(2 ** 22 - 1));
});
test('P7: Kind endet mit 0, Enkel hält die Pipe → Rückkehr schnell, ok, Gruppe tot', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'p7-'));
  const t0 = Date.now();
  const r = await pruefLauf(cwd, 'sh', ['-c', 'sleep 600 & echo $! > enkel; echo $$ > pgid; exit 0'], { timeoutMs: 30000 });
  assert.ok(Date.now() - t0 < 3000, `dauerte ${Date.now() - t0} ms`);
  assert.equal(r.ok, true);
  assert.equal(laeuft(Number(readFileSync(join(cwd, 'enkel'), 'utf8'))), false, 'Enkel läuft nicht mehr');
});

// ---- P8: Deckel bricht den Bauer ab (Signal), statt ihn im Hintergrund auslaufen zu lassen -----------------------------------------
test('P8: Deckel → Signal des Bauers abgebrochen, rennen wartet auf sein Ende', async () => {
  const signale: AbortSignal[] = []; let beendet = false;
  const d: Deps = {
    bauen: (x, _a, o) => new Promise((res) => { signale.push(o!.signal!); setTimeout(() => res({ bauer: x, ok: false, diff: '', log: 'spät' }), 600); o!.signal?.addEventListener('abort', () => setTimeout(() => { beendet = true; res({ bauer: x, ok: false, diff: '', log: 'abgebrochen' }); }, 20)); }),
    schnell: async () => gruen };
  const l = await rennen(d, A, { env: { BRIDGE_BAUER_DECKEL_S: '0.05' } });
  assert.equal(l.zerlegen, true);
  assert.ok(signale.length >= 2 && signale.every((s) => s.aborted), 'jedes Signal nach dem Deckel abgebrochen');
  assert.equal(beendet, true, 'Rückkehr erst, nachdem der Bauer den Abbruch bestätigt hat');
});

// ---- L3a (Strangprüfung): Retry-Kette nach Council — kein glm-5.3, gleicher Bauer mit Fehlerlogs, dann Sonnet ----------------------
const rot = (log: string): Schnell => ({ ...gruen, tsc: false, log });
/** Bauer mit Aufrufliste; `antworten[bauer]` liefert je Aufruf (0, 1, …) Diff + Schnell-Ergebnis; Schnell wird über die Diff-Marke gefunden. */
const mkKette = (antworten: Record<string, { diff: string; schnell: Schnell }[]>) => {
  const aufrufe: { bauer: string; fehlerlogs?: string[] }[] = [], ev: any[] = [], zaehler: Record<string, number> = {};
  const marke = new Map<string, Schnell>();
  const d: Deps = {
    bauen: async (b, _a, o) => {
      aufrufe.push({ bauer: b, fehlerlogs: o?.fehlerlogs });
      const n = zaehler[b] = (zaehler[b] ?? -1) + 1;
      const x = antworten[b]?.[n] ?? { diff: '', schnell: gruen };
      const diff = x.diff + `\n# ${b}#${n}`; marke.set(diff, x.schnell);
      return { bauer: b, ok: true, diff };
    },
    schnell: async (k) => marke.get(k.diff) ?? gruen,
    ledger: (e) => ev.push(e) };
  return { d, aufrufe, ev };
};

test('L3a: beide rot → nächster bauen-Aufruf ist derselbe erste Bauer mit beiden roten Logs, glm-5.3 nie', async () => {
  const k = mkKette({ [FLASH]: [{ diff: diffN(2), schnell: rot('TSFEHLER') }, { diff: diffN(3), schnell: gruen }], [DEEPSEEK]: [{ diff: diffN(2), schnell: rot('LINTFEHLER') }] });
  const l = await rennen(k.d, A, { env: {} });
  const dritter = k.aufrufe[2];
  assert.equal(k.aufrufe.length, 3);
  assert.equal(dritter.bauer, FLASH);
  const text = (dritter.fehlerlogs ?? []).join('\n'); assert.match(text, /TSFEHLER/); assert.match(text, /LINTFEHLER/);
  assert.equal(k.aufrufe.some((x) => x.bauer === GLM), false, 'glm-5.3 wird nie gerufen');
  assert.equal(l.sieger?.bauer, FLASH, 'grüner Retry gewinnt normal'); assert.equal(l.weiter, undefined);
  assert.deepEqual(k.ev[0].bauer, [FLASH, DEEPSEEK, FLASH]); assert.equal(k.ev[0].sieger, FLASH);
});

test('L3a: Retry auch rot → weiter = sonnet, sieger null, kein bauen(sonnet), kein glm-5.3', async () => {
  const k = mkKette({ [FLASH]: [{ diff: diffN(2), schnell: rot('A') }, { diff: diffN(2), schnell: rot('B') }], [DEEPSEEK]: [{ diff: diffN(2), schnell: rot('C') }] });
  const l = await rennen(k.d, A, { env: {} });
  assert.equal(l.weiter, 'sonnet'); assert.equal(l.sieger, null);
  assert.deepEqual(k.aufrufe.map((x) => x.bauer), [FLASH, DEEPSEEK, FLASH]);
  assert.equal(k.aufrufe.some((x) => x.bauer === SONNET || x.bauer === GLM), false);
  assert.deepEqual(k.ev[0].bauer, [FLASH, DEEPSEEK, FLASH]); assert.equal(k.ev[0].sieger, null);
});

test('L3a: Deckel bei beiden Bauern → zerlegen, kein Retry, weiter ungesetzt', async () => {
  const d = mk({});
  d.bauen = (b, _a, o) => { d.aufrufe.push(b); return new Promise((_, rej) => o?.signal?.addEventListener('abort', () => rej(new Error('abgebrochen')))); };
  const l = await rennen(d, A, { env: { BRIDGE_BAUER_DECKEL_S: '1' } });
  assert.equal(l.zerlegen, true); assert.equal(l.weiter, undefined); assert.equal(l.sieger, null);
  assert.equal(d.aufrufe.length, 2, 'kein Retry');
});

test('L3a: nachAblehnung nach 2 abgelehnten Fixrunden → { art: sonnet, fehlerlogs }', async () => {
  const d = mk({ [FLASH]: { diff: diffN(8) }, [DEEPSEEK]: { diff: diffN(3) } });
  const l = await rennen(d, A, { env: {} });
  const t0 = l.verlierer!.at;
  nachAblehnung(l, 'm1', t0 + 1000); nachAblehnung(l, 'm2', t0 + 2000); nachAblehnung(l, 'm3', t0 + 3000);
  const e = nachAblehnung(l, 'm4', t0 + 4000);
  assert.equal(e.art, 'sonnet'); assert.equal((e as any).bauer, undefined); assert.equal((e as any).fehlerlogs.length, 4);
});

// ---- Prüfumgebung: vom Modell geschriebene Tests sehen keine Geheimnisse und nicht das echte HOME ----
test('pruefLauf: Test sieht weder Token noch SSH_AUTH_SOCK noch das echte HOME; Wegwerf-HOME danach weg', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pe-'));
  writeFileSync(join(cwd, 'x.test.js'), `require('node:fs').writeFileSync('out.json', JSON.stringify({ t: process.env.WERKBANK_INTERNAL_TOKEN ?? null, h: process.env.HOME ?? null, s: process.env.SSH_AUTH_SOCK ?? null, g: process.env.GITHUB_TOKEN ?? null }));\n`);
  const alt = { t: process.env.WERKBANK_INTERNAL_TOKEN, h: process.env.HOME, s: process.env.SSH_AUTH_SOCK, g: process.env.GITHUB_TOKEN };
  Object.assign(process.env, { WERKBANK_INTERNAL_TOKEN: 'sentinel-token-1', HOME: '/sentinel/echtes-home', SSH_AUTH_SOCK: '/sentinel/agent.sock', GITHUB_TOKEN: 'sentinel-gh' });
  try {
    const r = await pruefLauf(cwd, 'env', ['-u', 'NODE_TEST_CONTEXT', 'node', '--test', 'x.test.js']);
    assert.equal(r.ok, true, r.log);
    const o = JSON.parse(readFileSync(join(cwd, 'out.json'), 'utf8'));
    assert.equal(o.t, null); assert.equal(o.s, null); assert.equal(o.g, null);
    assert.notEqual(o.h, '/sentinel/echtes-home');
    assert.match(o.h, /werkbank-pruef-/);
    assert.equal(existsSync(o.h), false, 'Wegwerf-HOME muss nach dem Lauf gelöscht sein');
  } finally {
    for (const [k, v] of [['WERKBANK_INTERNAL_TOKEN', alt.t], ['HOME', alt.h], ['SSH_AUTH_SOCK', alt.s], ['GITHUB_TOKEN', alt.g]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
