import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseRegister, parseThemen, zusageZeile, seiteVon, teamSet, teamNamen, neueDatei, wendeZusagenAn, wendeThemaAn, schreibeZusagen, schreibeThema, liesRegister, naechsteId, feld, parseTermin, type Personen } from '../server/cosregister.ts';

const HEUTE = '2026-10-16';
const vault = () => mkdtempSync(join(tmpdir(), 'cos-reg-'));
const REG = '---\ntitle: "Zusagen-Register"\n---\n\n# Zusagen-Register\n\n## Offen\n\n- **Z-007** · Christoph Bitzner → Knut · Belieferungsstatus in den Report · bis 2026-10-23 · Thema: Cockpit · Quelle: [[2026-09-18-olaf-review]]\n- **Z-008** · Knut → Rogue · Vertragsentwurf schicken · Frist unklar\n\n## Erledigt\n\n- **Z-001** · Knut → Christoph · Zugang · bis 2026-10-01 · erledigt 2026-10-02\n\n## Verworfen\n\n## Personen\n\n- Knut · Knut · auch: Knut Peters, martenc-knut\n- Christoph Bitzner · Team · auch: Christoph, martenc\n- Rogue GmbH · Partner\n';

test('Zeile lesen: Felder, Wer: offen, Frist unklar', () => {
  const z = zusageZeile('- **Z-007** · Christoph Bitzner → Knut · Report · bis 2026-10-23 · Thema: Cockpit · Quelle: [[x]] · Notiz: a · Notiz: b')!;
  assert.deepEqual([z.id, z.wer, z.an, z.was, z.bis, z.thema, z.quelle, z.notizen], ['Z-007', 'Christoph Bitzner', 'Knut', 'Report', '2026-10-23', 'Cockpit', '[[x]]', ['a', 'b']]);
  const o = zusageZeile('- **Z-009** · Wer: offen → Knut · Etwas · Frist unklar')!;
  assert.equal(o.wer, null); assert.equal(o.fristUnklar, true);
  assert.equal(zusageZeile('- **Z-009** · nur zwei'), null);
  assert.equal(zusageZeile('- keine Kennung · A → B · c'), null);
});

test('Register: Abschnitte, Personen, unlesbare Zeilen bleiben sichtbar', () => {
  const r = parseRegister(REG + '- kaputte Zeile im Personen-Abschnitt\n');
  assert.equal(r.zusagen.length, 3);
  assert.deepEqual(r.zusagen.map((z) => [z.id, z.abschnitt]), [['Z-007', 'offen'], ['Z-008', 'offen'], ['Z-001', 'erledigt']]);
  assert.equal(r.personen.length, 3);
  assert.equal(r.unlesbar.length, 1);
  const r2 = parseRegister(REG.replace('## Offen', '## Offen\n\n- Freitext ohne Kennung\n'));
  assert.equal(r2.unlesbar[0].text, '- Freitext ohne Kennung');
  assert.deepEqual(parseRegister(REG.replace('Z-008', 'Z-007')).doppelt, ['Z-007']);
});

test('Seite je Person (K11): Knut Peters, martenc, Michael N.', () => {
  const personen: Personen[] = parseRegister(REG).personen;
  const team = teamSet([{ name: 'Michael Nagl', aliase: [] }, { name: 'Lisa Stecher', aliase: ['Lisa'] }]);
  assert.equal(seiteVon('Knut Peters', personen, team), 'Knut');
  assert.equal(seiteVon('martenc', personen, team), 'Team');
  assert.equal(seiteVon('Michael N.', personen, team), 'Team');
  assert.equal(seiteVon('Lisa', personen, team), 'Team');
  assert.equal(seiteVon('Rogue GmbH', personen, team), 'Partner');
  assert.equal(seiteVon('Unbekannter Dritter', personen, team), 'Seite?');
  assert.equal(seiteVon(null, personen, team), 'offen');
  assert.equal(seiteVon('  ', personen, team), 'offen');
});

