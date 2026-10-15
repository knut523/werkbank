// Planer–Umsetzer (Plan 183, Council 180): Auftrag (P1), Fallstricke (P2), Bericht + Zitatprüfung (P3), Prüfregel (P4), Pipeline
// mit gespieltem Melious und gespieltem jcode. Ohne Datenbank — der Schattenbetrieb hat eigene Tests (schatten.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  checkAuftrag, jsonAus, diffAuszug, planeAuftrag, passendeFallstricke, FALLSTRICKE_START, parseBericht, pruefeZitat, pruefeZitate,
  pruefpflichtig, planerPruefung, urteilAbleiten, planerReview, jcodeUsage, nachbarRepos, standardRef, type Auftrag, type ChatFn, type JcodeFn,
} from '../server/planer.ts';

const F = (id: string, s = 'hoch') => ({ id, frage: `Frage ${id}`, wo_suchen: 'src/', schwere_falls_ja: s });
const AUFTRAG: any = { ziel: 'Review #343', kontext: 'Nachbar olaf-tariff-app', pruef_fragen: [F('F1'), F('F2', 'mittel'), F('F3', 'niedrig')], grenzen: 'nur lesen', fertig_wenn: 'alle Fragen beantwortet' };
const antwort = (content: string, energy = 12) => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 100 } }, billing_cost: { energy } });

test('P1: checkAuftrag nimmt einen gültigen Auftrag und normalisiert Listen zu Text', () => {
  const r = checkAuftrag({ ...AUFTRAG, grenzen: ['nur lesen', 'kein npm'] });
  assert.equal(r.ok, true);
  assert.equal((r as any).a.grenzen, 'nur lesen; kein npm');
});

test('P1: checkAuftrag lehnt Fehlendes, zu wenige/zu viele Fragen, doppelte ids, falsche Schwere und Überlänge ab', () => {
  const nein = (x: any, m: RegExp) => { const r = checkAuftrag(x); assert.equal(r.ok, false); assert.match((r as any).why, m); };
  nein(null, /kein JSON/);
  nein({ ...AUFTRAG, ziel: '' }, /ziel/);
  nein({ ...AUFTRAG, pruef_fragen: [F('F1'), F('F2')] }, /3–8/);
  nein({ ...AUFTRAG, pruef_fragen: Array.from({ length: 9 }, (_, i) => F(`F${i}`)) }, /3–8/);
  nein({ ...AUFTRAG, pruef_fragen: [F('F1'), F('F1'), F('F2')] }, /doppelte/);
  nein({ ...AUFTRAG, pruef_fragen: [F('F1'), F('B1'), F('F2')] }, /ungültiger/);
  nein({ ...AUFTRAG, pruef_fragen: [F('F1'), F('F2'), F('F3', 'kritisch')] }, /schwere/);
  nein({ ...AUFTRAG, pruef_fragen: [F('F1'), F('F2'), { ...F('F3'), wo_suchen: '' }] }, /wo_suchen/);
  nein({ ...AUFTRAG, kontext: 'x'.repeat(2500) }, /zu lang/);
});

