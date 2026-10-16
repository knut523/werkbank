import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { frist, liesMeeting, vorschlaege, triageUebernehmen, pruefeDatei, archiviert, triageAbschnitt } from '../server/cosmeeting.ts';
import { liesRegister } from '../server/cosregister.ts';

const FX = new URL('./fixtures/cos/', import.meta.url).pathname;
const rd = (f: string) => readFileSync(FX + f, 'utf8');

test('Fristen relativ zum Meeting-Datum (K15): Datum, Wochentag, KW, nächste Woche, Spannen = unklar', () => {
  const f = (t: string, d = '2026-10-14') => frist(t, d);   // 14.10.2026 ist ein Mittwoch
  assert.deepEqual(f('Vertrag bis 23.10. schicken'), { bis: '2026-10-23', unklar: false });
  assert.deepEqual(f('Antwort bis Freitag'), { bis: '2026-10-16', unklar: false });
  assert.deepEqual(f('bis Mittwoch'), { bis: '2026-10-21', unklar: false }, 'gleicher Wochentag = nächste Woche');
  assert.deepEqual(f('Budget klären, KW 44'), { bis: '2026-10-30', unklar: false });
  assert.deepEqual(f('nächste Woche erledigen'), { bis: '2026-10-23', unklar: false });
  assert.deepEqual(f('naechste Woche erledigen'), { bis: '2026-10-23', unklar: false });
  assert.deepEqual(f('bis Ende der Woche'), { bis: '2026-10-16', unklar: false });
  assert.deepEqual(f('in zwei Wochen'), { bis: '2026-10-28', unklar: false });
  assert.deepEqual(f('bis Ende Oktober'), { bis: '2026-10-31', unklar: false });
  assert.deepEqual(f('in den naechsten zwei bis drei Wochen'), { bis: null, unklar: true });
  assert.deepEqual(f('irgendwann'), { bis: null, unklar: true });
  assert.deepEqual(f('bis 31.02.'), { bis: null, unklar: true });
  assert.deepEqual(frist('bis 23.10.', null), { bis: null, unklar: true });
});

test('Fristen am Jahreswechsel und an der Zeitumstellung (K15)', () => {
  assert.deepEqual(frist('bis 15.01.', '2026-12-18'), { bis: '2027-01-15', unklar: false });
  assert.deepEqual(frist('KW 2', '2026-12-18'), { bis: '2027-01-15', unklar: false });
  assert.deepEqual(frist('nächste Woche', '2026-12-30'), { bis: '2027-01-08', unklar: false });
  assert.deepEqual(frist('bis Freitag', '2026-10-21'), { bis: '2026-10-23', unklar: false });
  assert.deepEqual(frist('bis Montag', '2026-10-23'), { bis: '2026-10-26', unklar: false }, 'Tag der Zeitumstellung 25.10. liegt dazwischen — Kalendertage, keine Stunden');
  assert.deepEqual(frist('in einer Woche', '2026-10-21'), { bis: '2026-10-28', unklar: false });
});

test('Vexa-Notiz vom 18.09.: 6 Action Items, 5 ohne Namen, 0 Entscheidungen (K12, K13)', () => {
  const m = liesMeeting('olaf/Meetings/2026-09-18-olaf-review-learning-venture-ubergreifend.md', rd('vexa-2026-09-18.md'));
  assert.equal(m.vexa, true); assert.equal(m.status, 'draft'); assert.equal(m.datum, '2026-09-18'); assert.equal(m.hatTriage, false);
  assert.equal(m.aktionen.length, 6);
  assert.equal(m.aktionen.filter((a) => a.wer === null).length, 5, 'Wer: offen — nie aus den Teilnehmern raten');
  assert.equal(m.aktionen.find((a) => a.wer)!.wer, 'Christoph Bitzner');
  assert.equal(m.entscheidungen.length, 0);
  const belief = m.aktionen.find((a) => /Belieferungsstatus/.test(a.was))!;
  assert.deepEqual([belief.bis, belief.fristUnklar], [null, true], '„in den naechsten zwei bis drei Wochen“ = Frist unklar');
  assert.deepEqual(m.teilnehmer, ['Christoph Bitzner', 'MAXZukunft']);
});

