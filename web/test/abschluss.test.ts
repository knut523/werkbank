// R29 D / S2 (Paket 159 V2): review_ready prüft den Bericht, statt das Format nur zu erbitten. Schalter WERKBANK_ABSCHLUSS_PRUEFEN, Vorgabe aus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abschlussAn, abschlussProblem } from '../server/abschluss.ts';

const KOPF = (extra = '') => `---
status: wartet_auf_knut
titel: Es geht jetzt
worum: Ausgangslage und Ziel.
anders:
  - Etwas ist anders
${extra}---
`;
const MERMAID = '\n```mermaid\nflowchart LR\n  A --> B\n```\n';
const GUT = KOPF() + '# Bericht\n' + MERMAID;

test('Schalter: Vorgabe aus', () => {
  assert.equal(abschlussAn({}), false);
  assert.equal(abschlussAn({ WERKBANK_ABSCHLUSS_PRUEFEN: 'on' }), true);
});

test('kein Bericht gefunden → nichts zu prüfen', () => {
  assert.equal(abschlussProblem(null), null);
});

test('guter Bericht → kein Problem', () => {
  assert.equal(abschlussProblem(GUT), null);
});

test('fehlender YAML-Kopf → Problem mit Beispiel', () => {
  const p = abschlussProblem('# Bericht\nText');
  assert.match(String(p), /YAML-Kopf fehlt/);
  assert.match(String(p), /status: wartet_auf_knut/);
});

test('kaputter Kopf → der Fehler des Parsers', () => {
  assert.match(String(abschlussProblem('---\nstatus: kaputt\n---\n')), /status muss/);
});

test('Mängel der Exec Summary (kein Diagramm, kein worum) werden genannt', () => {
  const p = String(abschlussProblem('---\nstatus: wartet_auf_knut\ntitel: T\nanders: [a]\n---\ntext'));
  assert.match(p, /worum/);
  assert.match(p, /Mermaid/);
});

test('Frage im Kopf ohne Empfehlung → Problem', () => {
  const p = abschlussProblem(KOPF('fragen:\n  - id: D1\n    frage: Soll ich?\n    antwort: ""\n') + MERMAID);
  assert.match(String(p), /D1.*Empfehlung/);
});

test('Frage im Kopf mit Empfehlung → ok', () => {
  assert.equal(abschlussProblem(KOPF('fragen:\n  - id: D1\n    frage: Soll ich?\n    empfehlung: Ja.\n    antwort: ""\n') + MERMAID), null);
});

test('Text nennt Entscheidungen, aber weder Kopf-Fragen noch parsbare Blöcke → Problem mit Beispielblock', () => {
  const p = abschlussProblem(GUT + '\n## Entscheidungen\n\nSoll ich A oder B nehmen? Empfehlung: A.\n');
  assert.match(String(p), /Entscheidung/);
  assert.match(String(p), /\*\*D1 — /);
});

test('parsbarer Block ohne Empfehlung → Problem; mit Empfehlung → ok', () => {
  const ohne = abschlussProblem(GUT + '\n## Entscheidungen\n\n**D1 — Titel**\n- Knut:\n');
  assert.match(String(ohne), /D1/);
  const mit = abschlussProblem(GUT + '\n## Entscheidungen\n\n**D1 — Titel**\n- Empfehlung: A\n- Knut:\n');
  assert.equal(mit, null);
});