test('Neue Zusage: am Abschnittsende, Kennung höchste + 1, fremde Zeilen unverändert (K3)', () => {
  const r = wendeZusagenAn(REG, [{ art: 'neu', wer: 'Christoph', was: 'PR prüfen', bis: '2026-10-30', thema: 'Flex' }], HEUTE);
  assert.deepEqual(r.ids, ['Z-009']);
  const ls = r.text.split('\n');
  const i = ls.findIndex((l) => l.startsWith('- **Z-009**'));
  assert.equal(ls[i - 1], '- **Z-008** · Knut → Rogue · Vertragsentwurf schicken · Frist unklar');
  assert.equal(ls[i], '- **Z-009** · Christoph → Knut · PR prüfen · bis 2026-10-30 · Thema: Flex');
  assert.equal(r.text.replace(ls[i] + '\n', ''), REG, 'bis auf die eine Zeile byteweise gleich');
  const offen = wendeZusagenAn(REG, [{ art: 'neu', was: 'Etwas ohne Namen' }], HEUTE);
  assert.match(offen.text, /\*\*Z-009\*\* · Wer: offen → Knut · Etwas ohne Namen\n/);
  assert.equal(naechsteId(REG), 'Z-009');
  assert.equal(feld('a · b\nc'), 'a – b c');
});

test('Ändern: erledigt verschiebt die Zeile, Datum/Notiz gezielt, doppelte Kennung = 409', () => {
  const r = wendeZusagenAn(REG, [{ art: 'aendern', id: 'Z-007', status: 'erledigt', notiz: 'Report ist drin' }], HEUTE);
  const reg = parseRegister(r.text);
  const z = reg.zusagen.find((x) => x.id === 'Z-007')!;
  assert.equal(z.abschnitt, 'erledigt'); assert.equal(z.erledigtAm, HEUTE); assert.deepEqual(z.notizen, ['Report ist drin']);
  assert.ok(r.text.indexOf('Z-007') > r.text.indexOf('## Erledigt'));
  const d = wendeZusagenAn(REG, [{ art: 'aendern', id: 'Z-008', bis: '2026-11-02' }], HEUTE);
  assert.match(d.text, /Z-008\*\* · Knut → Rogue · Vertragsentwurf schicken · bis 2026-11-02\n/);
  const w = wendeZusagenAn(r.text, [{ art: 'aendern', id: 'Z-007', status: 'offen' }], HEUTE);
  assert.ok(!/Z-007.*erledigt \d{4}/.test(w.text));
  assert.throws(() => wendeZusagenAn(REG, [{ art: 'aendern', id: 'Z-404', status: 'verworfen' }], HEUTE), (e: any) => e.status === 404);
  assert.throws(() => wendeZusagenAn(REG.replace('Z-008', 'Z-007'), [{ art: 'aendern', id: 'Z-007', status: 'verworfen' }], HEUTE), (e: any) => e.status === 409);
  assert.throws(() => wendeZusagenAn(REG, [{ art: 'neu', was: 'x', bis: '23.10.' }], HEUTE), (e: any) => e.status === 400);
});

