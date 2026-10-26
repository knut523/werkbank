// Release 29, Strang C — Ticket-Kette (jirakette.ts): Schalter, Zustandsmaschine, Verbote, Trockenlauf und Live-Ablauf mit Fakes.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';

const tag = randomBytes(4).toString('hex');
const T0 = mkdtempSync(join(tmpdir(), 'atkette-'));
process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_test_kette_${tag}`;
process.env.WERKBANK_REVIEW_DIR = join(T0, 'pakete');
mkdirSync(process.env.WERKBANK_REVIEW_DIR, { recursive: true });
delete process.env.WERKBANK_FIX_ORGS;
const K = await import('../server/jirakette.ts');
const db = await import('../server/db.ts');

let raw: MongoClient;
before(async () => { await db.connect(); raw = await MongoClient.connect(TEST_MONGO); });
after(async () => { await raw.db(process.env.WERKBANK_DB).dropDatabase(); await raw.close(); process.exit(0); });

const SHA = 'a'.repeat(40), SHA2 = 'b'.repeat(40);
const U: any = { id: 'u1', name: 'Knut', email: 'k@example.com', role: 'ADMIN' };

// ---------- Schalter ----------
test('ketteModus: Vorgabe aus; trocken und live; Unbekanntes gilt als aus (mit Hinweis)', () => {
  assert.deepEqual(K.ketteModus({}), { modus: 'aus', problem: null });
  assert.equal(K.ketteModus({ WERKBANK_JIRAKETTE: 'trocken' }).modus, 'trocken');
  assert.equal(K.ketteModus({ WERKBANK_JIRAKETTE: 'live' }).modus, 'live');
  const x = K.ketteModus({ WERKBANK_JIRAKETTE: 'ja' });
  assert.equal(x.modus, 'aus'); assert.match(x.problem!, /Unbekannter Wert/);
});

test('starteKette: bei „aus“ 403, kein Strang, kein Eintrag', async () => {
  let gestartet = 0;
  await assert.rejects(K.starteKette(U, { issue: { key: 'PM-1', summary: 'x', description: '', type: 'Task', status: 'To Do' } as any, site: 'PM' }, { startOrch: async () => { gestartet++; return { id: 's', cwd: '/' }; }, klon: () => '/nope' }, {}), (e: any) => e.status === 403);
  assert.equal(gestartet, 0);
  assert.equal(await K.ketten().countDocuments({ key: 'PM-1' }), 0);
});

// ---------- Ziel-Repo, Namen, Texte ----------
test('repoAusTicket: Label repo:x → WirStrom1/x; Nennung im Text; fremde Org und Dateipfade zählen nicht', () => {
  assert.equal(K.repoAusTicket({ labels: ['repo:olaf-admin'], summary: '', description: '' }), 'WirStrom1/olaf-admin');
  assert.equal(K.repoAusTicket({ labels: [], summary: 'Fix in WirStrom1/olaf-tariff-app', description: '' }), 'WirStrom1/olaf-tariff-app');
  assert.equal(K.repoAusTicket({ labels: [], summary: 'x', description: 'siehe evil/repo und src/server/main.ts' }), null);
  assert.equal(K.repoAusTicket({ labels: ['repo:evil/x'], summary: '', description: '' }), null);
});
test('zweigName: kette/<ticket>-<slug>, nie geschützt; zweigOk lehnt main/develop und Doppelstriche ab', () => {
  const z = K.zweigName('OLAF-123', 'Tarifrechner: Größe ändern!');
  assert.match(z, /^kette\/olaf-123-[a-z0-9-]+$/);
  assert.equal(K.zweigOk(z), true);
  for (const bad of ['main', 'develop', 'kette/../main', 'feature/x', 'kette/a--b', 'kette/x']) assert.equal(K.zweigOk(bad), false, bad);
});
test('prText: Englisch, ohne lokale Pfade, ohne Verweis auf PRs; Kommentarentwurf verweist auf PR oder nennt „no push yet“', () => {
  const t = K.prText({ key: 'PM-9', summary: 'Thing', site: 'PM' }, '## Ziel\nMach es in /home/knut/work/x\n## Definition of Done\n- a', ' a.ts | 2 +-', [{ subject: 'feat: x' }], 'https://j/browse/PM-9');
  assert.doesNotMatch(t.body, /\/home\/|~\//); assert.doesNotMatch(t.body, /#\d+/); assert.match(t.body, /Draft for PM-9/);
  assert.match(K.kommentarEntwurf({ key: 'PM-9', repo: 'WirStrom1/r', zweig: 'kette/pm-9-x', pr: 'https://github.com/WirStrom1/r/pull/5', trocken: null, paket: '001-p' }), /pull\/5/);
  assert.match(K.kommentarEntwurf({ key: 'PM-9', repo: 'WirStrom1/r', zweig: 'kette/pm-9-x', pr: null, trocken: 'x', paket: '001-p' }), /no push yet/);
});

// ---------- Zustandsmaschine (rein) ----------
const sig = (o: Partial<import('../server/jirakette.ts').Signale> = {}) => ({ strang: null, planDa: false, frage: null, freigabe: null, fakten: null, ...o });
const fk = (o: any = {}) => ({ head: SHA, clean: true, branchOk: true, basis: 'develop', commits: 2, ...o });

test('plan: wartet, bis Strang fertig UND plan.md da ist; failed → fehler', () => {
  const k = { state: 'plan' as const, head: null };
  assert.equal(K.naechsterSchritt(k, sig({ strang: { status: 'running' }, planDa: true })).art, 'warten');
  assert.equal(K.naechsterSchritt(k, sig({ strang: { status: 'done' }, planDa: false })).art, 'warten');
  assert.equal(K.naechsterSchritt(k, sig({ strang: { status: 'done' }, planDa: true })).art, 'frage_plan');
  assert.equal(K.naechsterSchritt(k, sig({ strang: { status: 'waiting' }, planDa: true })).art, 'frage_plan');
  assert.deepEqual(K.naechsterSchritt(k, sig({ strang: { status: 'failed' } })), { art: 'ende', zustand: 'fehler', grund: 'Plan-Chat: failed' });
});
test('plan_frage: offen wartet; Freigeben → bau; Verwerfen → abgelehnt; Nachbessern nur mit Text', () => {
  const k = { state: 'plan_frage' as const, head: null };
  const f = (status: string, option: string | null, text = '') => sig({ frage: { status, option, text } });
  assert.equal(K.naechsterSchritt(k, f('offen', null)).art, 'warten');
  assert.equal(K.naechsterSchritt(k, f('beantwortet', K.OPT_PLAN.frei)).art, 'bau_starten');
  assert.deepEqual(K.naechsterSchritt(k, f('beantwortet', K.OPT_PLAN.weg)), { art: 'ende', zustand: 'abgelehnt', grund: 'Plan verworfen' });
  assert.deepEqual(K.naechsterSchritt(k, f('beantwortet', K.OPT_PLAN.nach, 'Tests ergänzen')), { art: 'nachbessern', text: 'Tests ergänzen' });
  assert.equal(K.naechsterSchritt(k, f('beantwortet', K.OPT_PLAN.nach, '')).art, 'ende');
  assert.equal(K.naechsterSchritt(k, f('zurückgezogen', null)).art, 'ende');
  assert.equal(K.naechsterSchritt(k, sig()).art, 'warten', 'Frage nicht lesbar → nie bauen');
});
test('bau: nur mit Commit und sauberem Worktree weiter zur Push-Frage', () => {
  const k = { state: 'bau' as const, head: null };
  const s = (o: any) => sig({ strang: { status: 'done' }, fakten: fk(o) });
  assert.equal(K.naechsterSchritt(k, sig({ strang: { status: 'running' } })).art, 'warten');
  assert.equal(K.naechsterSchritt(k, s({})).art, 'frage_push');
  assert.equal(K.naechsterSchritt(k, s({ clean: false })).art, 'warten');
  assert.equal(K.naechsterSchritt(k, s({ commits: 0 })).art, 'ende');
  assert.equal(K.naechsterSchritt(k, sig({ strang: { status: 'done' }, fakten: null })).art, 'ende');
});
test('push_frage: ohne Freigabe nie ausführen; geänderter Kopf, unsauber oder Basis ≠ develop/dev → nicht pushen', () => {
  const k = { state: 'push_frage' as const, head: SHA };
  assert.equal(K.naechsterSchritt(k, sig({ fakten: fk() })).art, 'warten');
  assert.equal(K.naechsterSchritt(k, sig({ freigabe: { head: SHA }, fakten: fk() })).art, 'ausfuehren');
  assert.equal(K.naechsterSchritt(k, sig({ freigabe: { head: SHA2 }, fakten: fk() })).art, 'warten', 'Freigabe für anderen Stand');
  assert.equal(K.naechsterSchritt(k, sig({ freigabe: { head: SHA }, fakten: fk({ head: SHA2 }) })).art, 'warten', 'Kopf seit Frage geändert');
  assert.equal(K.naechsterSchritt(k, sig({ freigabe: { head: SHA }, fakten: fk({ clean: false }) })).art, 'warten');
  for (const basis of ['main', 'master', null]) assert.equal(K.naechsterSchritt(k, sig({ freigabe: { head: SHA }, fakten: fk({ basis }) })).art, 'ende', String(basis));
  assert.equal(K.naechsterSchritt(k, sig({ freigabe: { head: SHA }, fakten: fk({ basis: 'dev' }) })).art, 'ausfuehren');
});
test('Endzustände bewegen sich nie', () => {
  for (const state of ['review', 'abgelehnt', 'abgebrochen', 'fehler'] as const) assert.equal(K.naechsterSchritt({ state, head: SHA }, sig({ freigabe: { head: SHA }, fakten: fk() })).art, 'warten');
});

// ---------- Ablauf mit Fakes ----------
function fakes(over: Partial<import('../server/jirakette.ts').KDeps> = {}) {
  const calls: string[] = [];
  const fragen: any[] = [];
  const st = { strang: 'running', antwort: null as null | { option: string | null; text: string }, freigabe: null as null | { _id: string; head: string }, head: SHA, clean: true, gate: 0 };
  const deps: import('../server/jirakette.ts').KDeps = {
    startOrch: async (_u, inp) => { calls.push(`start:${inp.title}`); st.strang = 'running'; return { id: `s${calls.length}`, cwd: join(T0, 'wt') }; },
    showOrch: async () => ({ status: st.strang }),
    sendOrch: async (_u, id, t) => { calls.push(`send:${id}:${t.slice(0, 20)}`); },
    askKnut: async (_u, inp) => { fragen.push(inp); return { id: `q${fragen.length}` }; },
    frage: async () => (st.antwort ? { status: 'beantwortet', answer: st.antwort } : { status: 'offen', answer: null }),
    freigabe: async () => st.freigabe,
    fakten: () => ({ head: st.head, clean: st.clean, branch: 'x', baseRef: 'origin/develop', commits: [{ sha: st.head, subject: 'feat: a' }], stat: ' a.ts | 1 +' }),
    klon: () => T0, userById: async () => U, browse: (k) => `https://j/browse/${k}`,
    gate: async () => ({ exit: st.gate, out: 'gate out' }),
    push: async (repo, _klon, sha, zweig) => { calls.push(`push:${repo}:${sha.slice(0, 4)}:${zweig}`); },
    draftPr: async (repo, zweig, basis) => { calls.push(`pr:${repo}:${zweig}:${basis}`); return { number: 7, url: 'https://github.com/WirStrom1/r/pull/7' }; },
    kommentar: async (_r, n, t) => { calls.push(`kommentar:${n}:${t}`); },
    gepusht: async (_u, id, pr) => { calls.push(`gepusht:${id}:${pr}`); },
    log: () => {}, ...over };
  return { calls, fragen, st, deps };
}
const ISSUE: any = { key: 'OLAF-5', summary: 'Tarif anzeigen', description: 'Siehe WirStrom1/olaf-tariff-app', type: 'Story', status: 'To Do', labels: [] };
const AKTION = /^(push|pr|kommentar|gepusht):/;

