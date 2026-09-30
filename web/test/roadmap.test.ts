// Roadmap-Sektion: Rangliste, offene Entscheidungen (- Knut:), PR-Bezüge, Konsistenz-Befunde, Rang-Vorschlag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDecisions, fillDecision, parseRankTable, parseReasons, prRefs, parseCheck, addRankProposal } from '../server/roadmap.ts';
import { hashText } from '../server/sprint.ts';

const SPEC = `---
title: "Admin: Rechte-Gruppen"
status: draft
---
# Admin: Rechte-Gruppen

## Offene Entscheidungen

- Einzelrechte je Nutzer zusätzlich zu Gruppen behalten? Empfehlung: **nein** — nur Gruppen;
  ein Sonderfall bekommt eine eigene Gruppe.
  - Knut:
- Nur Erlauben, oder auch Verbieten? Empfehlung: **nur Erlauben**
  - Knut: ja, nur Erlauben
> [!question]- Im Callout
> - Wer verwaltet Gruppen?
>   - Knut:

PR: https://github.com/WirStrom1/olaf-admin/pull/175 und tariff-app #166, admin#207.
`;

test('Offene Entscheidungen: Frage, Abschnitt, offen/beantwortet, auch in Callouts', () => {
  const d = parseDecisions(SPEC);
  assert.equal(d.length, 3);
  assert.match(d[0].question, /^Einzelrechte je Nutzer .* eigene Gruppe\.$/);
  assert.equal(d[0].section, 'Offene Entscheidungen');
  assert.equal(d[0].open, true);
  assert.equal(d[1].open, false);
  assert.equal(d[1].answer, 'ja, nur Erlauben');
  assert.equal(d[2].question, 'Wer verwaltet Gruppen?');
  assert.equal(d[2].open, true);
});

test('Entscheidung beantworten: füllt genau die leere Zeile, Konfliktschutz', () => {
  const d = parseDecisions(SPEC);
  const r = fillDecision(SPEC, d[0].line, 'nein, nur Gruppen', hashText(SPEC));
  assert.equal(r.after, '  - Knut: nein, nur Gruppen');
  assert.equal(r.text.split('\n')[d[0].line - 1], '  - Knut: nein, nur Gruppen');
  assert.equal(r.text.split('\n').length, SPEC.split('\n').length, 'keine Zeile dazu');
  const c = fillDecision(SPEC, d[2].line, 'nur admin', hashText(SPEC));
  assert.equal(c.after, '>   - Knut: nur admin', 'Callout-Präfix bleibt');
  assert.throws(() => fillDecision(SPEC, d[0].line, 'x', 'alt'), /geändert/);
  assert.throws(() => fillDecision(SPEC, d[1].line, 'x', hashText(SPEC)), /schon beantwortet/);
});

const PRIO = `# Priorisierung

## 2 · Rangliste über alle offenen Specs

Text davor.

| Rang | Spec | Thema | Zustand | GW | ZK | RR | CoD | Größe | WSJF | Kat | blockiert durch | nächster Schritt |
|---:|---|---|---|---:|---:|---:|---:|---:|---:|:-:|---|---|
| 1 | [[partnerapi-spec-bff-proxy-allowlist]] | Partner-API | Review · PR offen (tariff-app #166) | 8 | 10 | 10 | 28 | 1 | 28.0 | A | Review #166 | Review, Merge |
| 2 | [[service-view-kundenakte]] | Service | Plan | 5 | 5 | 8 | 18 | 2 | 9.0 | B | nichts | bauen |

### 2.1 · Begründung je Spec

1. **bff-proxy-allowlist** — GW 8: schützt Kundendaten · Größe 1: gebaut.
2. **kundenakte** — GW 5: weil.
`;

test('Rangliste und Begründungen aus der Priorisierungsseite', () => {
  const rows = parseRankTable(PRIO);
  assert.equal(rows.length, 2);
  assert.deepEqual({ ...rows[0], line: undefined }, { rank: 1, spec: 'partnerapi-spec-bff-proxy-allowlist', topic: 'Partner-API', state: 'Review · PR offen (tariff-app #166)', gw: 8, zk: 10, rr: 10, cod: 28, size: 1, wsjf: 28, cat: 'A', blocked: 'Review #166', next: 'Review, Merge', line: undefined });
  const why = parseReasons(PRIO);
  assert.match(why.get('bff-proxy-allowlist')!, /schützt Kundendaten/);
});

test('PR-Bezüge: GitHub-Links und Kurzformen, normalisiert', () => {
  assert.deepEqual(prRefs(SPEC).sort(), ['olaf-admin#175', 'olaf-admin#207', 'olaf-tariff-app#166']);
});

