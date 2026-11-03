// S21 (Paket 436, Knut 03.11.: „die Zahl ehrlich klein — nichts fälschlich schließen“): Freigaben, deren Stand schon auf GitHub
// gemergt ist, zählen nicht mehr — mit Beleg, jedes Mal neu gerechnet (nichts wird in der Datenbank geschlossen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ueberholteFreigaben } from '../server/ueberholt.ts';

const push = (id: string, repo: string, zweig: string, commit: string, seit: string) =>
  ({ id: `p-${id}-${commit.slice(0, 7)}`, art: 'push', frage: 'Push freigeben', empfehlung: null, quelle: { text: repo, strand: id, url: null }, wartetSeit: seit, blockiert: 1, antworten: ['ja'], daten: { strand: id, repo, zweig, commit } }) as any;
const prs = [
  { pr: 'WirStrom1/olaf-admin#387', head: 'aaaaaaa1111', state: 'MERGED', at: '2026-11-01T10:00:00Z' },
  { pr: 'WirStrom1/olaf-admin#390', head: 'ccccccc3333', state: 'CLOSED', at: '2026-11-01T10:00:00Z' },
  { pr: 'WirStrom1/olaf-admin#381', head: 'ddddddd4444', state: 'MERGED', at: '2026-11-01T10:00:00Z' },
];

test('Regel 1: Commit ist Kopf eines gemergten PRs → überholt, mit PR als Beleg', () => {
  const u = ueberholteFreigaben([push('11111111', 'WirStrom1/olaf-admin', 'feat/x', 'aaaaaaa1111', '2026-10-31T10:00:00Z')], prs);
  assert.deepEqual(u.map((x) => x.id), ['p-11111111-aaaaaaa']);
  assert.match(u[0].grund, /gemergt/); assert.equal(u[0].beleg, 'WirStrom1/olaf-admin#387');
});

test('Regel 2: älterer Stand auf demselben, inzwischen gemergten Zweig → überholt; neuerer Stand nach dem Merge nicht', () => {
  const e = [push('11111111', 'WirStrom1/olaf-admin', 'feat/x', 'aaaaaaa1111', '2026-10-31T10:00:00Z'),
    push('22222222', 'WirStrom1/olaf-admin', 'feat/x', 'bbbbbbb2222', '2026-10-30T10:00:00Z'),
    push('33333333', 'WirStrom1/olaf-admin', 'feat/x', 'eeeeeee5555', '2026-11-02T10:00:00Z')];
  assert.deepEqual(ueberholteFreigaben(e, prs).map((x) => x.id).sort(), ['p-11111111-aaaaaaa', 'p-22222222-bbbbbbb']);
});

test('Nie: geschlossene (nicht gemergte) PRs, Dauerzweige (develop/main) für Regel 2, anderes Repo, fehlende Daten', () => {
  const e = [push('44444444', 'WirStrom1/olaf-admin', 'feat/y', 'ccccccc3333', '2026-10-31T10:00:00Z'),
    push('55555555', 'WirStrom1/olaf-admin', 'develop', 'ddddddd4444', '2026-10-31T10:00:00Z'),
    push('66666666', 'WirStrom1/olaf-admin', 'develop', 'fffffff6666', '2026-10-30T10:00:00Z'),
    push('77777777', 'WirStrom1/andere', 'feat/x', 'bbbbbbb2222', '2026-10-30T10:00:00Z'),
    { ...push('88888888', 'WirStrom1/olaf-admin', 'feat/x', 'xxxxxxx', '2026-10-30T10:00:00Z'), daten: {} }];
  assert.deepEqual(ueberholteFreigaben(e, prs).map((x) => x.id), ['p-55555555-ddddddd'], 'nur Regel 1 auf develop');
});

test('Nur Freigaben — Entscheidungen und Rückfragen bleiben unberührt', () => {
  const e = [{ ...push('11111111', 'WirStrom1/olaf-admin', 'feat/x', 'aaaaaaa1111', '2026-10-31T10:00:00Z'), art: 'rueckfrage' }];
  assert.deepEqual(ueberholteFreigaben(e, prs), []);
});

test('Pass C (H1/M1): nur derselbe Repo zählt — gleicher Commit-Anfang oder Zweig in einem anderen Repo (Fork) macht nichts überholt', () => {
  const fremd = [{ pr: 'Andere/olaf-admin#5', head: 'aaaaaaa1111', state: 'MERGED', at: '2026-11-01T10:00:00Z' }];
  const e = [push('11111111', 'WirStrom1/olaf-admin', 'feat/x', 'aaaaaaa1111', '2026-10-31T10:00:00Z'), push('22222222', 'WirStrom1/olaf-admin', 'feat/x', 'bbbbbbb2222', '2026-10-30T10:00:00Z')];
  assert.deepEqual(ueberholteFreigaben(e, fremd), []);
  assert.deepEqual(ueberholteFreigaben([push('33333333', 'WirStrom1/olaf-admin', 'feat/x', 'aaaaaaa1111ffff', '2026-10-31T10:00:00Z')], prs), [], 'der Freigabe-Commit ist länger und passt nicht zum Kopf');
});

test('Pass C (H2): fehlt die Merge-Zeit, gilt Regel 2 nicht (nie „jetzt“ annehmen) — Regel 1 schon', () => {
  const ohneZeit = [{ pr: 'WirStrom1/olaf-admin#387', head: 'aaaaaaa1111', state: 'MERGED', at: null }];
  const e = [push('11111111', 'WirStrom1/olaf-admin', 'feat/x', 'aaaaaaa1111', '2026-10-31T10:00:00Z'), push('22222222', 'WirStrom1/olaf-admin', 'feat/x', 'bbbbbbb2222', '2026-10-30T10:00:00Z')];
  assert.deepEqual(ueberholteFreigaben(e, ohneZeit).map((x) => x.id), ['p-11111111-aaaaaaa']);
});
