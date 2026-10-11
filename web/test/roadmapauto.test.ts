// Roadmap-Automatik (docs/plan-roadmap-automatik.md): Feed, Drossel, Protokoll-Fragen, Freigaben, Markerblock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeed, prLinks, newQueue, takeDue, parseSyncQuestions, doneIds, notDone, textKey, renderApprovals, replaceWorkBlock, draftBody, WORK_START, WORK_END } from '../server/roadmapauto.ts';

const now = new Date('2026-10-08T10:00:00Z');

test('Feed: geänderte offene Tickets, erledigte, Läufe und Projekte — keine Beschreibungen', () => {
  const md = buildFeed({
    now,
    issues: [
      { key: 'PM-1', summary: 'Neu | mit Pipe', status: 'In Progress', assignee: 'Knut Peters', duedate: '2026-10-10', updated: '2026-10-07T09:00:00Z', type: 'Task', workstream: 'PM-70' },
      { key: 'PM-2', summary: 'Alt', status: 'To Do', assignee: null, duedate: null, updated: '2026-09-01T09:00:00Z', type: 'Task' },
      { key: 'PM-3', summary: 'Fertig', status: 'Done', statusCategory: 'Done', assignee: 'Christoph', duedate: null, updated: '2026-10-08T08:00:00Z', type: 'Task' },
      { key: 'PM-70', summary: 'Produkt', status: 'Ongoing', assignee: null, duedate: null, updated: '2026-10-08T08:00:00Z', type: 'Workstream' },
    ],
    runs: [{ key: 'PM-1', projectName: 'Prefill', finishedAt: '2026-10-08T07:00:00Z', vaultNotes: ['olaf/x.md'], prs: ['https://github.com/WirStrom1/olaf-admin/pull/290'] },
      { key: 'PM-9', finishedAt: '2026-09-01T07:00:00Z', vaultNotes: [], prs: [] }],
    projects: [{ name: 'Prefill', workstream: 'PM-70', tickets: ['PM-1'] }],
  });
  assert.match(md, /\| PM-1 \| In Progress \| Knut Peters \| 2026-10-10 \| PM-70 \| Neu \/ mit Pipe \|/);
  assert.match(md, /\| PM-3 \| Done \|/);
  assert.doesNotMatch(md, /PM-2 \|/, 'nicht kürzlich geändert');
  assert.doesNotMatch(md, /\| PM-70 \| Ongoing/, 'Workstreams nicht als Ticket');
  assert.match(md, /- PM-1 · 2026-10-08 · Projekt „Prefill“ · Vault: `olaf\/x.md` · PRs: https:\/\/github.com\/WirStrom1\/olaf-admin\/pull\/290/);
  assert.doesNotMatch(md, /PM-9/, 'alter Lauf fällt raus');
  assert.match(md, /- PM-70: Prefill \(PM-1\)/);
});

test('PR-Links ohne Doppel', () => {
  assert.deepEqual(prLinks('siehe https://github.com/WirStrom1/olaf-admin/pull/1 und https://github.com/WirStrom1/olaf-admin/pull/1, https://github.com/a/b/pull/22.'),
    ['https://github.com/WirStrom1/olaf-admin/pull/1', 'https://github.com/a/b/pull/22']);
});

test('Planer: Tickets gedrosselt (20 min), voller Lauf nach Ja (5 min), nichts geht bei Sperre verloren', () => {
  const T = 1_790_000_000_000, min = 60_000;
  const q = newQueue();
  assert.equal(takeDue(q, T, false), null, 'leer');
  q.pending.add('PM-2'); q.pending.add('PM-1');
  assert.equal(takeDue(q, T, true), null, 'Sperre belegt');
  assert.deepEqual([...q.pending].sort(), ['PM-1', 'PM-2'], 'Tickets bleiben liegen');
  assert.deepEqual(takeDue(q, T, false), { scope: ['PM-1', 'PM-2'] });
  q.pending.add('PM-3');
  assert.equal(takeDue(q, T + 10 * min, false), null, 'zu früh für Tickets');
  q.full = true;
  assert.equal(takeDue(q, T + 3 * min, false), null, 'zu früh für den vollen Lauf');
  assert.deepEqual(takeDue(q, T + 6 * min, false), { scope: null }, 'voller Lauf nach 5 min');
  assert.equal(q.pending.size, 0, 'der volle Lauf deckt PM-3 mit ab');
  assert.equal(q.full, false);
});

const PROTOCOL = `# Protokoll

## 2026-10-08 07:30

**Geänderte Dateien:**
- a.md

**Offen/unklar:**
- (1) **Review → Live** für 23 Specs.
- (2) **Cockpit-Zeilen** löschen:
  - Zeile A;
  - Zeile B.

  Mit Knut neu schreiben.

## 2026-10-08 09:10 · Nachzug PM-1

**Geänderte Dateien:**
- b.md

**Offen/unklar:**
- keine

## 2026-10-08 09:40 · Nachzug PM-2

**Offen/unklar:**
- (1) **PM-2:** Spec nach Review.
`;

