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
