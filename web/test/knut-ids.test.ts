// Migrationsskript scripts/knut-ids-migration.py (docs/plan-knut-ids.md): Probelauf schreibt nichts, --apply nur im
// Zielbereich und erst nach der Vorprüfung, K1…Kn je Datei, idempotent, max+1 auch über gelöschte Zeilen hinweg,
// Gleichlauf mit parseDecisions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { parseDecisions } from '../server/roadmap.ts';

const SCRIPT = join(import.meta.dirname, '../../scripts/knut-ids-migration.py');
const B = 'olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap';
const REG = `${B}/0-Overview/offene-fragen-roadmap-produkt-olaf.md`;

const SPEC = `---
title: "x"
---
# x

## Offene Punkte

- Erste Frage? Empfehlung: ja
  - Knut:
- Beantwortet? Empfehlung: nein
  - Knut: nein
- Datiert
  - Knut (29.09.): passt
- Freier Verweis
  - Knut (E9):
> [!question]- Callout
> - Im Callout?
>   - Knut:

\`\`\`md
  - Knut:
\`\`\`

1. Nummeriert?
   * Knut:
`;

const files: Record<string, string> = {
  [`${B}/Admin/2-Pre-Plan/admin-spec-a.md`]: SPEC,
  [`${B}/Admin/4-Review/admin-spec-b.md`]: '# b\n\n- Frage?\n  - Knut:\n',
  // außerhalb des Zielbereichs (Register: Prozess v4 — nur Anzeige)
  [REG]: '# r\n\n- **A1 · Frage**\n  - Knut:\n- **A2 · Frage**\n  - Knut:\n',
  [`${B}/Admin/5-Live/admin-spec-live.md`]: '# l\n\n- Frage?\n  - Knut:\n',
  [`${B}/Admin/0-admin-uebersicht.md`]: '# ü\n\n- Frage?\n  - Knut:\n',
  [`${B}/0-Overview/priorisierung-roadmap-produkt-olaf.md`]: '# p\n\n- Frage?\n  - Knut:\n',
  ['olaf/1-Projects/sprint-2026-09-28/sprint-2026-09-28-planning.md']: '# s\n\n- Frage?\n  - Knut:\n',
};

function mk() {
  const root = mkdtempSync(join(tmpdir(), 'knut-ids-'));
  for (const [p, t] of Object.entries(files)) { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), t); }
  // Vorprüfung: beide Leser kennen die Form mit Kennung
  writeFileSync(join(root, 'roadmap.ts'), 'export interface Decision { knutId: string | null }\n');
  writeFileSync(join(root, 'roadmap_check.py'), 'KNUT_EMPTY = 1\n');
  return root;
}
const run = (root: string, ...args: string[]) => {
  const r = spawnSync('python3', [SCRIPT, '--root', root, '--stand', join(root, 'stand.json'), '--pruef-werkbank', join(root, 'roadmap.ts'), '--pruef-check', join(root, 'roadmap_check.py'), ...args],
    { encoding: 'utf8', env: { ...process.env, VAULT_SYNC_LOCK: join(root, '.lock'), VAULT_SYNC_LOCK_WAIT: '1' } });
  return { code: r.status, out: r.stdout + r.stderr };
};
const read = (root: string, p: string) => readFileSync(join(root, p), 'utf8');
const snap = (root: string) => Object.keys(files).map((p) => [p, read(root, p), statSync(join(root, p)).mtimeMs]);

