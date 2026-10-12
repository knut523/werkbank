// „Wartet auf dich“ nur mit heute offenen Vault-Fragen (docs/plan-heute-fragen-aktuell.md): Live/Archiv, Überholtes,
// schon Entschiedenes und Dubletten fallen heraus — sichtbar unter „Aufräumen“ bzw. als Etikett, nie still.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { buildIndex } from '../server/vault.ts';
import { collectDecisions, todayQuestions, staleIds, similar } from '../server/fragen.ts';

const B = 'olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap';
const fm = (title: string, lv: string, created = lv) => `---\ntitle: "${title}"\ntype: reference\nteam: olaf\nstatus: draft\ncreated: ${created}\nlast-verified: ${lv}\n---\n# ${title}\n\n`;

const REG = fm('Register', '2026-10-11', '2026-09-25') + `## Neu am 11.10.2026 — Nachtrag

**Braucht Knut**

- **F1 Flex-Dankeschön:** Gutschein mit Betrag oder nichts versprechen? — [[spec-plan]]. Empfehlung: nichts.
  - Knut:
- **F2 Werkbank RAM:** eigene VM für die Team-Werkbank?
  - Knut:

**Überholt laut Prüfung 11.10.** (bleiben stehen)

- A93 (Bot, entschieden), B3 (Allowlist live; Key-Rotation steht im Hub).
- „Neu am 01.10.“: N2 überholt (#236 gemergt); N12 bleibt offen.

## A · Blockiert Plan

**A1 · Prod-DB: wer sieht hinein?**
betrifft [[spec-plan]] · wer: Knut
➡️ Empfehlung: Termin machen.
  - Knut:

**A3 · status-historie schneiden?**
betrifft [[spec-backlog]]
  - Knut:
  - Entschieden (Knut, 30.09.2026): eigener Schnitt.

**A93 · Plattform A oder B?**
betrifft [[spec-backlog]]
  - Knut:

**B3 · ADMIN_API_KEY rotieren?**
  - Knut:

**N12 · bleibt das so?** betrifft [[spec-live]]
  - Knut:

**N2 · e2e-Selektor reparieren?**
  - Knut:

**D3 · [[spec-backlog]] archivieren** (Durchsicht 2). ➡️ nach 6-Archive.
  - Knut:

**D5 · [[spec-plan]] Farbe im Hub prüfen** (Durchsicht 4).
  - Knut:

**C7 · [[spec-live]]** — erst messen.
  - Knut:

**~~A50 · alte Frage~~** erledigt.
  - Knut:

### Detail

- **A93** [[0-x-uebersicht]]: Farbskala neutral? ➡️ ja.
  - Knut:

## E · Zuletzt beantwortet (30.09.2026)

- **A2 · was anderes**
  - Knut:
`;

const files: Record<string, string> = {
  [`${B}/0-Overview/offene-fragen-roadmap-produkt-olaf.md`]: REG,
  [`${B}/X/0-x-uebersicht.md`]: fm('X Übersicht', '2026-10-01') + '## Tragend\n\n- Eigenes Thema?\n  - Knut:\n',
  [`${B}/X/3-Plan/spec-plan.md`]: fm('Spec Plan', '2026-10-10') + '## Offene Punkte\n\n- Dankeschön: Gutschein mit Betrag oder nichts versprechen? Empfehlung: nichts.\n  - Knut:\n- Zweite Frage zur Farbe?\n  - Knut:\n',
  [`${B}/X/1-Backlog/spec-backlog.md`]: fm('Spec Backlog', '2026-09-20') + '## Offene Punkte\n\n- Status-Historie: Tagesstand mitschreiben?\n  - Knut:\n- Bot zuerst?\n  - Knut:\n  - Entschieden (Knut, 01.10.2026, teilweise): für Dev ja.\n',
  [`${B}/X/5-Live/spec-live.md`]: fm('Spec Live', '2026-09-01') + '## Offene Punkte\n\n- Noch offen?\n  - Knut:\n',
  [`${B}/X/6-Archive/spec-alt.md`]: fm('Spec Alt', '2026-08-01') + '## Offene Punkte\n\n- Archivfrage?\n  - Knut:\n',
};

function vault(tf = (_p: string, t: string) => t) {
  const root = mkdtempSync(join(tmpdir(), 'fragen-'));
  for (const [p, t] of Object.entries(files)) { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), tf(p, t)); }
  const idx = buildIndex(root);
  const { decisions, texts } = collectDecisions(idx, (p) => readFileSync(join(root, p), 'utf8'), B);
  return { decisions, r: todayQuestions(decisions, { texts, fm: (p) => idx.notes.get(p)?.fm, today: '2026-10-11' }) };
}
const { decisions, r } = vault();
const at = (xs: any[], spec: string, needle: string) => xs.find((q) => q.spec === spec && (q.head + q.question).includes(needle));
const reg = 'offene-fragen-roadmap-produkt-olaf';

test('Sammlung: alle leeren Knut-Zeilen, roh wie bisher (Roadmap-Seite bleibt vollständig)', () => {
  assert.equal(r.raw, decisions.length);
  assert.equal(decisions.length, 21);
  assert.ok(decisions.some((d) => d.state === '5-Live') && decisions.some((d) => d.state === '6-Archive'));
  assert.equal(r.open.length + r.cleanup.length + r.duplicates.length, r.raw, 'nichts geht verloren');
});

test('Live und Archiv → Aufräumen mit Grund', () => {
  assert.equal(at(r.cleanup, 'spec-live', 'Noch offen').reason, 'Spec ist live');
  assert.equal(at(r.cleanup, 'spec-alt', 'Archivfrage').reason, 'Spec ist archiviert');
  assert.match(at(r.cleanup, reg, 'C7').reason, /verlinkte Spec ist live/);
});