test('jsonAus: letzter json-Block gewinnt, sonst äußerstes Objekt', () => {
  assert.deepEqual(jsonAus('a ```json\n{"a":1}\n``` b ```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(jsonAus('Hier: {"x": {"y": 1}} fertig'), { x: { y: 1 } });
  assert.equal(jsonAus('nichts'), null);
});

test('P1/Challenge 2: diffAuszug ist deterministisch, kürzt je Datei, lässt Lock-Dateien weg und sagt das', () => {
  const blk = (f: string, n: number) => `diff --git a/${f} b/${f}\n+${'x'.repeat(n)}\n`;
  const d = blk('src/a.ts', 5000) + blk('package-lock.json', 100) + blk('src/b.ts', 50);
  const a = diffAuszug(d, 12_000, 3000);
  assert.equal(a, diffAuszug(d, 12_000, 3000));
  assert.match(a, /\[gekürzt: src\/a\.ts\]/);
  assert.match(a, /\[nicht im Ausschnitt: package-lock\.json\]/);
  assert.ok(a.includes('diff --git a/src/b.ts'));
  const voll = diffAuszug(blk('a', 20_000) + blk('b', 5000) + blk('c', 10), 4000, 3000);
  assert.match(voll, /\[gekürzt: a, b\]/);
  assert.match(voll, /\[nicht im Ausschnitt: c\]/);
});

test('P1: planeAuftrag schickt echten Diff-Ausschnitt, Fallstricke und Nachbarn an glm-5.3 und liefert den geprüften Auftrag', async () => {
  const gesehen: any[] = [];
  const chat: ChatFn = async (b) => { gesehen.push(b); return antwort('```json\n' + JSON.stringify(AUFTRAG) + '\n```'); };
  const r = await planeAuftrag(chat, 'review', { ziel: 'Z', diffStat: ' 1 file', diffAuszug: 'diff --git a/x b/x\n+meterNumber', fallstricke: ['Zählpunkt 31/33'], nachbarn: [{ name: 'olaf-tariff-app', dir: '/w/t', ref: 'origin/develop', fetchAlterH: 3 }] });
  assert.equal(r.ok, true);
  assert.equal(gesehen[0].model, 'glm-5.3');
  assert.ok(gesehen[0].max_tokens >= 16_000, 'GLM braucht Denkbudget');
  const u = gesehen[0].messages[1].content;
  for (const s of ['+meterNumber', 'Zählpunkt 31/33', 'olaf-tariff-app: /w/t (Ref origin/develop, letzter Fetch vor 3 h)']) assert.ok(u.includes(s), s);
  assert.equal(r.messung.aufrufe, 1);
  assert.equal(r.messung.energie, 12);
  assert.equal(r.messung.usage.cacheRead, 100);
});

test('P1/Challenge 4: ungültig → genau ein zweiter Versuch mit Fehlermeldung, dann Fehler; leere Antwort ist ungültig', async () => {
  const gesehen: any[] = [];
  let n = 0;
  const chat: ChatFn = async (b) => { gesehen.push(b); return antwort(n++ === 0 ? '' : JSON.stringify(AUFTRAG)); };
  const r = await planeAuftrag(chat, 'review', { ziel: 'Z', diffStat: '', diffAuszug: '' });
  assert.equal(r.ok, true);
  assert.equal(r.messung.aufrufe, 2);
  assert.match(gesehen[1].messages.at(-1).content, /ungültig: leere Antwort/);
  const immer: ChatFn = async () => antwort('{"ziel":"x"}');
  const r2 = await planeAuftrag(immer, 'review', { ziel: 'Z', diffStat: '', diffAuszug: '' });
  assert.equal(r2.ok, false);
  assert.match(r2.error!, /Auftrag ungültig/);
  assert.equal(r2.messung.aufrufe, 2);
  const weg: ChatFn = async () => null;
  const r3 = await planeAuftrag(weg, 'review', { ziel: 'Z', diffStat: '', diffAuszug: '' });
  assert.match(r3.error!, /antwortet nicht/);
});

test('P2: Fallstricke — Repo zuerst, dann Stichwort im Diff; höchstens 5, je ≤ 300 Zeichen', () => {
  assert.equal(passendeFallstricke(FALLSTRICKE_START, 'WirStrom1/olaf-admin', '').length, 1);
  assert.equal(passendeFallstricke(FALLSTRICKE_START, 'WirStrom1/olaf-docs', '').length, 0);
  assert.equal(passendeFallstricke(FALLSTRICKE_START, 'WirStrom1/olaf-docs', '+ const m = p.meterNumber').length, 1);
  const viele = Array.from({ length: 8 }, (_, i) => ({ text: `T${i} ` + 'y'.repeat(400), repos: ['r'], stichworte: [] }));
  const r = passendeFallstricke(viele, 'o/r', '');
  assert.equal(r.length, 5);
  assert.ok(r.every((t) => t.length <= 300));
  assert.ok(FALLSTRICKE_START[0].text.includes('31') && FALLSTRICKE_START[0].text.includes('33'));
});

test('P3: parseBericht — Schweigen ist unklar, Status normalisiert, Befunde mit Kennung', () => {
  const t = 'Text\n```json\n{"empfehlung":"request-changes","antworten":[{"id":"F1","status":"Befund","beleg":"a.ts:2","zitat":"x"},{"id":"F3","status":"kein befund","beleg":"a.ts:1","zitat":"y"}],"befunde":[{"titel":"T","schwere":"hoch","beleg":"a.ts:2","zitat":"x"}]}\n```';
  const b = parseBericht(t, AUFTRAG);
  assert.equal(b.empfehlung, 'request-changes');
  assert.deepEqual(b.antworten.map((x) => [x.id, x.status]), [['F1', 'befund'], ['F2', 'unklar'], ['F3', 'kein_befund']]);
  assert.equal(b.antworten[1].text, 'keine Antwort');
  assert.equal(b.befunde[0].id, 'B1');
  const leer = parseBericht('nur Prosa', AUFTRAG);
  assert.equal(leer.fehler, 'kein JSON-Block im Bericht');
  assert.ok(leer.antworten.every((x) => x.status === 'unklar'));
});

// Kleines Repo + Nachbar-Repo mit einer Datei nur im origin-Stand (git show).
const TMP = mkdtempSync(join(tmpdir(), 'planer-'));
const PR = join(TMP, 'pr'), NB = join(TMP, 'olaf-tariff-app');
const g = (dir: string, ...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
mkdirSync(join(PR, 'src'), { recursive: true });
writeFileSync(join(PR, 'src', 'route.ts'), 'a\nb\nconst ok = length(p.nr) = 33;\nd\ne\nf\ng\n');
mkdirSync(join(NB, 'src'), { recursive: true });
execFileSync('git', ['init', '-q', NB]);
writeFileSync(join(NB, 'src', 'hook.ts'), 'x\nconst v = raw.slice(0, 31);\n');
g(NB, 'add', '-A'); g(NB, 'commit', '-qm', 'i'); g(NB, 'update-ref', 'refs/remotes/origin/develop', 'HEAD');
writeFileSync(join(NB, 'src', 'nur-remote.ts'), 'tmp');
g(NB, 'add', '-A'); g(NB, 'commit', '-qm', 'r'); g(NB, 'update-ref', 'refs/remotes/origin/develop', 'HEAD');
writeFileSync(join(NB, 'src', 'spaeter.ts'), 'zeile eins\nconst spaet = 1;\n');
g(NB, 'add', '-A'); g(NB, 'commit', '-qm', 's'); g(NB, 'update-ref', 'refs/remotes/origin/develop', 'HEAD'); g(NB, 'reset', '-q', '--hard', 'HEAD~2');
const W = [{ name: null, dir: PR }, { name: 'olaf-tariff-app', dir: NB, ref: 'origin/develop' }];

test('P3: Zitatprüfung — Datei:Zeile ± 3, Leerraum egal, Auslassung „…“, Nachbar-Repo per Präfix und per git show', () => {
  assert.equal(pruefeZitat('src/route.ts:3', 'const ok =   length(p.nr) = 33;', W).status, 'ok');
  assert.equal(pruefeZitat('`src/route.ts:6`', 'length(p.nr) = 33', W).status, 'ok', '± 3 Zeilen');
  assert.equal(pruefeZitat('src/route.ts:3-4', 'const ok = length … = 33;', W).status, 'ok');
  assert.equal(pruefeZitat('src/route.ts:3', 'length(p.nr) = 31', W).status, 'nicht_gefunden');
  assert.equal(pruefeZitat('src/route.ts:20', 'const ok = length(p.nr)', W).status, 'nicht_gefunden', 'zu weit weg');
  assert.equal(pruefeZitat('olaf-tariff-app/src/hook.ts:2', 'raw.slice(0, 31)', W).status, 'ok');
  assert.equal(pruefeZitat('olaf-tariff-app/src/spaeter.ts:2', 'const spaet = 1;', W).status, 'ok', 'nur im origin-Stand → git show');
  assert.equal(pruefeZitat('', 'x', W).status, 'ohne_beleg');
  assert.equal(pruefeZitat('src/route.ts:3', '', W).status, 'ohne_beleg');
  assert.equal(pruefeZitat('../../etc/passwd:1', 'root:x:0:0:root', W).status, 'nicht_gefunden', 'nie außerhalb der Wurzel');
  assert.equal(standardRef(NB), 'origin/develop');
});

test('Nachbar-Repos: eigenes Repo ausgelassen, Ref und Fetch-Alter gemeldet', () => {
  const n = nachbarRepos('WirStrom1/olaf-admin', { WERKBANK_NACHBAR_REPOS: `olaf-tariff-app=${NB},olaf-admin=${PR},weg=/gibt/es/nicht`, HOME: TMP } as any);
  assert.deepEqual(n.map((x) => [x.name, x.ref]), [['olaf-tariff-app', 'origin/develop']]);
});

const bericht = (x: any) => pruefeZitate(parseBericht('```json\n' + JSON.stringify(x) + '\n```', AUFTRAG), W);
const A = checkAuftrag(AUFTRAG) as any as { a: Auftrag };

test('P4: prüfpflichtig = Befund hoch/mittel + kein_befund zu Hoch-Fragen + Befunde hoch/mittel', () => {
  const b = bericht({ antworten: [{ id: 'F1', status: 'kein_befund', beleg: 'src/route.ts:3', zitat: 'const ok = length(p.nr) = 33;' }, { id: 'F2', status: 'befund', beleg: 'src/route.ts:3', zitat: 'x' }, { id: 'F3', status: 'befund', beleg: 'a:1', zitat: 'y' }],
    befunde: [{ titel: 'H', schwere: 'hoch', beleg: 'src/route.ts:3', zitat: 'const ok = length(p.nr) = 33;' }, { titel: 'N', schwere: 'niedrig', beleg: 'a:1', zitat: 'z' }] });
  assert.deepEqual(pruefpflichtig(A.a, b).map((p) => p.key), ['F1', 'F2', 'B1']);
});

test('P4: urteilAbleiten — hoch bestätigt → request-changes; unklar/Zitat fehlt/strittig sperren approve; verworfen zählt nicht', () => {
  const b = bericht({ antworten: [{ id: 'F1', status: 'befund', beleg: 'src/route.ts:3', zitat: 'const ok = length(p.nr) = 33;' }, { id: 'F2', status: 'kein_befund', beleg: 'src/route.ts:3', zitat: 'const ok = length(p.nr) = 33;' }, { id: 'F3', status: 'kein_befund', beleg: 'src/route.ts:3', zitat: 'const ok = length(p.nr) = 33;' }] });
  const p = pruefpflichtig(A.a, b);
  assert.equal(urteilAbleiten(A.a, b, p.map((x) => ({ ...x, urteil: 'bestaetigt' }))).empfehlung, 'request-changes');
  const verworfen = urteilAbleiten(A.a, b, p.map((x) => ({ ...x, urteil: 'verworfen' })));
  assert.equal(verworfen.empfehlung, 'approve');
  assert.deepEqual(verworfen.blind, ['F2: kein_befund (Frage nicht „hoch“) — nicht nachgeprüft', 'F3: kein_befund (Frage nicht „hoch“) — nicht nachgeprüft']);
  // Zitat steht nicht da: auch ein „bestätigt“ des Planers hilft nicht → strittig, kein approve, kein request-changes
  const falsch = bericht({ antworten: [{ id: 'F1', status: 'befund', beleg: 'src/route.ts:3', zitat: 'erfundene Zeile im Code' }, { id: 'F2', status: 'kein_befund', beleg: 'src/route.ts:3', zitat: 'const ok = length(p.nr) = 33;' }, { id: 'F3', status: 'kein_befund', beleg: 'src/route.ts:3', zitat: 'const ok = length(p.nr) = 33;' }] });
  const u = urteilAbleiten(A.a, falsch, pruefpflichtig(A.a, falsch).map((x) => ({ ...x, urteil: 'bestaetigt' })));
  assert.equal(u.empfehlung, 'comment');
  assert.match(u.strittig[0], /F1: Zitat nicht an der Stelle/);
  // unklar (Schweigen) sperrt approve
  const still = bericht({ antworten: [{ id: 'F1', status: 'kein_befund', beleg: 'src/route.ts:3', zitat: 'const ok = length(p.nr) = 33;' }] });
  const s = urteilAbleiten(A.a, still, pruefpflichtig(A.a, still).map((x) => ({ ...x, urteil: 'bestaetigt' })));
  assert.equal(s.empfehlung, 'comment');
  assert.deepEqual(s.strittig, ['F2: unklar — keine Antwort', 'F3: unklar — keine Antwort']);
  const str = urteilAbleiten(A.a, b, p.map((x) => ({ ...x, urteil: 'strittig', grund: 'unsicher' })));
  assert.equal(str.empfehlung, 'comment');
  assert.match(str.strittig[0], /Planer strittig — unsicher/);
});

test('P4: planerPruefung — fehlendes Urteil ist strittig; nichts zu prüfen → kein Aufruf', async () => {
  let n = 0;
  const chat: ChatFn = async () => { n++; return antwort('{"urteile":[{"key":"F1","urteil":"bestätigt","grund":"passt"}]}'); };
  const b = bericht({ antworten: [{ id: 'F1', status: 'befund', beleg: 'src/route.ts:3', zitat: 'const ok = length(p.nr) = 33;' }, { id: 'F2', status: 'befund', beleg: 'src/route.ts:3', zitat: 'const ok = length(p.nr) = 33;' }] });
  const r = await planerPruefung(chat, A.a, pruefpflichtig(A.a, b));
  assert.deepEqual(r.punkte.map((p) => [p.key, p.urteil]), [['F1', 'bestaetigt'], ['F2', 'strittig']]);
  const leer = await planerPruefung(chat, A.a, []);
  assert.equal(n, 1); assert.equal(leer.messung.aufrufe, 0);
});

test('jcodeUsage: Cache herausgerechnet, Aufrufe gezählt, Python-Dict-Strings gelesen', () => {
  const r = jcodeUsage({ messages: [{ token_usage: { input_tokens: 100, cache_read_input_tokens: 90, output_tokens: 5 } }, { token_usage: "{'input_tokens': 50, 'cache_read_input_tokens': None, 'output_tokens': 2}" }, {}] });
  assert.deepEqual(r, { usage: { input: 60, output: 7, cacheRead: 90, cacheWrite: 0 }, aufrufe: 2 });
});

const FAKT = { 'glm-5.3-flash': { in: 1000, out: 4000, cache: 200 } };
test('Pipeline: Auftrag → Worker → Zitate → Prüfung → Urteil, je Stufe gemessen (P7)', async () => {
  const calls: string[] = [];
  const chat: ChatFn = async (b: any) => {
    calls.push(b.messages[0].content.slice(0, 20));
    return calls.length === 1 ? antwort(JSON.stringify(AUFTRAG), 40) : antwort('{"urteile":[{"key":"F1","urteil":"bestaetigt","grund":"Zitat zeigt 33"}]}', 30);
  };
  let prompt = '';
  let diffDatei = '';
  const jcode: JcodeFn = async (o) => { prompt = o.prompt; assert.equal(o.model, 'glm-5.3-flash'); assert.equal(o.tools, 'read,agentgrep', 'keine Shell');
    diffDatei = /Basis liegt in `([^`]+)`/.exec(o.prompt)![1];
    assert.notEqual(o.cwd, PR, 'Arbeitsordner nie der PR-Stand'); assert.equal(join(o.cwd, 'pr.diff'), diffDatei);
    assert.ok(o.prompt.includes(`PR-Stand liegt in \`${PR}\``)); assert.match(readFileSync(diffDatei, 'utf8'), /^Basis: origin\/develop\n\n1 file\n\ndiff --git/);
    return { code: 0, text: 'Befund …\n```json\n' + JSON.stringify({ empfehlung: 'approve', antworten: [{ id: 'F1', status: 'befund', beleg: 'src/route.ts:3', zitat: 'length(p.nr) = 33' }, { id: 'F2', status: 'kein_befund', beleg: 'olaf-tariff-app/src/hook.ts:2', zitat: 'raw.slice(0, 31)' }, { id: 'F3', status: 'kein_befund', beleg: 'src/route.ts:1', zitat: 'a\nb' }] }) + '\n```', usage: { input: 1000, output: 1000, cacheRead: 9000, cacheWrite: 0 }, aufrufe: 7, ms: 5000, stderr: '' }; };
  const r = await planerReview({ chat, jcode, key: 'sk-mel-test', faktoren: FAKT }, { dir: PR, basis: 'origin/develop', diff: 'diff --git a/src/route.ts b/src/route.ts\n+x', diffStat: '1 file', ziel: 'Review', nachbarn: [{ name: 'olaf-tariff-app', dir: NB, ref: 'origin/develop', fetchAlterH: null }] });
  assert.equal(r.status, 'fertig');
  assert.equal(r.empfehlung, 'request-changes');
  assert.equal(r.workerEmpfehlung, 'approve', 'Worker allein hätte approve gesagt — genau die Abweichung, die der Pilot misst');
  assert.ok(prompt.includes('"F1"') && prompt.includes('Schweigen gilt als unklar'));
  assert.ok(prompt.includes(`olaf-tariff-app = ${NB}`), 'Nachbar-Repos im Worker-Auftrag');
  assert.equal(existsSync(diffDatei), false, 'Diff-Datei danach entfernt');
  assert.deepEqual(r.stufen.map((s) => [s.stufe, s.aufrufe]), [['plan', 1], ['worker', 7], ['pruefung', 1]]);
  assert.equal(r.stufen[1].energie, 6.8, '1000×1000 + 9000×200 + 1000×4000 je Mio.');
  assert.equal(r.stufen[1].cache, 9000);
  assert.equal(r.stufen[0].energie, 40);
});

