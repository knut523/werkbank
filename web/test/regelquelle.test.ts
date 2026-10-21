// Release 20b, Plan 274 Zusatz A/B (Knut 20.10.2026: „Regeltreue verbessern, neue Regeln von Christoph sollen automatisch
// reinkommen“): PR-Ticker → reviews-neu.jsonl → regel-vorschlag.sh → Rückfrage „Übernehmen“ → regeln-bestaetigt.jsonl; dazu die
// Pflicht-Prüfschritte vor „fertig“ im Strang-Brief. Eigene Test-Mongo, eigene Wegwerf-Ordner (nie ~/work/knut/tools).
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MongoClient } from 'mongodb';

const tag = randomBytes(4).toString('hex');
process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_test_regel_${tag}`;
delete process.env.WERKBANK_REGEL_DIR;

const R = await import('../server/regelquelle.ts');
const O = await import('../server/orchestrator.ts');
const db = await import('../server/db.ts');

let raw: MongoClient;
before(async () => { await db.connect(); raw = await MongoClient.connect(TEST_MONGO); });
after(async () => { await raw.db(process.env.WERKBANK_DB).dropDatabase(); await raw.close(); process.exit(0); });

const u = { id: '6a1b2c3d4e5f60718293a4b5', email: 'knut@maxenergy.at', name: 'Knut Peters', role: 'ADMIN' } as any;
const T0 = 1_760_000_000_000;

const prFix = [{
  number: 368, title: 'fix(service): word search', url: 'https://github.com/WirStrom1/olaf-admin/pull/368', repository: { nameWithOwner: 'WirStrom1/olaf-admin' },
  reviews: { nodes: [
    { id: 'R1', author: { login: 'BizarroChris' }, body: 'Plan per Slug zitieren, nicht per Nummer.', state: 'CHANGES_REQUESTED', submittedAt: '2026-10-20T10:00:00Z', url: 'u1', comments: { nodes: [{ path: 'plans/x.md', line: 3, body: 'Plan 092 → Slug' }, { path: 'a.ts', line: null, originalLine: 7, body: 'alt' }] } },
    { id: 'R2', author: { login: 'bizarrochris' }, body: '', state: 'APPROVED', submittedAt: '2026-10-20T11:00:00Z', url: 'u2', comments: { nodes: [] } },
    { id: 'R3', author: { login: 'knut523' }, body: 'eigenes', state: 'COMMENTED', submittedAt: '2026-10-20T11:00:00Z', url: 'u3' },
    { id: 'R4', author: { login: 'fremder' }, body: 'nicht auf der Liste', state: 'COMMENTED', submittedAt: '2026-10-20T11:00:00Z', url: 'u4' },
    { id: 'R5', author: { login: 'bizarrochris' }, body: 'zu alt', state: 'COMMENTED', submittedAt: '2026-10-19T08:00:00Z', url: 'u5' },
  ] },
  comments: { nodes: [{ id: 'C1', author: { login: 'bizarrochris' }, body: 'Bitte keine generierten Dateien committen.', createdAt: '2026-10-20T12:00:00Z', url: 'c1' }] },
}];

test('A: Reviews/Kommentare der Erlaubtliste als Zeilen wie christoph-reviews-30d.jsonl (repo, pr, title, art, state, at, body, inline[])', () => {
  const z = R.regelZeilen(prFix, '2026-10-20T00:00:00Z', ['bizarrochris'], 'knut523');
  assert.deepEqual(z.map((x) => x.id), ['R1', 'C1'], 'leeres Approve, eigene, fremde und alte nicht');
  assert.deepEqual(Object.keys(z[0]).slice(0, 8), ['repo', 'pr', 'title', 'art', 'state', 'at', 'body', 'inline']);
  assert.equal(z[0].repo, 'olaf-admin'); assert.equal(z[0].pr, 368); assert.equal(z[0].art, 'review'); assert.equal(z[0].state, 'CHANGES_REQUESTED');
  assert.deepEqual(z[0].inline, [{ path: 'plans/x.md', line: 3, body: 'Plan 092 → Slug' }, { path: 'a.ts', line: 7, body: 'alt' }]);
  assert.equal(z[1].art, 'kommentar'); assert.deepEqual(z[1].inline, []);
});

test('A: Anhängen genau einmal je Kennung; ohne WERKBANK_REGEL_DIR aus (Tests schreiben nie in Knuts Datei)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-20b-gate-'));
  const datei = join(dir, 'quellen', 'reviews-neu.jsonl');
  const z = R.regelZeilen(prFix, '2026-10-20T00:00:00Z', ['bizarrochris'], 'knut523');
  assert.equal(await R.regelAnhaengen(z, new Date(), datei), 2);
  assert.equal(await R.regelAnhaengen(z, new Date(), datei), 0, 'Überlappung des Tickers: nichts doppelt');
  const zeilen = readFileSync(datei, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(zeilen.length, 2); assert.equal(zeilen[0].body, 'Plan per Slug zitieren, nicht per Nummer.');
  assert.equal(R.regelDir({}), null);
  assert.equal(R.reviewsNeuDatei({}), null);
  assert.equal(await R.regelAnhaengen(z, new Date()), 0, 'Vorgabe ohne Ordner: aus');
});

test('A: Vorschläge lesen — JSON-Liste, { vorschlaege }, „VORSCHLAG:“-Zeilen; Kennung stabil; Takt', () => {
  assert.deepEqual(R.parseVorschlaege('[{"titel":"Plan per Slug","regel":"Pläne per Slug zitieren","begruendung":"PR 368"}]'), [{ titel: 'Plan per Slug', regel: 'Pläne per Slug zitieren', begruendung: 'PR 368' }]);
  assert.equal(R.parseVorschlaege('{"vorschlaege":[{"title":"x","text":"y"}]}')[0].regel, 'y');
  assert.deepEqual(R.parseVorschlaege('Kopf\nVORSCHLAG: Keine generierten Dateien — next-env.d.ts nie committen\nrest').map((v) => v.titel), ['Keine generierten Dateien']);
  assert.deepEqual(R.parseVorschlaege(''), []);
  assert.equal(R.vorschlagKey({ titel: 'a', regel: 'Pläne  per Slug' }), R.vorschlagKey({ titel: 'b', regel: 'pläne per slug' }));
  assert.match(R.vorschlagKey({ titel: 'a', regel: 'x' }), /^regel-[0-9a-f]{12}#R$/);
  assert.equal(R.vorschlagFaellig(0, new Date(T0), T0 + 3600_000), false);
  assert.equal(R.vorschlagFaellig(1, new Date(T0), T0 + 3600_000), true, 'neue Zeilen → sofort');
  assert.equal(R.vorschlagFaellig(0, new Date(T0), T0 + 25 * 3600_000), true, 'sonst einmal am Tag');
});

test('A: Lauf ruft regel-vorschlag.sh, je neuem Vorschlag eine Rückfrage, eine Meldung im Hauptchat; „Übernehmen“ schreibt regeln-bestaetigt.jsonl', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-20b-gate-'));
  mkdirSync(join(dir, 'quellen'));
  writeFileSync(join(dir, 'quellen', 'reviews-neu.jsonl'), '{}\n');
  const skript = join(dir, 'regel-vorschlag.sh');
  writeFileSync(skript, '#!/bin/sh\necho \'[{"titel":"Plan per Slug","regel":"Pläne per Slug zitieren, nie per Nummer"}]\'\n');
  chmodSync(skript, 0o755);
  const env = { ...process.env, WERKBANK_REGEL_DIR: dir };
  const fragen: string[] = [], meldungen: string[] = [];
  const deps = { frage: async (_v: any, key: string) => (fragen.includes(key) ? null : (fragen.push(key), `q-${fragen.length}`)), melde: async (t: string) => { meldungen.push(t); } };
  const r1 = await R.regelVorschlaege(deps, { neu: 1, env });
  assert.equal(r1.lauf, true); assert.deepEqual(r1.neu, ['q-1']);
  assert.equal(meldungen.length, 1); assert.match(meldungen[0], /1 neue Regel-Vorschläge.*Übernehmen/);
  assert.equal((await R.regelVorschlaege(deps, { neu: 0, env })).lauf, false, 'ohne neue Zeilen erst morgen wieder');
  assert.deepEqual((await R.regelVorschlaege(deps, { neu: 2, env })).neu, [], 'derselbe Vorschlag: keine zweite Rückfrage');
  assert.equal(meldungen.length, 1);
  process.env.WERKBANK_REGEL_DIR = dir;
  try {
    const q = await O.askKnut(u, { title: 'Regel-Vorschlag: Plan per Slug', context: 'x', recommendation: 'Übernehmen', options: [{ label: 'Übernehmen' }, { label: 'Verwerfen' }], key: fragen[0], quelle: 'regel' });
    await O.questions().updateOne({ _id: q.id as any }, { $set: { kind: 'regel-vorschlag', regel: { titel: 'Plan per Slug', regel: 'Pläne per Slug zitieren, nie per Nummer' } } });
    const a: any = await O.answerQuestion(u, q.id, { option: 'Übernehmen' });
    assert.equal(a.action, 'übernommen');
    const best = JSON.parse(readFileSync(join(dir, 'quellen', 'regeln-bestaetigt.jsonl'), 'utf8').trim());
    assert.equal(best.regel, 'Pläne per Slug zitieren, nie per Nummer'); assert.equal(best.key, fragen[0]); assert.equal(best.von, u.email);
  } finally { delete process.env.WERKBANK_REGEL_DIR; }
  assert.equal((await R.regelVorschlaege(deps, { neu: 5, env: { WERKBANK_REGEL_DIR: mkdtempSync(join(tmpdir(), 'wb-20b-leer-')) } })).lauf, false, 'ohne Skript: kein Lauf');
});

test('B: Strang-Brief verlangt vor „fertig“ AGENTS.md, olaf-feedback-check mit Beleg je Punkt, Checkliste des Pre-Push-Gates — Ergebnis im Stand-Block', () => {
  const b = O.orchBrief({ title: 'Code', prompt: 'baue x', cwd: '/tmp/x' });
  assert.match(b, /Pflicht vor „Status: fertig“ bei Code- oder Doku-Arbeit/);
  assert.match(b, /`AGENTS\.md` des Repos/);
  assert.match(b, /olaf-docs\/AGENTS\.md/);
  assert.match(b, /`olaf-feedback-check`.*je Punkt ein Beleg/);
  assert.match(b, /pre-push-gate\.sh --checkliste/);
  assert.match(b, /nicht still überspringen/);
  const stand = b.slice(b.indexOf('### Stand'));
  assert.ok(stand.indexOf('- Regeln:') > 0 && stand.indexOf('- Regeln:') < stand.indexOf('Status: fertig |'), 'Zeile „Regeln:“ im Stand-Block vor „Status:“');
  assert.equal(O.statusMark(stand.replace('Status: fertig | braucht Antwort | blockiert', 'Status: fertig')), 'fertig', 'Marke bleibt lesbar');
});