test('Konsistenz-Check: Befunde je Abschnitt aus der Ausgabe von roadmap_check.py', () => {
  const out = `ROOT /x\nspecs per state: {} total 3\n\n[B2] 2 finding(s)\n  ERROR 3-Plan page misses [[a]]\n  WARN  2-Pre-Plan page lists [[b]]\n\n[B4] 1 finding(s)\n  WARN  spec x: no Knut line\n\n1 error(s), 2 warning(s)\n`;
  const c = parseCheck(out);
  assert.equal(c.errors, 1);
  assert.equal(c.warnings, 2);
  assert.deepEqual(c.findings.map((f) => `${f.check}:${f.level}`), ['B2:ERROR', 'B2:WARN', 'B4:WARN']);
});

test('Rang-Vorschlag landet als Zeile im Abschnitt „Vorschläge aus der Werkbank“', () => {
  const a = addRankProposal(PRIO, { spec: 'service-view-kundenakte', from: 2, to: 1, why: 'Kunde wartet', who: 'Knut', date: '29.09.2026' });
  assert.match(a, /\n## Vorschläge aus der Werkbank\n\n- Knut \(29\.09\.2026\): \[\[service-view-kundenakte\]\] Rang 2 → 1 — Kunde wartet\n$/);
  const b = addRankProposal(a, { spec: 'x', from: 5, to: 3, why: '', who: 'Anna', date: '29.09.2026' });
  assert.equal(b.split('## Vorschläge aus der Werkbank').length, 2, 'Abschnitt nur einmal');
  assert.match(b, /- Knut .*\n- Anna \(29\.09\.2026\): \[\[x\]\] Rang 5 → 3\n$/);
});

test('Roadmap nach Thema → Rang, Swimlanes sortiert, „Als Nächstes“, Konsistenz', async () => {
  const { roadmapInsights, KANBAN_STATES } = await import('../server/roadmap.ts');
  const sp = (name: string, topic: string, state: string, tickets: any[] = [], o: any = {}) => ({ name, topic, state, title: name, path: `${topic}/${state}/${name}.md`, tickets, prs: [], jiraKey: tickets.length > 0, ...o });
  const specs = [
    sp('a-eins', 'Admin', '3-Plan', [{ key: 'PM-1', status: 'To Do' }]),
    sp('a-zwei', 'Admin', '1-Backlog'),
    sp('a-drei', 'Admin', '2-Pre-Plan'),                                   // nicht priorisiert
    sp('s-live', 'Service', '5-Live', [{ key: 'PM-2', status: 'In Progress' }]),   // Widerspruch: live, Ticket offen
    sp('s-plan', 'Service', '3-Plan', [{ key: 'PM-3', status: 'Done' }]),          // umgekehrt: Ticket erledigt, Spec Plan
    sp('s-rev', 'Service', '4-Review', [{ key: 'PM-4', status: 'In Progress' }]),
    sp('s-bl', 'Service', '1-Backlog', [{ key: 'PM-5', status: 'To Do' }]),
  ];
  const ranking = [
    { rank: 1, spec: 's-rev', topic: 'Service' }, { rank: 2, spec: 'a-zwei', topic: 'Admin' }, { rank: 3, spec: 's-bl', topic: 'Service' },
    { rank: 4, spec: 'a-eins', topic: 'Admin' }, { rank: 5, spec: 's-plan', topic: 'Service' }, { rank: 9, spec: 'weg', topic: 'Service' },
  ] as any[];
  const r = roadmapInsights(specs as any, ranking, { sprintTickets: new Set(['PM-1']) });
  assert.deepEqual(r.prioTopics.map((t) => t.topic), ['Service', 'Admin'], 'Thema mit bestem Rang zuerst');
  assert.deepEqual(r.prioTopics[1].ranked.map((x: any) => x.spec), ['a-zwei', 'a-eins']);
  assert.deepEqual(r.prioTopics[1].unranked.map((x: any) => x.name), ['a-drei']);
  assert.deepEqual(r.prioTopics[0].ranked.map((x: any) => x.spec), ['s-rev', 's-bl', 's-plan', 'weg'], 'Rang ohne Spec-Datei bleibt beim Thema aus der Tabelle');
  assert.deepEqual(KANBAN_STATES, ['1-Backlog', '2-Pre-Plan', '3-Plan', '4-Review', '5-Live']);
  const admin = r.lanes.find((l) => l.topic === 'Admin')!;
  assert.deepEqual(admin.states['3-Plan'].map((x: any) => x.name), ['a-eins']);
  assert.equal(admin.states['1-Backlog'][0].rank, 2);
  // Als Nächstes: nicht in Arbeit (kein Review/Live, kein Ticket In Progress/Done), Sprint-Zuordnung zuerst (a-eins via PM-1)
  assert.deepEqual(r.nextUp.map((x: any) => x.spec), ['a-eins', 'a-zwei', 's-bl']);
  assert.equal(r.nextUp[0].inSprint, true);
  const kinds = r.consistency.map((c: any) => `${c.spec}:${c.kind}`).sort();
  assert.deepEqual(kinds, ['s-live:Spec live, Ticket offen', 's-plan:Ticket erledigt, Spec nicht in Review/Live', 's-rev:Spec in Review, Ticket offen'].sort());
  assert.deepEqual(r.withoutJira.map((x: any) => x.name).sort(), ['a-drei', 'a-zwei']);
});

test('Spec-Ordnung: Regel-Check je Spec (Frontmatter, jira:, Ziel, DoD, Knut-Zeilen, Rang, Konsistenz, Übersicht, Alter)', async () => {
  const { specChecks, specTemplate, domainOf, stateSlug } = await import('../server/roadmap.ts');
  const text = `---\ntitle: "x"\ntype: reference\nteam: olaf\narea: product\ndomain: Service\nlifecycle: plan\nstatus: current\ncreated: 2026-09-01\nlast-verified: 2026-09-20\ntags: [roadmap]\nsources: []\njira: [PM-1]\nziel: KR1\n---\n# x\n## Definition of Done\n- a\n## Offene Punkte\n- Frage? Empfehlung: ja\n  - Knut:\n`;
  const fm = { title: 'x', type: 'reference', team: 'olaf', area: 'product', domain: 'Service', lifecycle: 'plan', status: 'current', created: '2026-09-01', 'last-verified': '2026-09-20', tags: ['roadmap'], sources: [], jira: ['PM-1'], ziel: 'KR1' };
  const sp = { name: 'service-spec-a', path: 'p', topic: 'Service-View', state: '3-Plan', fm, text, tickets: ['PM-1'], prs: [], goals: ['KR1'] };
  const c = specChecks(sp as any, { rank: 4, overviewText: 'Plan: [[service-spec-a]]', consistency: [], ticketGoals: [], today: '2026-09-30' });
  assert.deepEqual({ fm: c.fm.ok, jira: c.jira, goal: c.goal, dod: c.dod, open: c.openDecisions, rank: c.rank, consistent: c.consistent, inOverview: c.inOverview, age: c.age }, { fm: true, jira: true, goal: { ok: true, via: 'ziel:', ids: ['KR1'] }, dod: true, open: 1, rank: 4, consistent: true, inOverview: true, age: 10 });
  const bad = specChecks({ ...sp, state: '4-Review', fm: { title: 'x' }, text: '# x', goals: [] } as any, { rank: null, overviewText: '', consistency: [{ kind: 'Spec in Review, Ticket offen' }], ticketGoals: ['KR2'], today: '2026-09-30' });
  assert.equal(bad.fm.ok, false);
  assert.ok(bad.fm.missing.includes('lifecycle') && bad.fm.missing.includes('domain'));
  assert.equal(bad.jira, false);
  assert.deepEqual(bad.goal, { ok: true, via: 'Ticket', ids: ['KR2'] });
  assert.equal(bad.dod, false);
  assert.equal(bad.consistent, false);
  assert.equal(bad.inOverview, false);
  const drift = specChecks({ ...sp, state: '2-Pre-Plan' } as any, { rank: 4, overviewText: '', consistency: [], ticketGoals: [], today: '2026-09-30' });
  assert.ok(drift.fm.problems.some((p: string) => /lifecycle/.test(p)), 'lifecycle ≠ Ordner');
  assert.equal(domainOf('Service-View'), 'Service');
  assert.equal(stateSlug('2-Pre-Plan'), 'pre-plan');
  const t = specTemplate({ topic: 'Anmeldestrecke', state: '1-Backlog', title: 'Neu', goal: 'KR4', jira: 'PM-5', today: '2026-09-30', overview: '0-anmeldestrecke-uebersicht' });
  for (const h of ['## Befund', '## Umsetzung', '## Messung', '## Definition of Done', '## Offene Punkte', '  - Knut:', 'lifecycle: backlog', 'domain: Anmeldestrecke', 'ziel: KR4', 'jira: [PM-5]', 'status: draft']) assert.ok(t.includes(h), h);
  assert.ok(!specTemplate({ topic: 'Cockpit', state: '1-Backlog', title: 'N', today: '2026-09-30' }).includes('## Messung'), 'Messung nur Anmeldestrecke');
});