test('Fragen: letzter regulärer Lauf plus spätere Nachzüge; „keine“ ist keine Frage', () => {
  const qs = parseSyncQuestions(PROTOCOL);
  assert.equal(qs.length, 3);
  assert.equal(qs[0].section, '2026-10-08 07:30', 'ein Nachzug verdrängt den Morgenlauf nicht');
  assert.equal(qs[2].section, '2026-10-08 09:40'); assert.match(qs[2].text, /PM-2/);
  assert.ok(!qs.some((q) => /^keine/.test(q.text)), '„- keine“ wird keine Frage');
  assert.equal(qs[0].key, textKey('**Review → Live** für 23 Specs.'));
  assert.equal(qs[1].n, '2');
  assert.match(qs[1].text, /Cockpit-Zeilen.*Zeile A; - Zeile B\. Mit Knut neu schreiben\./);
  assert.match(qs[0].id, /^S[0-9a-f]{10}$/);
  assert.notEqual(qs[0].id, qs[1].id);
  // Gleicher Text in einem späteren Lauf → neue Kennung.
  const later = PROTOCOL + '\n## 2026-10-08 13:30\n\n**Offen/unklar:**\n- (1) **Review → Live** für 23 Specs.\n';
  const q2 = parseSyncQuestions(later);
  assert.equal(q2.length, 1, 'ein neuer regulärer Lauf ersetzt die alten Fragen');
  assert.notEqual(q2[0].id, qs[0].id); assert.equal(q2[0].key, qs[0].key, 'gleicher Text → gleicher Schlüssel (für „Nein“)');
  assert.deepEqual(parseSyncQuestions('## 2026-10-08 07:30\n\nOffen/unklar: keine\n'), []);
  assert.deepEqual(parseSyncQuestions(PROTOCOL + '\n## 2026-10-08 13:30\n\n**Geänderte Dateien:**\n- c.md\n').map((q) => q.text), [], 'neuer regulärer Lauf ohne Offenes → alte Fragen überholt');
  assert.deepEqual(parseSyncQuestions('## 2026-10-08 07:30\n\n**Offen/unklar:**\n- keine offenen Punkte.\n'), []);
  assert.deepEqual(parseSyncQuestions('## 2026-10-08 07:30\n\n**Offen/unklar:** Eine Frage in der Zeile.\n').map((q) => q.text), ['Eine Frage in der Zeile.']);
  assert.deepEqual(parseSyncQuestions('# leer\n'), []);
});

test('Erledigt-Kennungen und Freigabe-Datei', () => {
  const p = ['erledigt: S0123456789', '- **erledigt:** `Sabcdefabcd` (a.md)', 'Erledigt – S1111111111', 'nicht erledigt: S9999999999 — Datei fehlt', '**nicht erledigt:** `S2222222222`'].join('\n');
  assert.deepEqual([...doneIds(p)], ['S0123456789', 'Sabcdefabcd', 'S1111111111'], 'Schreibweisen mit Backticks/fett; „nicht erledigt“ bleibt offen');
  assert.deepEqual([...notDone(p)], [['S9999999999', 'Datei fehlt'], ['S2222222222', '']]);
  const multi = 'erledigt: S0123456789 — a.md; erledigt: S1111111111 — b.md\nerledigt: S2222222222, `S3333333333`\nerledigt: S4444444444 — a.md; nicht erledigt: S5555555555 — Grund';
  assert.deepEqual([...doneIds(multi)], ['S0123456789', 'S1111111111', 'S2222222222', 'S3333333333', 'S4444444444']);
  assert.deepEqual([...notDone(multi)], [['S5555555555', 'Grund']]);
  const md = renderApprovals([{ id: 'S0123456789', text: 'Zeilen löschen', at: '2026-10-08T10:00:00Z', by: 'knut@example.test' }]);
  assert.match(md, /## Freigegeben\n\n- S0123456789 \(2026-10-08, knut@example.test\): Zeilen löschen/);
  assert.match(renderApprovals([]), /## Freigegeben\n\n- keine/);
  assert.match(renderApprovals([], ['Zeilen löschen']), /## Verworfen — nicht wieder unter „Offen\/unklar“ vorschlagen\n\n- Zeilen löschen/);
});

test('Markerblock: ersetzt genau den Block, sonst nichts schreiben', () => {
  const hub = `# Hub\n\n## Woran\n\n${WORK_START}\nalt\n${WORK_END}\n\n## Rest\nbleibt\n`;
  assert.equal(replaceWorkBlock(hub, 'neu\n'), `# Hub\n\n## Woran\n\n${WORK_START}\nneu\n${WORK_END}\n\n## Rest\nbleibt\n`);
  assert.equal(replaceWorkBlock('# ohne Marker', 'x'), null);
  assert.equal(replaceWorkBlock(`${WORK_START}\n${WORK_START}\n${WORK_END}`, 'x'), null, 'doppelt');
  assert.equal(replaceWorkBlock(`${WORK_END}\n${WORK_START}`, 'x'), null, 'vertauscht');
  assert.equal(draftBody('---\ntype: working\n---\n\nText\n'), 'Text');
});