test('Probelauf: Anzahl und Diff je Datei, Register nur als Zahl, schreibt nichts', () => {
  const root = mk();
  const before = snap(root);
  const r = run(root, '--dry-run');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^\s+3 {2}olaf\/.*admin-spec-a\.md$/m);
  assert.match(r.out, /^\+ {2}- Knut \(admin-spec-a#K1\):$/m);
  assert.match(r.out, /4 Kennung\(en\) in 2 Datei\(en\).*Probelauf, nichts geschrieben/);
  assert.match(r.out, /Register offene-fragen-\*: 2 leere Knut-Zeile\(n\), nicht migriert/);
  assert.doesNotMatch(r.out, /offene-fragen-roadmap-produkt-olaf#E/);
  assert.deepEqual(snap(root), before);
  assert.ok(!existsSync(join(root, 'stand.json')));
  assert.deepEqual(run(root).out, r.out, 'ohne Schalter = Probelauf');
});

test('--apply: nur leere Zeilen im Zielbereich, K1…Kn, Callout/Einrückung bleiben, Sicherungskopie, idempotent', () => {
  const root = mk();
  const bak = join(root, '_bak');
  const r = run(root, '--apply', '--backup', bak, '--no-diff');
  assert.equal(r.code, 0, r.out);
  const a = read(root, `${B}/Admin/2-Pre-Plan/admin-spec-a.md`);
  assert.deepEqual(a.split('\n').filter((l) => /Knut/.test(l)), [
    '  - Knut (admin-spec-a#K1):',
    '  - Knut: nein',
    '  - Knut (29.09.): passt',
    '  - Knut (E9):',
    '>   - Knut (admin-spec-a#K2):',
    '  - Knut:',                        // im Code-Block
    '   * Knut (admin-spec-a#K3):',
  ]);
  for (const p of Object.keys(files).filter((p) => /offene-fragen|5-Live|uebersicht|priorisierung|1-Projects/.test(p))) assert.equal(read(root, p), files[p], p);
  assert.equal(readFileSync(join(bak, `${B}/Admin/2-Pre-Plan/admin-spec-a.md`), 'utf8'), SPEC, 'Sicherungskopie = vorher');
  assert.ok(!existsSync(join(bak, `${B}/Admin/5-Live/admin-spec-live.md`)), 'nur geänderte Dateien gesichert');
  assert.ok(!readdirSync(join(root, `${B}/Admin/2-Pre-Plan`)).some((f) => f.endsWith('.tmp')), 'keine tmp-Reste');
  assert.deepEqual(JSON.parse(read(root, 'stand.json')), { 'admin-spec-a': 3, 'admin-spec-b': 1 });
  // Gleichlauf: dieselben Entscheidungen, jetzt mit Kennung
  const was = parseDecisions(SPEC), jetzt = parseDecisions(a);
  assert.deepEqual(jetzt.map((d) => [d.line, d.question, d.open, d.answer]), was.map((d) => [d.line, d.question, d.open, d.answer]));
  assert.deepEqual(jetzt.filter((d) => d.open).map((d) => d.knutId), ['admin-spec-a#K1', 'admin-spec-a#K2', 'admin-spec-a#K3']);
  // zweiter Lauf ändert nichts
  const s = snap(root);
  const r2 = run(root, '--apply', '--backup', join(root, '_bak2'));
  assert.equal(r2.code, 0, r2.out);
  assert.match(r2.out, /^0 Kennung\(en\) in 0 Datei\(en\)/m);
  assert.deepEqual(snap(root), s);
  assert.ok(!existsSync(join(root, '_bak2')), 'nichts zu tun → keine Sicherungskopie');
});

test('neue leere Zeile → max+1; eine gelöschte Kennung wird nie neu vergeben (Höchststand)', () => {
  const root = mk();
  run(root, '--apply', '--backup', join(root, '_bak'));
  const p = `${B}/Admin/2-Pre-Plan/admin-spec-a.md`;
  // K3 (höchste) wird gelöscht, K1 beantwortet, eine neue Frage kommt oben dazu
  const t = read(root, p).replace('   * Knut (admin-spec-a#K3):', '   * gestrichen').replace('  - Knut (admin-spec-a#K1):', '  - Knut (admin-spec-a#K1): ja').replace('## Offene Punkte\n', '## Offene Punkte\n\n- Neue Frage?\n  - Knut:\n');
  writeFileSync(join(root, p), t);
  const r = run(root, '--apply', '--backup', join(root, '_bak2'));
  assert.equal(r.code, 0, r.out);
  assert.match(read(root, p), /Neue Frage\?\n {2}- Knut \(admin-spec-a#K4\):/, 'K4, nicht K3');
  assert.match(read(root, p), /- Knut \(admin-spec-a#K1\): ja/);
  assert.equal(JSON.parse(read(root, 'stand.json'))['admin-spec-a'], 4);
});

test('Warnungen (fremde/doppelte Kennung, ungeeigneter Dateiname) melden — und --apply bricht dann ab', () => {
  const root = mk();
  const p = `${B}/Admin/4-Review/admin-spec-b.md`;
  writeFileSync(join(root, p), '# b\n\n- Frage?\n  - Knut (admin-spec-b#K1):\n- kopiert\n  - Knut (admin-spec-a#K7):\n- doppelt\n  - Knut (admin-spec-b#K1): ja\n- neu\n  - Knut:\n- alter Präfix\n  - Knut (admin-spec-b#E2):\n');
  mkdirSync(join(root, `${B}/Admin/3-Plan`));
  writeFileSync(join(root, `${B}/Admin/3-Plan/Admin_Spec_Gross.md`),'# g\n\n- Frage?\n  - Knut:\n');
  const before = snap(root);
  const d = run(root);
  assert.match(d.out, /WARN .*admin-spec-b\.md: Z\. 6: Kennung admin-spec-a#K7 gehört nicht zu dieser Datei/);
  assert.match(d.out, /WARN .*admin-spec-b\.md: Z\. 8: Kennung admin-spec-b#K1 doppelt \(auch Z\. 4\)/);
  assert.match(d.out, /WARN .*Admin_Spec_Gross\.md: Dateiname taugt nicht als Kennung/);
  assert.match(d.out, /WARN .*admin-spec-b\.md: Z\. 12: Kennung admin-spec-b#E2 mit anderem Präfix als K/);
  assert.doesNotMatch(d.out, /Admin_Spec_Gross#K/);
  const r = run(root, '--apply', '--backup', join(root, '_bak'));
  assert.equal(r.code, 4, r.out);
  assert.match(r.out, /Abbruch: erst die Warnungen klären/);
  assert.deepEqual(snap(root), before);
  assert.equal(read(root, `${B}/Admin/3-Plan/Admin_Spec_Gross.md`), '# g\n\n- Frage?\n  - Knut:\n');
});

test('--apply bricht ab, solange Werkbank oder roadmap_check.py die Form mit Kennung nicht kennen', () => {
  const root = mk();
  const before = snap(root);
  writeFileSync(join(root, 'roadmap_check.py'), "open_k = len(re.findall(r'^\\s*- Knut:\\s*$', t, re.M))\n");
  let r = run(root, '--apply', '--backup', join(root, '_bak'));
  assert.equal(r.code, 5, r.out);
  assert.match(r.out, /Abbruch: roadmap_check\.py .* kennt die Form mit Kennung noch nicht/);
  writeFileSync(join(root, 'roadmap_check.py'), 'KNUT_EMPTY = 1\n');
  writeFileSync(join(root, 'roadmap.ts'), 'const KNUT = /x/;\n');
  r = run(root, '--apply', '--backup', join(root, '_bak'));
  assert.equal(r.code, 5, r.out);
  assert.match(r.out, /Abbruch: Werkbank .* kennt die Form mit Kennung noch nicht/);
  assert.deepEqual(snap(root), before);
  assert.ok(!existsSync(join(root, '_bak')));
});

test('Höchststand: ein höherer Stand eines anderen Laufs wird nicht zurückgesetzt; ohne Sperr-Ordner Abbruch', () => {
  const root = mk();
  writeFileSync(join(root, 'stand.json'), JSON.stringify({ 'admin-spec-a': 9, 'andere-spec': 4 }));
  const r = run(root, '--apply', '--backup', join(root, '_bak'));
  assert.equal(r.code, 0, r.out);
  assert.match(read(root, `${B}/Admin/2-Pre-Plan/admin-spec-a.md`), /- Knut \(admin-spec-a#K10\):/, 'beginnt über dem Stand');
  assert.deepEqual(JSON.parse(read(root, 'stand.json')), { 'admin-spec-a': 12, 'admin-spec-b': 1, 'andere-spec': 4 });

  const r2 = mk();
  const before = snap(r2);
  const x = spawnSync('python3', [SCRIPT, '--root', r2, '--stand', join(r2, 'stand.json'), '--pruef-werkbank', join(r2, 'roadmap.ts'), '--pruef-check', join(r2, 'roadmap_check.py'), '--apply', '--backup', join(r2, '_bak')],
    { encoding: 'utf8', env: { ...process.env, VAULT_SYNC_LOCK: join(r2, 'gibt-es-nicht', '.lock') } });
  assert.equal(x.status, 3, x.stdout + x.stderr);
  assert.match(x.stderr, /kein Ordner für die Vault-Sync-Sperre/);
  assert.deepEqual(snap(r2), before);
  assert.ok(!existsSync(join(r2, '_bak')) && !existsSync(join(r2, 'stand.json')));
});

test('--apply schreibt nicht, solange der Vault-Sync die Sperre hält', () => {
  const root = mk();
  const before = snap(root);
  const lock = join(root, '.lock');
  writeFileSync(lock, '');
  const args = ['--root', root, '--stand', join(root, 'stand.json'), '--pruef-werkbank', join(root, 'roadmap.ts'), '--pruef-check', join(root, 'roadmap_check.py'), '--apply', '--backup', join(root, '_bak')];
  const holder = spawnSync('flock', ['-n', lock, 'python3', SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, VAULT_SYNC_LOCK: lock, VAULT_SYNC_LOCK_WAIT: '1' }, timeout: 60_000 });
  assert.equal(holder.status, 3, holder.stdout + holder.stderr);
  assert.match(holder.stderr, /Vault-Sync läuft/);
  assert.deepEqual(snap(root), before);
  assert.ok(!existsSync(join(root, '_bak')), 'ohne Sperre auch keine Sicherungskopie');
});