test('Vexa-Notiz mit Entscheidung: Frontmatter maßgeblich; Namen, Fristen', () => {
  const m = liesMeeting('olaf/Meetings/x.md', rd('vexa-mit-entscheidung.md'));
  assert.deepEqual(m.entscheidungen, ['Pilot startet mit 5 Haushalten']);
  assert.deepEqual(m.aktionen.map((a) => [a.wer, a.bis, a.fristUnklar]), [['Michael N.', '2026-10-23', false], ['Knut Peters', '2026-10-16', false], [null, '2026-10-30', false], [null, null, true]]);
});

test('Knuts Format hat nichts Maschinenlesbares: kein Vexa-Entwurf, kein Vorschlag', () => {
  const m = liesMeeting('olaf/Meetings/2026-10-16-x.md', rd('knut-2026-10-16.md'));
  assert.equal(m.vexa, false); assert.equal(m.aktionen.length, 0);
});

function vault() {
  const v = mkdtempSync(join(tmpdir(), 'cos-mt-'));
  mkdirSync(join(v, 'olaf/Meetings'), { recursive: true }); mkdirSync(join(v, 'konekto/Meetings'), { recursive: true });
  cpSync(FX + 'vexa-2026-09-18.md', join(v, 'olaf/Meetings/2026-09-18-olaf-review.md'));
  cpSync(FX + 'vexa-mit-entscheidung.md', join(v, 'olaf/Meetings/2026-10-14-olaf-rogue.md'));
  cpSync(FX + 'knut-2026-10-16.md', join(v, 'olaf/Meetings/2026-10-16-olaf-flex.md'));
  cpSync(FX + 'vexa-mit-entscheidung.md', join(v, 'konekto/Meetings/2026-10-14-konekto-x.md'));
  return v;
}

test('Vorschläge: nur 14 Tage, nur COS_MEETING_TEAMS, ältere als Zahl, ausgeblendete nicht (K4)', () => {
  const v = vault();
  const r = vorschlaege(v, ['olaf'], '2026-10-16', new Set());
  assert.deepEqual(r.items.map((x) => x.datei), ['olaf/Meetings/2026-10-14-olaf-rogue.md']);
  assert.equal(r.aelter, 1);   // 18.09. ist älter als 14 Tage
  assert.deepEqual([r.items[0].zusagen, r.items[0].entscheidungen], [4, 1]);
  assert.equal(vorschlaege(v, ['olaf', 'konekto'], '2026-10-16', new Set()).items.length, 2);
  assert.equal(vorschlaege(v, ['olaf'], '2026-10-16', new Set(['olaf/Meetings/2026-10-14-olaf-rogue.md'])).items.length, 0);
  assert.deepEqual(vorschlaege(v, ['olaf'], '2026-10-01', new Set()).items.map((x) => x.datei), ['olaf/Meetings/2026-09-18-olaf-review.md'], 'am 01.10. ist nur der 18.09. in Reichweite; spätere Termine noch nicht passiert');
});

const base = (v: string, o: any = {}) => ({ vaultDir: v, heute: '2026-10-16', locked: () => false, teams: ['olaf'], ...o });