test('Rundlauf (K3): CRLF, Leerzeichen am Zeilenende, umbenannter Abschnitt, fremde Zeilen', () => {
  const hand = '# Register  \r\n\r\nFreitext vorab \r\n\r\n## Offen (diese Woche)\r\n\r\n- **Z-002** · Anna → Knut · Etwas  \r\n- fremde Zeile dazwischen\r\n\r\n## Erledigt\r\n\r\n## Notizen\r\nirgendwas\r\n';
  // nichts ändern → identisch (parse ist reine Lesung)
  assert.equal(parseRegister(hand).zusagen.length, 1);
  assert.equal(parseRegister(hand).unlesbar[0].text, '- fremde Zeile dazwischen');
  const r = wendeZusagenAn(hand, [{ art: 'neu', wer: 'Bernd', was: 'Neu' }], HEUTE);
  assert.ok(r.text.includes('- **Z-002** · Anna → Knut · Etwas  \r\n- fremde Zeile dazwischen\r\n'), 'fremde Zeilen unverändert');
  assert.ok(r.text.includes('- **Z-003** · Bernd → Knut · Neu\r\n'), 'CRLF bleibt');
  assert.equal(r.text.split('\r\n').length - 1, hand.split('\r\n').length, 'genau eine Zeile mehr');
  assert.ok(r.text.includes('irgendwas\r\n'));
  // ohne Zeilenende am Ende
  const ohne = '## Offen\n- **Z-001** · A → B · c';
  const r2 = wendeZusagenAn(ohne, [{ art: 'neu', wer: 'D', was: 'e' }], HEUTE);
  assert.equal(r2.text, '## Offen\n- **Z-001** · A → B · c\n- **Z-002** · D → Knut · e\n');
  // Abschnitt fehlt → angelegt
  const r3 = wendeZusagenAn('# nur Titel\n', [{ art: 'neu', wer: 'D', was: 'e' }], HEUTE);
  assert.match(r3.text, /\n## Offen\n\n- \*\*Z-001\*\*/);
});

test('Themen: anlegen, ändern, Name passt zu themaOf (K9)', async () => {
  const t = neueDatei('themen', HEUTE, { themen: ['Flex', 'Cockpit'] });
  assert.equal(parseThemen(t).themen.length, 2);
  const r = wendeThemaAn(t, { art: 'thema', name: 'Flex', stand: 'Umfrage läuft', ball: 'Knut' }, '2026-10-17');
  const f = parseThemen(r.text).themen.find((x) => x.name === 'Flex')!;
  assert.deepEqual([f.stand, f.ball, f.geaendert], ['Umfrage läuft', 'Knut', '2026-10-17']);
  assert.equal(parseThemen(r.text).themen.find((x) => x.name === 'Cockpit')!.geaendert, HEUTE);
  const n = wendeThemaAn(r.text, { art: 'thema', name: 'Rogue', naechster: 'Vertrag' }, HEUTE);
  assert.equal(parseThemen(n.text).themen.length, 3);
  const { THEMEN } = await import('../server/themen.ts');
  for (const th of THEMEN) assert.equal(parseThemen(neueDatei('themen', HEUTE, { themen: [th.thema] }).replace(/\n$/, '\n')).themen[0].name, th.thema);
});

test('Termine im Register', () => {
  assert.deepEqual(parseTermin('- Termin Fr 23.10. 10:00 Rogue: Vertrag · mit: Christoph, Knut', 3), { zeile: 3, text: 'Termin Fr 23.10. 10:00 Rogue: Vertrag · mit: Christoph, Knut', datum: `${new Date().getFullYear()}-10-23`, zeit: '10:00', titel: 'Rogue: Vertrag', mit: ['Christoph', 'Knut'] });
  assert.equal(parseTermin('- 2026-10-23 Sync', 1).datum, '2026-10-23');
});

test('Pipeline: Vorschau schreibt nie, Datei wird beim ersten confirm angelegt, 409 bei Änderung', async () => {
  const v = vault();
  const o = { vaultDir: v, heute: HEUTE, locked: () => false };
  const pre = await schreibeZusagen([{ art: 'neu', wer: 'Anna', was: 'Etwas' }], o);
  assert.ok('needsConfirm' in pre);
  assert.equal(existsSync(join(v, 'olaf/1-Projects/chief-of-staff/zusagen-register.md')), false);
  const ok = await schreibeZusagen([{ art: 'neu', wer: 'Anna', was: 'Etwas' }], { ...o, confirm: true, hash: (pre as any).hash }) as any;
  assert.deepEqual(ok.ids, ['Z-001']);
  const text = readFileSync(join(v, 'olaf/1-Projects/chief-of-staff/zusagen-register.md'), 'utf8');
  assert.match(text, /^---\ntitle: "Zusagen-Register"/);
  assert.match(text, /type: reference\nteam: olaf\narea: operations/);
  assert.match(text, /- \*\*Z-001\*\* · Anna → Knut · Etwas/);
  // veralteter Hash
  await assert.rejects(schreibeZusagen([{ art: 'neu', was: 'Zweite' }], { ...o, confirm: true, hash: (pre as any).hash }), (e: any) => e.status === 409 && /geändert/.test(e.message));
  // Dry-Lauf schreibt nicht
  const dry = await schreibeZusagen([{ art: 'neu', was: 'Trocken' }], { ...o, confirm: true, dry: true }) as any;
  assert.equal(dry.dry, true);
  assert.ok(!readFileSync(join(v, 'olaf/1-Projects/chief-of-staff/zusagen-register.md'), 'utf8').includes('Trocken'));
  // Register lesen
  const lr = liesRegister(v);
  assert.equal(lr.zusagen.length, 1); assert.equal(lr.vorhanden.themen, false);
});

test('Pipeline: Vault-Sync-Sperre = 409 (K2), Hash wird direkt vor dem Schreiben erneut geprüft', async () => {
  const v = vault();
  await assert.rejects(schreibeZusagen([{ art: 'neu', was: 'x' }], { vaultDir: v, confirm: true, locked: () => true }), (e: any) => e.status === 409 && /Vault-Sync/.test(e.message));
  assert.equal(existsSync(join(v, 'olaf/1-Projects/chief-of-staff/zusagen-register.md')), false);
  // Hand-Änderung zwischen Lesen und Schreiben: `locked` wird nach dem Lesen aufgerufen → hier ändern wir dort die Datei.
  const dir = join(v, 'olaf/1-Projects/chief-of-staff'); mkdirSync(dir, { recursive: true });
  const f = join(dir, 'zusagen-register.md');
  writeFileSync(f, REG);
  let n = 0;
  await assert.rejects(schreibeZusagen([{ art: 'neu', was: 'x' }], { vaultDir: v, confirm: true, locked: () => { if (n++ === 0) writeFileSync(f, REG + '\n- von Hand\n'); return false; } }), (e: any) => e.status === 409);
  assert.ok(readFileSync(f, 'utf8').endsWith('- von Hand\n'));
});

test('Warteschlange (K18): zwei gleichzeitig bestätigte Schreiben bekommen Z-001 und Z-002', async () => {
  const v = vault();
  const o = { vaultDir: v, heute: HEUTE, locked: () => false, confirm: true };
  const [a, b] = await Promise.all([schreibeZusagen([{ art: 'neu', was: 'eins' }], o), schreibeZusagen([{ art: 'neu', was: 'zwei' }], o)]) as any[];
  assert.deepEqual([a.ids[0], b.ids[0]], ['Z-001', 'Z-002']);
  assert.equal(parseRegister(readFileSync(join(v, 'olaf/1-Projects/chief-of-staff/zusagen-register.md'), 'utf8')).zusagen.length, 2);
});

test('Datei anlegen: Personen aus Intern/2-Areas/People vorbefüllt', async () => {
  const v = vault();
  const pd = join(v, 'Intern/2-Areas/People'); mkdirSync(pd, { recursive: true });
  writeFileSync(join(pd, 'christoph-bitzner.md'), '---\ntitle: "Christoph Bitzner"\naliases: ["Christoph", "martenc"]\n---\n# x\n');
  writeFileSync(join(pd, 'knut.md'), '---\ntitle: "Knut"\naliases: []\n---\n# x\n');
  const names = teamNamen(v);
  assert.equal(names.length, 2);
  await schreibeZusagen([{ art: 'neu', wer: 'martenc', was: 'x' }], { vaultDir: v, confirm: true, locked: () => false, vorbefuellung: () => ({ personen: names }) });
  const r = liesRegister(v);
  assert.ok(r.personen.some((p) => p.name === 'Christoph Bitzner' && p.auch.includes('martenc')));
  assert.equal(seiteVon('martenc', r.personen, teamSet(names)), 'Team');
  await schreibeThema({ art: 'thema', name: 'Flex', ball: 'Knut' }, { vaultDir: v, confirm: true, locked: () => false, vorbefuellung: () => ({ themen: ['Cockpit'] }) });
  assert.deepEqual(liesRegister(v).themen.map((t) => t.name).sort(), ['Cockpit', 'Flex']);
});

test('Register aus dem aktuellen Stand (Knut 19.10.): Themen mit Stand, nächstem Schritt und Ball — lesbar und in Vorschlags-Reihenfolge', async () => {
  const { themenAusStand } = await import('../server/cos.ts');
  const t = (key: string, o: any = {}) => ({ key, summary: 'S ' + key, status: 'In Progress', assignee: 'Daniela Martinez', duedate: '2026-10-25', updated: '2026-10-10T00:00:00Z', workstream: 'PM-70', ...o });
  const vor = themenAusStand([t('PM-1', { duedate: '2026-10-10' }), t('PM-2'), t('PM-3', { status: 'Done', statusCategory: 'done' }), t('PM-4', { workstream: 'PM-73', assignee: 'Knut Peters', duedate: null })],
    { 'PM-70': 'Bill-OCR', 'PM-73': 'Cockpit' },
    [{ id: 'k1', titel: 'Strang Flex', thema: 'Flex', ampel: 'review', running: false, braucht: 'Zugang fehlt', entscheidungen: [] } as any, { id: 'k2', titel: 'OCR-Feinschliff', thema: 'Bill-OCR', ampel: 'laeuft', running: true, braucht: null, entscheidungen: [] } as any], '2026-10-19');
  assert.deepEqual(vor.map((x) => x.name), ['Bill-OCR', 'Cockpit', 'Flex'], 'Überfälliges zuerst; Strang-Thema, das schon Workstream ist, nicht doppelt');
  assert.deepEqual(vor[0], { name: 'Bill-OCR', stand: '2 offene Tickets, 1 überfällig (Jira PM-70)', naechster: 'PM-1 S PM-1 (fällig 10.10.)', ball: 'Daniela' });
  assert.deepEqual(vor[2], { name: 'Flex', stand: '1 offener Unter-Chat', naechster: 'Zugang fehlt', ball: 'Knut' });
  const datei = neueDatei('themen', HEUTE, { themen: vor });
  const th = parseThemen(datei).themen;
  assert.deepEqual(th.map((x) => x.name), ['Bill-OCR', 'Cockpit', 'Flex']);
  assert.equal(th[0].ball, 'Daniela'); assert.match(th[0].stand, /1 überfällig/); assert.match(th[0].naechster, /PM-1/);
});

test('Gegenprüfung 19.10.: Vorschau = Datei — gleiche Themennamen fallen schon im Vorschlag zusammen, höchstens 60', async () => {
  const { themenEindeutig } = await import('../server/cosregister.ts');
  const l = themenEindeutig([{ name: 'Produkt OLAF' }, { name: 'produkt-olaf' }, { name: 'Flexibilität' }, { name: 'Flexibilitat' }, { name: ' ' }]);
  assert.deepEqual(l.map((x) => x.name), ['Produkt OLAF', 'Flexibilität']);
  assert.equal(parseThemen(neueDatei('themen', HEUTE, { themen: l })).themen.length, l.length, 'Datei hat genau die Zeilen der Vorschau');
  assert.equal(themenEindeutig(Array.from({ length: 70 }, (_, n) => ({ name: 'T' + n }))).length, 60);
});
