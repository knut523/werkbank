// Release 20b, Plan 274 (docs/plan-20b-zuverlaessigkeit.md): die Vorfälle vom 20.10.2026 als Tests — Live-Modus, Rechner-Regel,
// ein Strang je Worktree, Zustellung mit Bestätigung und Wiederholung, Budget ohne Abbruch, eigenes Paket, ehrlicher Status.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MongoClient } from 'mongodb';

const tag = randomBytes(4).toString('hex');
process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_test_20b_${tag}`;
const REVIEW = mkdtempSync(join(tmpdir(), 'wb-20b-review-'));
process.env.WERKBANK_REVIEW_DIR = REVIEW;
delete process.env.ORCH_BUDGET_TOKENS;

const T = await import('../server/tiefe.ts');
const O = await import('../server/orchestrator.ts');
const Bt = await import('../server/bericht.ts');
const B = await import('../server/cosbudget.ts');
const L = await import('../server/leitstand.ts');
const db = await import('../server/db.ts');
const M = await import('../server/messung.ts');
const { tiefeEta } = await import('../server/orch-cli.ts');

let raw: MongoClient;
before(async () => { await db.connect(); raw = await MongoClient.connect(TEST_MONGO); });
after(async () => { await raw.db(process.env.WERKBANK_DB).dropDatabase(); await raw.close(); process.exit(0); });

const u = { id: '6a1b2c3d4e5f60718293a4b5', email: 'knut@maxenergy.at', name: 'Knut Peters', role: 'ADMIN' } as any;

// ---------- D1 Live-Modus ----------

test('D1 Live-Modus: Tiefe „live“ = quick am laufenden Dev-Server, kein Council/Pass C je Runde, „jetzt gründlich“ einmal vor dem Push', () => {
  assert.ok(T.TIEFEN.includes('live' as any), 'live ist eine Tiefe');
  assert.equal(T.istTiefe('live'), true);
  assert.equal(T.tiefeOf('live'), 'live');
  const t = T.tiefeText('live' as any);
  assert.match(t, /Tiefe: \*\*live\*\*/);
  assert.match(t, /Dev-Server/);
  assert.match(t, /kein Council/);
  assert.match(t, /keine Gegenprüfung|kein Pass C/);
  assert.match(t, /jetzt gründlich/);
  // Vorgaben wie quick: Risiko niedrig, Deckel ⅓; Modell: Claude (Vorgabe der Brücke) — Entscheidung D1 im Bericht.
  assert.deepEqual(T.tiefeStart('live' as any, {}), { modell: null, risiko: 'niedrig' });
  assert.equal(T.autoMaxFuer('live' as any, 30), 10);
  assert.ok(T.ETA_VORGABE_MIN['live' as 'quick'] > 0);
  assert.ok('live' in T.mediane([]), 'Median auch für live');
  // Der gründliche Durchlauf: Pass C, Gegenprüfung, alle Tests, Bericht — dann fertig.
  assert.match(T.GRUENDLICH_TEXT, /jetzt gründlich/i);
  assert.match(T.GRUENDLICH_TEXT, /Pass C/);
  assert.match(T.GRUENDLICH_TEXT, /challenge/);
  assert.match(T.GRUENDLICH_TEXT, /alle Tests/);
  assert.equal(tiefeEta({ tiefe: 'live', status: 'running', eta: { text: 'fertig ca. 18:00' } }), 'Tiefe live · fertig ca. 18:00');
  // Strang-Brief trägt die Live-Anweisung.
  assert.match(O.orchBrief({ title: 'UI', prompt: 'Knopf grün', cwd: '/tmp/x', tiefe: 'live' as any }), /Tiefe: \*\*live\*\*/);
});

// ---------- D2 Rechner-Regel ----------

test('D2 Rechner-/Geld-/Summenlogik: zuerst rote Tests für die Grundregeln — steht in jedem Strang-Brief', () => {
  const b = O.orchBrief({ title: 'Tarifrechner', prompt: 'Rechner bauen', cwd: '/tmp/x' });
  assert.match(b, /Rechner-, Geld- oder Summenlogik/);
  assert.match(b, /Summe = Summe der gezeigten Posten/);
  assert.match(b, /Vorzeichen/);
  assert.match(b, /netto\/brutto/);
  assert.match(b, /zuerst.*Tests.*rot/is);
});

// ---------- D4a ein Strang je Worktree ----------

test('D4a Worktree-Schlüssel: Git-Wurzel des Ordners; Unterordner und Dateien im selben Repo → derselbe Worktree', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wb-20b-wt-')));
  execFileSync('git', ['init', '-q', root]);
  mkdirSync(join(root, 'web', 'src'), { recursive: true });
  assert.equal(O.worktreeVon(join(root, 'web', 'src')), root);
  assert.equal(O.worktreeVon(join(root, 'web', 'src', 'neu.ts')), root, 'Datei, die es noch nicht gibt: Wurzel ihres Ordners');
  const kein = realpathSync(mkdtempSync(join(tmpdir(), 'wb-20b-nogit-')));
  assert.equal(O.worktreeVon(kein), kein, 'ohne Git: der Ordner selbst');
  assert.equal(O.worktreeVon(join(REVIEW, '259-rechner-feedback-bau', 'screenshots')), join(REVIEW, '259-rechner-feedback-bau'), 'Review-Paket = eigener Schlüssel');
  assert.equal(O.worktreeVon(''), '', 'leer bleibt leer (nie der Ordner des Servers)');
});

test('D4a Konflikt: ein anderer offener Strang mit demselben Worktree (cwd) ODER Dateien darin (Vorfall b9b968af/4c836b73)', () => {
  const andere = [
    { id: '4c836b73', title: 'Rechner Runde 3', status: 'running', trees: ['/w/review-pakete/259-rechner', '/w/olaf-tariff-app-rechner-feedback'] },
    { id: 'aaaa0001', title: 'fertig', status: 'done', trees: ['/w/olaf-tariff-app-rechner-feedback'] },
    { id: 'aaaa0002', title: 'anderes Repo', status: 'waiting', trees: ['/w/werkbank-20b'] },
  ];
  const k = O.worktreeKonflikt(['/w/olaf-tariff-app-rechner-feedback'], andere as any);
  assert.equal(k?.id, '4c836b73', 'geschriebene Dateien zählen wie cwd');
  assert.equal(O.worktreeKonflikt(['/w/werkbank-20c'], andere as any), null);
  assert.equal(O.worktreeKonflikt(['/w/olaf-tariff-app-rechner-feedback'], andere.slice(1) as any), null, 'fertige Stränge halten keinen Worktree');
  // Ein Strang, der an einer technischen Grenze hängt (wird automatisch fortgesetzt), hält den Worktree auch.
  assert.equal(O.worktreeKonflikt(['/w/x'], [{ id: 'b', title: 'b', status: 'failed', cause: 'lost', trees: ['/w/x'] }] as any)?.id, 'b');
  assert.equal(O.worktreeKonflikt(['/w/x'], [{ id: 'b', title: 'b', status: 'failed', trees: ['/w/x'] }] as any), null, 'blockiert ohne Fortsetzung: frei');
  assert.match(O.konfliktText(k!), /4c836b73.*Rechner Runde 3/);
  assert.match(O.konfliktText(k!), /eigenen Worktree|--shared/);
});

// ---------- D4b Zustellung ----------

const T0 = 1_760_000_000_000;
const run = { startedAt: T0, lastSentAt: T0, startError: null };
const ai = (text: string, at = T0 + 61_000) => ({ fromUser: false, text, error: false, at });

test('D4b Bestätigung: angekommen (Zug läuft/lief seit dem Senden), in der Schlange, sonst unterwegs', () => {
  assert.equal(O.bestaetigung({ running: true, interrupted: false, turn: { start: T0 + 300, end: null, outcome: null } }, T0), 'angekommen');
  assert.equal(O.bestaetigung({ running: false, interrupted: false, turn: { start: T0 + 300, end: T0 + 900, outcome: 'ok' } }, T0), 'angekommen', 'schon wieder fertig');
  assert.equal(O.bestaetigung({ running: false, interrupted: false, queued: { pos: 2, since: T0 }, turn: { start: T0 + 300, end: null, outcome: null } }, T0), 'schlange');
  assert.equal(O.bestaetigung({ running: true, interrupted: false, turn: { start: T0 - 60_000, end: null, outcome: null } }, T0), 'unterwegs', 'alter Zug zählt nicht');
  assert.equal(O.bestaetigung(null, T0), 'unterwegs');
});

test('D4b Wiederholung: „nicht angekommen“ schickt denselben Text noch einmal (nicht nur „weiter“); andere Gründe „weiter“', () => {
  const t = O.fortsetzText('lost', 'Erweiterungsauftrag: baue das Rahmendokument', 2, 30);
  assert.match(t, /Erweiterungsauftrag: baue das Rahmendokument/);
  assert.match(t, /noch einmal zugestellt/);
  assert.match(O.fortsetzText('lost', null, 1, 30), /^weiter \(automatisch fortgesetzt: Nachricht nicht angekommen, 1\/30\)/);
  assert.match(O.fortsetzText('limit', 'egal', 3, 30), /^weiter \(automatisch fortgesetzt: Schrittlimit, 3\/30\)/);
  // Eine schon wiederholte Nachricht wird nicht doppelt eingepackt.
  assert.equal((O.fortsetzText('lost', t, 3, 30).match(/noch einmal zugestellt/g) ?? []).length, 1);
});

test('D4b Nachreichungen: alle werden verfolgt (nicht nur die letzte); ungelesen und unbekannt → nach dem Zug nachsenden', () => {
  const li = O.injectsVon({ nachreichungen: [{ id: 'a', done: false }, { id: 'b', done: true }], lastInject: { id: 'c', done: false } });
  assert.deepEqual(li.map((x: any) => x.id), ['a', 'c'], 'offene aus der Liste + das alte Einzelfeld');
  assert.equal(O.nachsenden('ungelesen'), true);
  assert.equal(O.nachsenden(null), true, 'Brücke neu gestartet: lieber einmal doppelt (mit Hinweis) als verloren');
  assert.equal(O.nachsenden('gelesen'), false);
  assert.equal(O.nachsenden('zugestellt'), false, 'Zug liest noch');
  assert.match(O.NACHGEREICHT_HINWEIS, /schon umgesetzt/);
});

// ---------- D9 ehrlicher Status ----------

test('D9 Status ehrlich: Antwort mit „Status: fertig“ nach der letzten Nachricht schlägt ein technisches Zugende', () => {
  const fertig = ai('…\n### Stand\n- Erledigt: alles\nStatus: fertig');
  for (const [o, grund] of [['error', /Fehler/], ['aborted', /abgebrochen/], ['rate_limit', /Kontingent/], ['busy', /Parallelgrenze/], ['limit', /Schrittlimit/], ['timeout', /Zeitlimit/]] as const) {
    const st = O.orchStatus(run, { running: false, interrupted: false, turn: { start: T0 + 1000, end: T0 + 60_000, outcome: o } }, fertig);
    assert.equal(st.status, 'done', o);
    assert.match(st.reason, /^fertig \(danach abgebrochen: /, o);
    assert.match(st.reason, grund, o);
    assert.equal(st.cause, undefined, `${o}: kein automatisches „weiter“ nach „fertig“`);
  }
  // Ohne „fertig“ bleibt es beim technischen Zugende.
  assert.equal(O.orchStatus(run, { running: false, interrupted: false, turn: { start: T0 + 1000, end: T0 + 60_000, outcome: 'error' } }, ai('Zwischenstand')).status, 'failed');
  // Eine alte „fertig“-Antwort vor der letzten Nachricht zählt nicht.
  assert.equal(O.orchStatus({ ...run, lastSentAt: T0 + 120_000 }, { running: false, interrupted: false, turn: { start: T0 + 1000, end: T0 + 60_000, outcome: 'error' } }, fertig, T0 + 500_000).status, 'failed');
  // Brücke ohne Zugvermerk (Neustart), aber gespeicherte „fertig“-Antwort nach dem Senden.
  const ohne = O.orchStatus(run, null, fertig, T0 + 500_000);
  assert.equal(ohne.status, 'done'); assert.match(ohne.reason, /^fertig/);
});

test('D9 Deckel/Budget nach „fertig“: bleibt fertig (danach: Grund); Budget-Pause ist „wartet“, nicht „failed“', () => {
  const done = { status: 'done' as const, reason: 'Agent meldet „fertig“' };
  assert.deepEqual(O.mitDeckel(done, { reason: 'Budget erreicht (1 340 085 von 1 200 000 Tokens)', cause: 'budget' }), { status: 'done', reason: 'fertig (danach: Budget erreicht (1 340 085 von 1 200 000 Tokens))' });
  const w = O.mitDeckel({ status: 'failed', reason: 'x', cause: 'lost' }, { reason: 'Budget erreicht (465 375 von 400 000 Tokens)', cause: 'budget' });
  assert.equal(w.status, 'waiting'); assert.match(w.reason, /^pausiert: Budget erreicht/); assert.match(w.reason, /Weiter mit \+50 %|Anhalten/);
  assert.equal(O.mitDeckel({ status: 'waiting', reason: 'x', cause: 'limit' }, { reason: '30× automatisch fortgesetzt — Chat ansehen', cause: 'limit' }).status, 'failed', 'Deckel des Auto-weiter bleibt gestoppt');
  assert.equal(O.mitDeckel({ status: 'running', reason: 'Zug läuft' }, { reason: 'Budget', cause: 'budget' }).status, 'running');
  // Karten-Statuswort: fertig vor gestoppt.
  assert.equal(L.statusWord({ autoStopped: { cause: 'budget' }, lastStatus: 'done', doneAt: new Date() }), 'fertig');
  assert.equal(L.statusWord({ autoStopped: { cause: 'limit' }, lastStatus: 'failed' }), 'gestoppt');
});

// ---------- D8 eigenes Paket ----------

test('D8 Paket eines Strangs: Arbeitsordner im Paket schlägt die Vorarbeit im Auftrag (Vorfall ce076bec → 242)', () => {
  const prompt = 'Vorarbeit: ~/work/knut/review-pakete/242-geraetewechsel/bericht.md und review-pakete/256-erinnerung/bericht.md.\nBericht nach ~/work/knut/review-pakete/257-einwilligungstexte/bericht.md';
  assert.equal(Bt.eigenesPaket(join(REVIEW, '257-einwilligungstexte'), [prompt]), '257-einwilligungstexte');
  assert.equal(Bt.eigenesPaket(join(REVIEW, '257-einwilligungstexte', 'sub', 'tiefer'), [prompt]), '257-einwilligungstexte', 'auch aus einem Unterordner');
  // Arbeitsordner ist ein Repo: ausdrücklich „Paket …“ im Auftrag.
  assert.equal(Bt.eigenesPaket('/home/knut/work/knut/werkbank-20b', ['… Paket ~/work/knut/review-pakete/274-workspace-20b. Lokal committen. Vorbild: review-pakete/213-workspace-neu/bericht.md']), '274-workspace-20b');
  assert.equal(Bt.eigenesPaket('/repo', ['Paket: review-pakete/275-x-y, Vorarbeit review-pakete/100-alt/bericht.md']), '275-x-y');
  // Sonst der Auftrag des Pakets (auftrag.md liegt im eigenen Paket).
  assert.equal(Bt.eigenesPaket('/repo', ['Auftrag: ~/work/knut/review-pakete/280-neu/auftrag.md; Vorarbeit review-pakete/100-alt/bericht.md']), '280-neu');
  // Sonst nur, wenn genau EIN Paket genannt ist.
  assert.equal(Bt.eigenesPaket('/repo', ['Bericht nach review-pakete/281-einzig/bericht.md']), '281-einzig');
  assert.equal(Bt.eigenesPaket('/repo', ['Vorarbeit review-pakete/100-alt/bericht.md; Bericht review-pakete/282-neu/bericht.md']), null, 'zwei Pakete ohne Marke: nicht raten');
  assert.equal(Bt.eigenesPaket('/repo', ['nichts']), null);
  assert.equal(Bt.eigenesPaket(join(REVIEW, '..', 'evil'), []), null);
});

test('D8 Heilung: falsch zugeordneter Bericht wird auf das eigene Paket umgestellt (Kopf neu lesen)', () => {
  const d = { cwd: join(REVIEW, '257-einwilligungstexte'), prompt: 'Vorarbeit review-pakete/242-geraetewechsel/bericht.md', bericht: join(REVIEW, '242-geraetewechsel', 'bericht.md'), paket: '242-geraetewechsel', berichtMeta: '1:2', berichtKopf: { status: 'x' } };
  const set = O.paketHeilung(d);
  assert.equal(set?.paket, '257-einwilligungstexte');
  assert.equal(set?.bericht, join(REVIEW, '257-einwilligungstexte', 'bericht.md'));
  assert.equal(set?.berichtMeta, null); assert.equal(set?.berichtKopf, null);
  assert.equal(O.paketHeilung({ ...d, bericht: set!.bericht, paket: set!.paket }), null, 'stimmt schon → nichts');
  assert.equal(O.paketHeilung({ cwd: '/repo', prompt: 'x', bericht: '/a/b.md', paket: null }), null, 'ohne eigenes Paket: nicht anfassen');
});

// ---------- D5 Budget ----------

const strang = (id: string, o: any = {}) => ({ _id: id, userId: u.id, conv: `conv-${id}`, title: `Strang ${id}`, cwd: '/tmp', startedAt: new Date(), lastSentAt: new Date(Date.now() - 600_000), reviewedAt: null, knutReviewedAt: null, startError: null, autoStopped: null, ...o });
const zug = (conv: string, n: number) => M.recordZug(u, { conv, art: 'strang', modell: 'Claude sonnet', input: n, output: 0, cacheRead: 0 });

test('D5 Budget 100 % während eines Zuges: kein Abbruch — der Zug bekommt „Schritt sauber beenden, Stand sichern“, dann Pause + Rückfrage', async () => {
  await O.runs().insertOne(strang('b-lauf', { budgetTokens: 1000, lastStatus: 'running' }) as any);
  await zug('conv-b-lauf', 1200);
  const gesendet: string[] = [];
  const r = await B.budgetTick({ userById: async () => u, log: () => {}, nachreichen: async (_u: any, _d: any, text: string) => { gesendet.push(text); return true; } });
  assert.deepEqual(r.gestoppt, ['b-lauf']);
  assert.equal(gesendet.length, 1, 'genau eine Nachricht an den laufenden Zug');
  assert.match(gesendet[0], /laufenden Schritt sauber/);
  assert.match(gesendet[0], /Stand sichern|sichere den Stand/i);
  assert.match(gesendet[0], /braucht Antwort/);
  const d: any = await O.runs().findOne({ _id: 'b-lauf' as any });
  assert.equal(d.autoStopped.cause, 'budget', 'danach keine automatische Fortsetzung (Pause)');
  assert.ok(d.budget.abschlussAt, 'Abschluss-Nachricht vermerkt');
  assert.equal(await O.questions().countDocuments({ kind: 'budget', 'strand.id': 'b-lauf' }), 1, 'Meldung an Knut');
  await B.budgetTick({ userById: async () => u, log: () => {}, nachreichen: async (_u: any, _d: any, text: string) => { gesendet.push(text); return true; } });
  assert.equal(gesendet.length, 1, 'nur einmal');
});

test('D5 Budget 100 % nach „fertig“: keine Pause, keine Rückfrage — nur ein Vermerk (Vorfall b95d9cdd)', async () => {
  const lastSent = new Date(Date.now() - 3600_000);
  await O.runs().insertOne(strang('b-fertig', { budgetTokens: 1000, lastStatus: 'done', marke: 'fertig', doneAt: new Date(), lastSentAt: lastSent }) as any);
  await zug('conv-b-fertig', 1500);
  const r = await B.budgetTick({ userById: async () => u, log: () => {}, nachreichen: async () => { throw new Error('nicht an einen fertigen Strang'); } });
  assert.deepEqual(r.gestoppt.filter((x: string) => x === 'b-fertig'), []);
  const d: any = await O.runs().findOne({ _id: 'b-fertig' as any });
  assert.equal(d.autoStopped, null);
  assert.ok(d.budget.ueberAt, 'Überschreitung vermerkt');
  assert.equal(await O.questions().countDocuments({ kind: 'budget', 'strand.id': 'b-fertig' }), 0);
});

// ---------- Sichtbares: Arbeit › Unter-Chats ----------

test('D9/D1 Arbeit-Zeile: „fertig (danach abgebrochen: …)“ als Zustand; Live-Unter-Chat mit Knopf „Jetzt gründlich“', async () => {
  const { zeile } = await import('../server/arbeit.ts');
  const z = zeile({ _id: 'a1', title: 'Löschkonzept', zustand: 'fertig', zustandGrund: 'fertig (danach abgebrochen: Fehler in der Claude-Sitzung)', tiefe: 'regular', marke: 'fertig' });
  assert.equal(z.zustandText, 'fertig (danach abgebrochen: Fehler in der Claude-Sitzung)');
  assert.equal(z.gruendlich, null, 'nur im Live-Modus');
  assert.equal(zeile({ _id: 'a2', title: 'x', zustand: 'fertig', zustandGrund: 'Agent meldet „fertig“' }).zustandText, 'fertig');
  const live = zeile({ _id: 'a3', title: 'UI', zustand: 'wartet', tiefe: 'live', lastSentAt: new Date(T0) });
  assert.equal(live.tiefe, 'live');
  assert.deepEqual(live.gruendlich, { angestossen: false });
  assert.deepEqual(zeile({ _id: 'a4', title: 'UI', zustand: 'laeuft', tiefe: 'live', lastSentAt: new Date(T0), gruendlichAt: new Date(T0 + 1000) }).gruendlich, { angestossen: true });
});