test('Ja: Vorschau zeigt jede Änderung, schreibt nichts; confirm trägt ein, hängt Triage an; mit Entscheidung bleibt draft', async () => {
  const v = vault();
  const d = 'olaf/Meetings/2026-10-14-olaf-rogue.md';
  const vor = await triageUebernehmen(d, base(v));
  assert.equal(vor.needsConfirm, true);
  assert.equal(vor.aenderungen.filter((a: string) => a.startsWith('Register:')).length, 4);
  assert.ok(vor.aenderungen.some((a: string) => /Status bleibt draft — 1 Entscheidung/.test(a)));
  assert.ok(!vor.aenderungen.some((a: string) => /archived/.test(a)));
  assert.equal(existsSync(join(v, 'olaf/1-Projects/chief-of-staff/zusagen-register.md')), false, 'Vorschau schreibt nicht');
  const ok = await triageUebernehmen(d, base(v, { confirm: true, hash: vor.hash, registerHash: vor.registerHash }));
  assert.deepEqual(ok.ids, ['Z-001', 'Z-002', 'Z-003', 'Z-004']); assert.equal(ok.archiviert, false);
  const note = readFileSync(join(v, d), 'utf8');
  assert.match(note, /^status: draft$/m);
  assert.match(note, /## Triage \(Werkbank, 16\.10\.\)\n\n- Michael N\.: Vertragsentwurf bis 23\.10\. schicken → Z-001 \(Register\); bewusst kein Jira/);
  assert.match(note, /- Entscheidung: Pilot startet mit 5 Haushalten → ADR offen/);
  const reg = liesRegister(v);
  assert.equal(reg.zusagen.length, 4);
  assert.equal(reg.zusagen[0].quelle, '[[2026-10-14-olaf-rogue]]');
  assert.equal(reg.zusagen.filter((z) => z.wer === null).length, 2);
  assert.equal(reg.zusagen.find((z) => z.id === 'Z-004')!.fristUnklar, true);
  // schon triagiert → kein zweites Mal, kein Vorschlag
  await assert.rejects(triageUebernehmen(d, base(v)), (e: any) => e.status === 409);
  assert.equal(vorschlaege(v, ['olaf'], '2026-10-16', new Set()).items.length, 0);
});

test('Ohne Entscheidungen: Status → archived, aber nur dann (K4); doppelte Zusagen werden nicht noch einmal eingetragen', async () => {
  const v = vault();
  const d = 'olaf/Meetings/2026-10-14-olaf-rogue.md';
  const text = readFileSync(join(v, d), 'utf8').replace(/decisions: \[.*\]/, 'decisions: []').replace('- Pilot startet mit 5 Haushalten\n\n## Action', 'Keine formalen Entscheidungen.\n\n## Action');
  writeFileSync(join(v, d), text);
  const vor = await triageUebernehmen(d, base(v));
  assert.ok(vor.aenderungen.some((a: string) => /Status draft → archived/.test(a)));
  const ok = await triageUebernehmen(d, base(v, { confirm: true, hash: vor.hash, registerHash: vor.registerHash }));
  assert.equal(ok.archiviert, true);
  assert.match(readFileSync(join(v, d), 'utf8'), /^status: archived$/m);
  // Notiz wird (z. B. nach einem Fehler) wieder auf draft gesetzt und ohne ## Triage → Register-Dubletten werden erkannt
  writeFileSync(join(v, d), text);
  const vor2 = await triageUebernehmen(d, base(v));
  assert.equal(vor2.aenderungen.filter((a: string) => a.startsWith('Register: ') && !/stehen schon/.test(a)).length, 0);
  assert.ok(vor2.aenderungen.some((a: string) => /4 Zusage\(n\) stehen schon dort/.test(a)));
});

test('409: Notiz zwischen Vorschau und Bestätigung geändert, Vault-Sync-Sperre; Pfade nur in freigegebenen Teams', async () => {
  const v = vault();
  const d = 'olaf/Meetings/2026-10-14-olaf-rogue.md';
  const vor = await triageUebernehmen(d, base(v));
  writeFileSync(join(v, d), readFileSync(join(v, d), 'utf8') + '\nvon Hand\n');
  await assert.rejects(triageUebernehmen(d, base(v, { confirm: true, hash: vor.hash, registerHash: vor.registerHash })), (e: any) => e.status === 409 && /geändert/.test(e.message));
  const v2 = vault();
  const vor2 = await triageUebernehmen(d, base(v2));
  await assert.rejects(triageUebernehmen(d, base(v2, { confirm: true, hash: vor2.hash, locked: () => true })), (e: any) => e.status === 409 && /Vault-Sync/.test(e.message));
  assert.throws(() => pruefeDatei('konekto/Meetings/x.md', ['olaf']), (e: any) => e.status === 400);
  assert.throws(() => pruefeDatei('olaf/Meetings/../../etc/passwd.md', ['olaf']), (e: any) => e.status === 400);
  assert.throws(() => pruefeDatei('olaf/2-Areas/x.md', ['olaf']), (e: any) => e.status === 400);
  await assert.rejects(triageUebernehmen('olaf/Meetings/2026-10-16-olaf-flex.md', base(v)), (e: any) => e.status === 409, 'Knuts Format ist kein Notetaker-Entwurf');
});

test('Hilfen: archiviert ändert nur die Statuszeile; Abschnitt nennt je Punkt das Ziel', () => {
  assert.equal(archiviert('---\ntitle: x\nstatus: draft\ntags: []\n---\nstatus: draft\n'), '---\ntitle: x\nstatus: archived\ntags: []\n---\nstatus: draft\n');
  assert.equal(archiviert('---\nstatus: current\n---\n'), null);
  const a = triageAbschnitt('2026-10-16', [{ k: { wer: null, was: 'A', bis: null, fristUnklar: true }, ziel: 'Z-001 (Register)' }], ['E']);
  assert.match(a, /^## Triage \(Werkbank, 16\.10\.\)\n\n- A → Z-001 \(Register\); bewusst kein Jira\n- Entscheidung: E → ADR offen/);
});