async function bisPushFrage(modus: 'trocken' | 'live', key = 'OLAF-5') {
  const env = { WERKBANK_JIRAKETTE: modus };
  const f = fakes();
  const k = await K.starteKette(U, { issue: { ...ISSUE, key }, site: 'OLAF', note: 'n' }, f.deps, env);
  assert.equal(k.repo, 'WirStrom1/olaf-tariff-app'); assert.equal(k.state, 'plan');
  const doc = async () => (await K.ketten().findOne({ _id: k.id as any })) as any;
  const schritt = async () => K.ketteSchritt(await doc(), f.deps, env);
  assert.equal(await schritt(), 'Plan wird geschrieben');
  f.st.strang = 'done';
  assert.match(await schritt(), /plan\.md fehlt/);
  writeFileSync((await doc()).planPfad, '## Ziel\nTarif zeigen\n## Definition of Done\n- Tarif sichtbar\n');
  assert.equal(await schritt(), 'Plan-Frage gestellt');
  assert.equal(f.fragen.length, 1); assert.match(f.fragen[0].key, /^k-[0-9a-f]{8}#PLAN1$/); assert.equal(f.fragen[0].stufe, 'wichtig');
  assert.match(f.fragen[0].context, /Tarif zeigen/);
  assert.match(await schritt(), /wartet auf Knut/);
  assert.ok(!f.calls.some((c) => c.includes('· Bau')), 'ohne Freigabe kein Bau');
  f.st.antwort = { option: K.OPT_PLAN.frei, text: '' };
  assert.equal(await schritt(), 'Bau gestartet');
  assert.equal((await doc()).state, 'bau');
  assert.equal(await schritt(), 'Bau läuft');
  f.st.strang = 'done';
  assert.equal(await schritt(), 'wartet auf Push-Freigabe');
  assert.equal((await doc()).state, 'push_frage'); assert.equal((await doc()).head, SHA);
  assert.equal(await schritt(), 'wartet auf „Freigeben zum Push“');
  return { f, k, doc, schritt };
}

test('Trockenlauf: Ticket → Plan → Freigabe → Bau → Push-Freigabe → nur Protokoll, nie push/PR/Kommentar', async () => {
  const { f, doc, schritt } = await bisPushFrage('trocken');
  f.st.freigabe = { _id: 'f-1', head: SHA };
  const r = await schritt();
  assert.match(r, /Trockenlauf: würde aaaaaaa nach WirStrom1\/olaf-tariff-app:kette\/olaf-5-tarif-anzeigen pushen und einen Draft-PR gegen develop öffnen/);
  const d = await doc();
  assert.equal(d.state, 'review'); assert.equal(d.pr, null); assert.match(d.trocken, /Nichts gesendet/); assert.match(d.kommentarEntwurf, /no push yet/);
  assert.deepEqual(f.calls.filter((c) => AKTION.test(c)), []);
});

test('live: Gate → Push auf kette/… → Draft-PR gegen develop → @review → Freigabe als gepusht; Reihenfolge fest', async () => {
  const { f, doc, schritt } = await bisPushFrage('live', 'OLAF-15');
  f.st.freigabe = { _id: 'f-1', head: SHA };
  assert.match(await schritt(), /Draft-PR https:\/\/github.com\/WirStrom1\/r\/pull\/7/);
  assert.deepEqual(f.calls.filter((c) => AKTION.test(c)), ['push:WirStrom1/olaf-tariff-app:aaaa:kette/olaf-15-tarif-anzeigen', 'pr:WirStrom1/olaf-tariff-app:kette/olaf-15-tarif-anzeigen:develop', 'kommentar:7:@review', 'gepusht:f-1:https://github.com/WirStrom1/r/pull/7']);
  const d = await doc();
  assert.equal(d.state, 'review'); assert.match(d.kommentarEntwurf, /pull\/7/);
});

test('live: Gate-Befund → kein Push; Kopf ändert sich nach Freigabe → kein Push', async () => {
  const a = await bisPushFrage('live', 'OLAF-16');
  a.f.st.freigabe = { _id: 'f-2', head: SHA }; a.f.st.gate = 1;
  await a.schritt();
  assert.equal((await a.doc()).state, 'fehler'); assert.match((await a.doc()).fehler, /Gate Exit 1/);
  assert.deepEqual(a.f.calls.filter((c) => /^(push|pr):/.test(c)), []);
  const b = await bisPushFrage('live', 'OLAF-17');
  b.f.st.freigabe = { _id: 'f-3', head: SHA }; b.f.st.head = SHA2;
  assert.match(await b.schritt(), /geändert/);
  assert.equal((await b.doc()).state, 'push_frage');
  assert.deepEqual(b.f.calls.filter((c) => /^(push|pr):/.test(c)), []);
});

test('Kette im Modus „trocken“ pusht auch bei Schalter „live“ im Takt nicht, wenn sie als trocken angelegt wurde', async () => {
  const { f, doc, schritt } = await bisPushFrage('trocken', 'OLAF-18');
  f.st.freigabe = { _id: 'f-4', head: SHA };
  const k: any = await doc();
  await K.ketteSchritt(k, f.deps, { WERKBANK_JIRAKETTE: 'live' });
  assert.deepEqual(f.calls.filter((c) => AKTION.test(c)), []);
  void schritt;
});

test('Nachbessern geht an den Plan-Strang, neue Runde, neue Frage mit eigenem Schlüssel; Verwerfen beendet ohne Bau', async () => {
  const env = { WERKBANK_JIRAKETTE: 'trocken' };
  const f = fakes();
  const k = await K.starteKette(U, { issue: { ...ISSUE, key: 'OLAF-6' }, site: 'OLAF' }, f.deps, env);
  const doc = async () => (await K.ketten().findOne({ _id: k.id as any })) as any;
  f.st.strang = 'done';
  writeFileSync((await doc()).planPfad, '## Ziel\nX\n');
  await K.ketteSchritt(await doc(), f.deps, env);
  f.st.antwort = { option: K.OPT_PLAN.nach, text: 'Mehr Tests' };
  assert.equal(await K.ketteSchritt(await doc(), f.deps, env), 'Plan nachgebessert');
  assert.equal((await doc()).state, 'plan'); assert.equal((await doc()).planRunde, 2);
  assert.ok(f.calls.some((c) => c.startsWith('send:')));
  f.st.antwort = null;
  await K.ketteSchritt(await doc(), f.deps, env);
  assert.match(f.fragen[1].key, /#PLAN2$/);
  f.st.antwort = { option: K.OPT_PLAN.weg, text: '' };
  await K.ketteSchritt(await doc(), f.deps, env);
  assert.equal((await doc()).state, 'abgelehnt');
  assert.ok(!f.calls.some((c) => c.includes('· Bau')));
});

test('eine aktive Kette je Ticket; fremdes Repo wird abgelehnt; Abbrechen beendet', async () => {
  const env = { WERKBANK_JIRAKETTE: 'trocken' };
  const f = fakes();
  const k = await K.starteKette(U, { issue: { ...ISSUE, key: 'OLAF-7' }, site: 'OLAF' }, f.deps, env);
  await assert.rejects(K.starteKette(U, { issue: { ...ISSUE, key: 'OLAF-7' }, site: 'OLAF' }, f.deps, env), (e: any) => e.status === 409);
  await assert.rejects(K.starteKette(U, { issue: { ...ISSUE, key: 'OLAF-8' }, site: 'OLAF', repo: 'evil/x' }, f.deps, env), (e: any) => e.status === 400);
  await K.brichAb(U, k.id);
  assert.equal(((await K.ketten().findOne({ _id: k.id as any })) as any).state, 'abgebrochen');
  await assert.rejects(K.brichAb(U, k.id), (e: any) => e.status === 409);
});

test('ketteTick: bei „aus“ passiert nichts', async () => {
  assert.deepEqual(await K.ketteTick(fakes().deps, {}), { geprueft: 0, bewegt: 0 });
});

// ---------- Nach der Gegenprüfung (GLM): Claim, Eindeutigkeit, Idempotenz ----------
test('Claim: zwei gleichzeitige Takte auf derselben Kette führen den Push/PR nur einmal aus', async () => {
  const { f, doc } = await bisPushFrage('live', 'OLAF-30');
  f.st.freigabe = { _id: 'f-9', head: SHA };
  const env = { WERKBANK_JIRAKETTE: 'live' };
  const [a, b] = await Promise.all([K.ketteSchritt(await doc(), f.deps, env), K.ketteSchritt(await doc(), f.deps, env)]);
  assert.equal([a, b].filter((x) => /Draft-PR/.test(x)).length, 1, `${a} | ${b}`);
  assert.equal(f.calls.filter((c) => c.startsWith('pr:')).length, 1);
  assert.equal(f.calls.filter((c) => c.startsWith('push:')).length, 1);
});
test('eine aktive Kette je Ticket auch über Personen hinweg und bei gleichzeitigem Start', async () => {
  const env = { WERKBANK_JIRAKETTE: 'trocken' };
  const f = fakes();
  const r = await Promise.allSettled([1, 2].map((n) => K.starteKette({ ...U, id: `u${n}` }, { issue: { ...ISSUE, key: 'OLAF-31' }, site: 'OLAF' }, f.deps, env)).map((p) => p));
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(r.filter((x) => x.status === 'rejected' && (x.reason as any).status === 409).length, 1);
});
test('Kopf nach der Push-Frage verändert (Freigabe passt zum neuen Kopf): kein Push, weil der gefragte Stand (k.head) nicht mehr gilt', async () => {
  const { f, doc, schritt } = await bisPushFrage('live', 'OLAF-32');
  f.st.head = SHA2; f.st.freigabe = { _id: 'f-10', head: SHA2 };
  assert.match(await schritt(), /geändert/);
  assert.deepEqual(f.calls.filter((c) => AKTION.test(c)), []);
  assert.equal((await doc()).state, 'push_frage');
});
test('Draft-PR liegt schon vor (Neustart nach Fehler) → kein zweiter', async () => {
  const { f, doc, schritt } = await bisPushFrage('live', 'OLAF-33');
  await K.ketten().updateOne({ _id: (await doc())._id }, { $set: { pr: 'https://github.com/WirStrom1/r/pull/3' } });
  f.st.freigabe = { _id: 'f-11', head: SHA };
  await schritt();
  assert.deepEqual(f.calls.filter((c) => AKTION.test(c)), []);
  assert.equal((await doc()).state, 'review');
});
test('repoAusTicket: Dateien mit beliebiger Endung zählen nicht', () => {
  assert.equal(K.repoAusTicket({ labels: [], summary: '', description: 'WirStrom1/anleitung.pdf und WirStrom1/cli.sh' }, ['wirstrom1']), null);
});