test('Pipeline: Ausfall benannt — Melious weg oder jcode-Fehler → ausgefallen mit Ausfallpfad', async () => {
  const weg = await planerReview({ chat: async () => null, jcode: async () => { throw new Error('nie'); }, key: 'k', faktoren: {} }, { dir: PR, basis: 'b', diff: '', diffStat: '', ziel: 'z' });
  assert.equal(weg.status, 'ausgefallen'); assert.match(weg.fehler!, /Ausfallpfad: Claude-Worker/);
  const jc = await planerReview({ chat: async () => antwort(JSON.stringify(AUFTRAG)), jcode: async () => ({ code: 1, text: '', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, aufrufe: 0, ms: 1, stderr: 'kaputt' }), key: 'k', faktoren: {} }, { dir: PR, basis: 'b', diff: '', diffStat: '', ziel: 'z' });
  assert.equal(jc.status, 'ausgefallen'); assert.match(jc.fehler!, /Exit 1\) kaputt/);
  assert.equal(jc.stufen.length, 2);
});

test('P6: Bewertung — Kernbefund nur, wenn alle Muster passen (mit Fundstelle); Falsch-Approve im Blocker-Set; Freigabe-Prüfung', async () => {
  const { bewerte, zusammenfassen, evalMarkdown, fundstelle } = await import('../server/planereval.ts');
  const reg = JSON.parse((await import('node:fs')).readFileSync(new URL('../../docs/planer-eval/regression.json', import.meta.url), 'utf8'));
  const p343 = reg.prs.find((p: any) => p.id === '343'), p335 = reg.prs.find((p: any) => p.id === '335');
  assert.equal(p343.opus.blocker, true); assert.equal(p343.fallstrick_aus_diesem_pr, FALLSTRICKE_START[0].id);
  const gut = 'F1 befund: Der Zählpunkt kommt aus der Tarif-App mit 31 Zeichen ohne AT, die Abfrage prüft length = 33.';
  assert.match(fundstelle(gut, p343.kern_befunde[0])!, /31 Zeichen/);
  assert.equal(fundstelle('Zählpunkt passt, Länge 33', p343.kern_befunde[0]), null, '31 fehlt');
  assert.equal(fundstelle(['Zählpunkt ok', ...Array(10).fill('…'), 'Seite 31', 'AT-Präfix'].join('\n'), p343.kern_befunde[0]), null, 'verstreut über Abschnitte zählt nicht');
  const l = (arm: string, empfehlung: string, text: string, energie = 100) => ({ pr: '343', arm, lauf: 1, empfehlung, text, energie, aufrufe: 3, ms: 1000 });
  const bs = [bewerte(p343, l('flash-ohne', 'approve', 'alles gut')), bewerte(p343, l('flash-mit', 'request-changes', gut)), bewerte(p335, { ...l('flash-mit', 'approve', ''), pr: '335' })];
  assert.equal(bs[0].falschApprove, true); assert.equal(bs[1].falschApprove, false); assert.equal(bs[2].falschApprove, false, '335 ist kein Blocker');
  const sum = zusammenfassen(bs, [p343, p335]);
  const ohne = sum.find((s) => s.arm === 'flash-ohne')!, mit = sum.find((s) => s.arm === 'flash-mit')!;
  assert.equal(ohne.falschApprove, 1); assert.equal(ohne.recall, 0); assert.equal(mit.recall, 1);
  assert.match(mit.freigabe, /^nein: .*Energie Opus-Weg nicht gemessen.*nur 2 Läufe/);
  const md = evalMarkdown(bs, sum, 'Test');
  assert.match(md, /\| #343 \| flash-ohne \| 1 \| approve ⚠ Falsch-Approve/);
  assert.match(md, /zaehlpunkt-31-33: „F1 befund/);
});

test('R5 (P6): bewertet wird nur, was der Worker fand und der Planer bestätigte — nicht die Prüffrage selbst', async () => {
  const { bewertungsText } = await import('../server/planereval.ts');
  const t = bewertungsText({ auftrag: { ziel: 'Zählpunkt 31 vs 33 AT prüfen' }, workerText: 'alles gut', punkte: [
    { key: 'F1', frage: 'Zählpunkt 31 vs 33 AT?', status: 'kein_befund', urteil: 'bestaetigt', grund: '31 33 AT' },
    { key: 'F2', frage: 'Zählpunkt 31 ohne AT, Abfrage 33', status: 'befund', urteil: 'bestaetigt', grund: 'stimmt' },
    { key: 'F3', frage: 'verworfen 31 33 AT Zählpunkt', status: 'befund', urteil: 'verworfen', grund: '' }] } as any);
  assert.ok(!t.includes('prüfen'), 'Auftrag nicht im Text');
  assert.ok(t.includes('F2') && !t.includes('F1') && !t.includes('F3'));
});

test('Runden 4/5: Lese-Gurt fail-closed — fremdes Werkzeug, „..“, Symlink nach draußen, fehlende/leere Sitzung; Symlink-Scan vor dem Lauf', async () => {
  const { sessionPfade, ausserhalb, lesegurt, symlinksNachDraussen } = await import('../server/planer.ts');
  const s = { messages: [{ content: [{ type: 'tool_use', name: 'read', input: { file_path: `${PR}/src/route.ts` } }, { type: 'tool_use', name: 'agentgrep', input: { query: 'x', path: NB, glob: `${NB}/src/**/*.ts`, paths: [`${PR}/src`] } }, { type: 'tool_use', name: 'bash', input: { command: 'cat /etc/x' } }] }, { content: 'text' }] };
  assert.deepEqual(sessionPfade(s), [`${PR}/src/route.ts`, NB, `${NB}/src/**/*.ts`, `${PR}/src`, 'werkzeug:bash']);
  const erlaubt = [PR, NB];
  assert.deepEqual(ausserhalb(sessionPfade(s), PR, erlaubt), ['werkzeug:bash']);
  assert.deepEqual(ausserhalb(['/etc/hostname', 'src/route.ts', `${TMP}/draussen.txt`, '/home/**', `${PR}/src/../src/route.ts`, `${PR}/**/../../x`], PR, erlaubt),
    ['/etc/hostname', `${TMP}/draussen.txt`, '/home/**', `${PR}/src/../src/route.ts`, `${PR}/**/../../x`], '„..“ ist immer ein Verstoß');
  assert.equal(lesegurt(undefined, PR, erlaubt), null);
  assert.match(lesegurt(null, PR, erlaubt)!, /nicht prüfbar/);
  assert.match(lesegurt(['werkzeug:bash'], PR, erlaubt)!, /keine Lese-Aufrufe/);
  assert.match(lesegurt([`${PR}/src/route.ts`, 'werkzeug:batch'], PR, erlaubt)!, /fremdem Werkzeug \(1 Pfad\)/);
  assert.equal(lesegurt([`${PR}/src/route.ts`, `${NB}/src/hook.ts`], PR, erlaubt), null);
  // Symlink im PR nach draußen: der Gurt sieht ihn, und der Scan verhindert den Lauf ganz.
  writeFileSync(join(TMP, 'geheim-ziel.txt'), 'x');
  execFileSync('ln', ['-sfn', join(TMP, 'geheim-ziel.txt'), join(PR, 'src', 'harmlos.ts')]);
  execFileSync('ln', ['-sfn', 'route.ts', join(PR, 'src', 'innen.ts')]);
  assert.deepEqual(ausserhalb([`${PR}/src/harmlos.ts`], PR, erlaubt), [`${PR}/src/harmlos.ts`]);
  assert.deepEqual(symlinksNachDraussen(PR), ['src/harmlos.ts'], 'innen.ts zeigt nach innen und ist erlaubt');
  assert.match(symlinksNachDraussen(PR, 2).at(-1)!, /abgebrochen/, 'abgebrochene Suche ist kein „sauber“');
  // PR hat hier genau 4 Einträge (src, route.ts, harmlos.ts, innen.ts): unter 4 abgebrochen, ab 4 vollständig.
  for (let k = 1; k < 4; k++) assert.match(symlinksNachDraussen(PR, k).at(-1) ?? '', /abgebrochen/, `Grenze ${k}`);
  assert.deepEqual(symlinksNachDraussen(PR, 4), ['src/harmlos.ts'], 'genau an der Grenze vollständig');
  assert.deepEqual(symlinksNachDraussen(PR, 10_000), ['src/harmlos.ts']);
  const chat: ChatFn = async (b: any) => antwort(b.messages[0].content.includes('PRÜFAUFTRAG') ? JSON.stringify(AUFTRAG) : '{"urteile":[]}');
  const mit = (pfade: string[] | null): JcodeFn => async () => ({ code: 0, text: '```json\n{"antworten":[]}\n```', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, aufrufe: 1, ms: 1, stderr: '', pfade });
  const inp = { dir: PR, basis: 'b', diff: 'diff --git a/x b/x\n+x', diffStat: '', ziel: 'z', nachbarn: [{ name: 'olaf-tariff-app', dir: NB, ref: 'origin/develop', fetchAlterH: null }] };
  let planerAufrufe = 0;
  const zaehl: ChatFn = async (b) => { planerAufrufe++; return chat(b); };
  const scan = await planerReview({ chat: zaehl, jcode: mit([`${PR}/src/route.ts`]), key: 'k', faktoren: {} }, inp);
  assert.equal(scan.status, 'fehler'); assert.match(scan.fehler!, /Symlinks nach außerhalb \(src\/harmlos\.ts\) — Schattenweg nicht gestartet/);
  assert.equal(planerAufrufe, 0, 'keine Energie verbraucht');
  rmSync(join(PR, 'src', 'harmlos.ts'));
  const raus = await planerReview({ chat, jcode: mit(['/etc/hostname']), key: 'k', faktoren: {} }, inp);
  assert.equal(raus.status, 'fehler'); assert.match(raus.fehler!, /außerhalb der erlaubten Ordner.*\(1 Pfad\) — Ergebnis verworfen/);
  assert.equal(raus.workerText, undefined); assert.equal(raus.bericht, undefined);
  const ohne = await planerReview({ chat, jcode: mit(null), key: 'k', faktoren: {} }, inp);
  assert.equal(ohne.status, 'fehler'); assert.match(ohne.fehler!, /nicht prüfbar/);
  const ok = await planerReview({ chat, jcode: mit([`${PR}/src/route.ts`, `${NB}/src/hook.ts`]), key: 'k', faktoren: {} }, inp);
  assert.equal(ok.status, 'fertig');
});

// ---------- Regressionen aus Review-Runde 1 (Pass B + Pass C) ----------
const LANG = 'const ok = length(p.nr) = 33;';
test('R1 (P4): kein_befund zu Hoch-Frage, vom Planer verworfen → strittig, nie approve; fehlendes Urteil → strittig', () => {
  const b = bericht({ antworten: ['F1', 'F2', 'F3'].map((id) => ({ id, status: 'kein_befund', beleg: 'src/route.ts:3', zitat: LANG })) });
  const p = pruefpflichtig(A.a, b);
  const v = urteilAbleiten(A.a, b, p.map((x) => ({ ...x, urteil: 'verworfen', grund: 'Zitat zeigt den Fehler' })));
  assert.equal(v.empfehlung, 'comment');
  assert.match(v.strittig[0], /F1: Planer widerspricht kein_befund — Zitat zeigt den Fehler/);
  const ohne = urteilAbleiten(A.a, b, p.map((x) => ({ ...x, urteil: undefined })));
  assert.equal(ohne.empfehlung, 'comment');
  assert.match(ohne.strittig[0], /F1: kein Urteil des Planers/);
});

test('R2 (P3): Zitatprüfung — Bereich höchstens 30 Zeilen, Zitat mindestens 12 Zeichen, „...“ (Spread) teilt nicht', () => {
  assert.equal(pruefeZitat('src/route.ts:1-100000', LANG, W).status, 'ohne_beleg');
  assert.equal(pruefeZitat('src/route.ts:3', 'const', W).status, 'ohne_beleg', 'zu kurz');
  assert.equal(pruefeZitat('src/route.ts:3', 'length … 33;', W).status, 'ohne_beleg', 'Teile zusammen zu kurz');
  writeFileSync(join(PR, 'src', 'spread.ts'), 'const x = f(...args, 1);\n');
  assert.equal(pruefeZitat('src/spread.ts:1', 'const x = f(...args, 1);', W).status, 'ok');
  assert.notEqual(pruefeZitat('src/spread.ts:1', 'const x = f(...rest, 1);', W).status, 'ok');
  assert.notEqual(pruefeZitat('src/route.ts:1-20', 'const … length … 33;', W).status, 'ok', 'kein Teil ≥ 12 Zeichen (Runde 2)');
  assert.equal(pruefeZitat('src/route.ts:3', 'const ok = length(p.nr) ... = 33;', W).status, 'ok', 'Auslassung mit drei Punkten');
});

test('R3: ein Symlink im PR-Worktree, der hinausführt, wird nicht gelesen', () => {
  writeFileSync(join(TMP, 'draussen.txt'), 'WERT_AUSSERHALB_DER_WURZEL\n');
  execFileSync('ln', ['-sfn', TMP, join(PR, 'raus')]);
  assert.equal(pruefeZitat('raus/draussen.txt:1', 'WERT_AUSSERHALB_DER_WURZEL', W).status, 'nicht_gefunden');
  rmSync(join(PR, 'raus'));
});

test('R8 (P3): kein_befund ohne gültiges Zitat sperrt approve auch bei Mittel-/Niedrig-Fragen', () => {
  const b = bericht({ antworten: [{ id: 'F1', status: 'kein_befund', beleg: 'src/route.ts:3', zitat: LANG }, { id: 'F2', status: 'kein_befund', beleg: '', zitat: '' }, { id: 'F3', status: 'kein_befund', beleg: 'src/route.ts:3', zitat: 'gibt es so nicht im Code' }] });
  const u = urteilAbleiten(A.a, b, pruefpflichtig(A.a, b).map((x) => ({ ...x, urteil: 'bestaetigt' })));
  assert.equal(u.empfehlung, 'comment');
  assert.deepEqual(u.strittig.map((s) => s.slice(0, 2)), ['F2', 'F3']);
});
