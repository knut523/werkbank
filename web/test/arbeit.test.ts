// Arbeit › Unter-Chats (Plan 213 S4a): Zeile aus der einen Statusquelle, Reihenfolge, Repos nur aus der Konfiguration,
// Start-Eingaben, nächste Paketnummer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { zeile, sortiere, repos, naechstesPaket, startEingabe } from '../server/arbeit.ts';

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