test('Register: Überholt-Absatz, beantwortet-Abschnitt, durchgestrichen, „Entschieden“ darunter', () => {
  assert.match(at(r.cleanup, reg, 'B3 ·').reason, /überholt geführt \(B3\)/);
  assert.match(at(r.cleanup, reg, 'N2 ·').reason, /überholt geführt \(N2\)/);
  assert.ok(at(r.open, reg, 'N12'), '„N12 bleibt offen“ bleibt offen — auch wenn die verlinkte Spec live ist');
  assert.match(at(r.cleanup, reg, 'A2 ·').reason, /Zuletzt beantwortet/);
  assert.equal(at(r.cleanup, reg, 'A50').reason, 'durchgestrichen');
  assert.match(at(r.cleanup, reg, 'A3 ·').reason, /Entschieden/);
  assert.deepEqual([...staleIds(REG).stale].sort(), ['A93', 'B3', 'N2']);
  assert.deepEqual([...staleIds(REG).keep], ['N12']);
});

test('doppelt vergebene Register-ID (A93) wird nicht über den Überholt-Absatz ausgeblendet', () => {
  assert.ok(at(r.open, reg, 'Plattform A oder B'));
  assert.ok(at(r.open, reg, 'Farbskala'));
});

test('„Entschieden (…, teilweise)“ bleibt offen, mit Etikett', () => {
  const q = at(r.open, 'spec-backlog', 'Bot zuerst');
  assert.ok(q && q.partly);
});

test('Dublette: Register-Eintrag mit Link auf dieselbe offene Spec-Frage → einmal, Spec gewinnt, ID als Etikett', () => {
  assert.ok(at(r.duplicates, reg, 'F1 '));
  const spec = at(r.open, 'spec-plan', 'Dankeschön');
  assert.deepEqual(spec.register.map((x: any) => x.id), ['F1']);
  assert.deepEqual(at(r.open, 'spec-plan', 'Farbe').register, [], 'Etikett nur an der passenden Frage');
  // fragt das Register etwas anderes über die Spec, bleibt es sichtbar
  assert.ok(at(r.open, reg, 'A1 ·'), 'A1 fragt etwas anderes als spec-plan');
  assert.ok(at(r.open, reg, 'D3 ·'), 'Vault-Pflege über eine Spec ist keine Dublette');
  assert.ok(at(r.open, reg, 'D5 ·'), 'ein gemeinsames Wort („Farbe“) mit einer kurzen Spec-Frage reicht nicht');
  assert.ok(similar('Gutschein mit Betrag oder nichts versprechen', 'Dankeschön: Gutschein mit Betrag oder nichts versprechen?') >= 0.3);
});

test('Alter: Neu-am-Datum, sonst created (Register) bzw. last-verified; > 14 Tage markiert', () => {
  const f2 = at(r.open, reg, 'F2 ');
  assert.deepEqual([f2.since, f2.sinceKind, f2.age, f2.old], ['2026-10-11', 'neu', 0, false]);
  const n12 = at(r.open, reg, 'N12');
  assert.deepEqual([n12.since, n12.sinceKind, n12.old], ['2026-09-25', 'eingetragen', true]);
  const bl = at(r.open, 'spec-backlog', 'Tagesstand');
  assert.deepEqual([bl.since, bl.sinceKind, bl.age, bl.old], ['2026-09-20', 'geprüft', 21, true]);
  assert.equal(at(r.open, 'spec-plan', 'Farbe').old, false);
});

test('Sortierung: „Neu am …“ und Plan/Review zuerst, darin jüngere zuerst', () => {
  const firstN = r.open.findIndex((q) => !q.first);
  assert.ok(firstN > 0 && r.open.slice(firstN).every((q) => !q.first), 'alle „zuerst“ vor dem Rest');
  assert.deepEqual(r.open.slice(0, firstN).map((q) => q.spec), [reg, 'spec-plan', 'spec-plan']);
  assert.equal(r.open[0].id, 'F2');
});

test('Register-Kopfzeile statt Empfehlungszeile als Anzeigetext', () => {
  assert.match(at(r.open, reg, 'A1 ·').head, /^\*\*A1 · Prod-DB/);
});

test('Kennungen (docs/plan-knut-ids.md): mit `- Knut (<slug>#K<n>):` dieselbe bereinigte Liste wie ohne', () => {
  // jede leere Knut-Zeile bekommt <Basename>#K1…Kn — hier auch im Register (das Skript lässt es aus), um den Parser
  // überall zu prüfen
  const ids = (p: string, t: string) => { let n = 0; const slug = p.split('/').at(-1)!.replace(/\.md$/, ''); return t.replace(/^((?:> ?)*\s*[-*]) Knut:[ \t]*$/gm, (_m, a) => `${a} Knut (${slug}#K${++n}):`); };
  const w = vault(ids);
  assert.ok(w.decisions.every((d) => d.knutId && d.knutId.startsWith(d.spec + '#K')), 'jede Zeile trägt ihre Kennung');
  const key = (x: any) => [x.spec, x.line, x.head, x.question, x.reason ?? '', x.id ?? '', x.partly, x.register.map((y: any) => y.id).join()].join('|');
  for (const k of ['open', 'cleanup', 'duplicates'] as const) assert.deepEqual(w.r[k].map(key), r[k].map(key), k);
  assert.equal(at(w.r.open, 'spec-plan', 'Dankeschön').knutId, 'spec-plan#K1');
  assert.equal(at(w.r.open, reg, 'F2 ').id, 'F2', 'Register-ID bleibt in `id`, die Kennung steht in `knutId`');
});
