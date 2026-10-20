// Arbeit › Unter-Chats (Plan 213 S4a): Zeile aus der einen Statusquelle, Reihenfolge, Repos nur aus der Konfiguration,
// Start-Eingaben, nächste Paketnummer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { zeile, sortiere, repos, naechstesPaket, startEingabe, prAus, prZeilen } from '../server/arbeit.ts';

test('S4b: PR aus Kurzform oder Link; „für dich“ zuerst; letzter Review-Lauf je PR', () => {
  assert.deepEqual(prAus('WirStrom1/olaf-admin#354'), { repo: 'WirStrom1/olaf-admin', number: 354 });
  assert.deepEqual(prAus('https://github.com/WirStrom1/tariff-app/pull/210/files'), { repo: 'WirStrom1/tariff-app', number: 210 });
  assert.equal(prAus('olaf-admin#354'), null); assert.equal(prAus('https://evil.example/x/y/pull/1'), null);
  const prs = [
    { pr: 'o/a#1', repo: 'o/a', number: 1, title: 'A', url: 'https://github.com/o/a/pull/1', updatedAt: '2026-10-17T10:00:00Z', turn: { who: 'Christoph', why: 'Review' } },
    { pr: 'o/b#2', repo: 'o/b', number: 2, title: 'B', url: 'javascript:x', updatedAt: '2026-10-16T10:00:00Z', turn: { who: 'Knut', why: 'dein Approve' } },
    { pr: 'o/c#3', repo: 'o/c', number: 3, title: 'C', url: 'https://github.com/o/c/pull/3', updatedAt: '2026-10-15T10:00:00Z', requested: ['knut523'] },
  ];
  const reviews = [{ repo: 'o/b', number: 2, status: 'fehler', createdAt: '2026-10-15' }, { repo: 'o/b', number: 2, status: 'fertig', empfehlung: 'approve', paket: '300-review-b-2', createdAt: '2026-10-16' }];
  const z = prZeilen(prs, reviews, { ich: ['Knut', 'knut523'] });
  assert.deepEqual(z.map((x) => x.pr), ['o/b#2', 'o/c#3', 'o/a#1']);
  assert.equal(z[0].warum, 'dein Approve'); assert.equal(z[0].url, null, 'nur GitHub-Links');
  assert.equal(z[0].review.status, 'fertig', 'der letzte Lauf zählt'); assert.equal(z[0].review.empfehlung, 'approve');
  assert.equal(z[1].warum, 'Review angefragt');
  assert.equal(z[2].fuerDich, false);
});

test('Zeile: Zustand aus dem Status-Takt, alter Status als Rückfall, erledigt nur weggeräumt/abgehakt; keine fremden Links', () => {
  const d = { _id: 'aa000001', title: 'Flex: Fragebogen', zustand: 'stand-fehlt', zustandGrund: 'Antwort ohne Stand', tiefe: 'deep', startedAt: new Date(), url: 'javascript:alert(1)' };
  const z = zeile(d);
  assert.equal(z.zustand, 'stand-fehlt'); assert.equal(z.zustandText, 'Stand fehlt'); assert.equal(z.tiefe, 'deep'); assert.equal(z.chat, null, 'nur http(s)');
  assert.equal(zeile({ _id: 'x', lastStatus: 'waiting' }).zustand, 'wartet');
  assert.equal(zeile({ _id: 'x' }).zustand, 'laeuft');
  assert.equal(zeile({ _id: 'x', zustand: 'fertig', reviewedAt: new Date(), reviewedBy: 'auto' }).zustand, 'erledigt');
  assert.equal(zeile({ _id: 'x', zustand: 'fertig', reviewedAt: new Date(), reviewedBy: 'leitstand' }).zustand, 'fertig', 'vom Hauptchat abgelegt ist nicht erledigt');
  assert.equal(zeile({ _id: 'x', zustand: 'fertig' }).eta, null, 'fertig: keine ETA');
});

test('Reihenfolge: wartet, blockiert, fertig, hängt, Stand fehlt, Schlange, läuft', () => {
  const r = sortiere([{ zustand: 'laeuft', zuletzt: 1 }, { zustand: 'wartet', zuletzt: 1 }, { zustand: 'haengt', zuletzt: 1 }, { zustand: 'blockiert', zuletzt: 2 }, { zustand: 'fertig', zuletzt: 3 }] as any[]);
  assert.deepEqual(r.map((x) => x.zustand), ['wartet', 'blockiert', 'fertig', 'haengt', 'laeuft']);
});

test('Repos nur aus der Konfiguration; Paketnummer fortlaufend; Start prüft Eingaben', () => {
  const t = realpathSync(mkdtempSync(join(tmpdir(), 'arbeit-')));
  mkdirSync(join(t, 'werkbank')); mkdirSync(join(t, 'olaf-admin'));
  const rs = repos({ WERKBANK_ARBEIT_REPOS: `${join(t, 'werkbank')}, ${join(t, 'olaf-admin')},${join(t, 'fehlt')}` });
  assert.deepEqual(rs.map((r) => r.name), ['werkbank', 'olaf-admin'], 'fehlende Ordner fallen weg');
  assert.deepEqual(repos({ WERKBANK_VORBAU_REPOS: join(t, 'werkbank') }).map((r) => r.name), ['werkbank'], 'Rückfall auf die G0-Repos');
  const pk = join(t, 'pakete'); mkdirSync(pk); mkdirSync(join(pk, '212-x')); mkdirSync(join(pk, '7-y')); mkdirSync(join(pk, 'notizen'));
  assert.equal(naechstesPaket(pk, 'Workspace: Ablage für Pakete & Decks'), '213-workspace-ablage-fuer-pakete-decks');
  assert.equal(naechstesPaket(join(t, 'gibtsnicht'), '!!!'), '1-auftrag');
  const e = startEingabe({ auftrag: 'Die Ablage zeigt Pakete nach Status.', repo: 'werkbank', tiefe: 'quick' }, { repos: rs, reviewDir: pk });
  assert.equal(e.cwd, join(t, 'werkbank')); assert.equal(e.tiefe, 'quick'); assert.equal(e.code, true);
  assert.match(e.prompt, /Paket: `~\/work\/knut\/review-pakete\/213-die-ablage-zeigt-pakete-nach-status\/`/);
  assert.throws(() => startEingabe({ auftrag: 'kurz', repo: 'werkbank' }, { repos: rs, reviewDir: pk }), /ein, zwei Sätzen/);
  assert.throws(() => startEingabe({ auftrag: 'Ein Auftrag mit Inhalt.', repo: '../etc' }, { repos: rs, reviewDir: pk }), /Repo aus der Liste/, 'nie ein Pfad aus der Anfrage');
  assert.throws(() => startEingabe({ auftrag: 'Ein Auftrag mit Inhalt.', repo: 'werkbank', tiefe: 'tief' }, { repos: rs, reviewDir: pk }), /Tiefe/);
});
