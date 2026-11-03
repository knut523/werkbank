// Release 32, Nachtrag 5: (1) Strangzustand = Wahrheit der Brücke, (2) Dokumente mit Link, (3) Übergabe, (4) Seite „Heute erledigt“.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wahrerLauf, uebergabeAus } from '../server/strangwahrheit.ts';
import { dokumentLinks, kartenLinks } from '../server/uebersicht.ts';
import { fertigHeute } from '../server/lage.ts';
import { baueErledigt, tagGrenzen } from '../server/erledigt.ts';

test('wahrerLauf: „läuft“ nur, wenn die Brücke einen Zug hat — gestorbener Zug → wartet/abgebrochen mit Grund', () => {
  const d = { lastStatus: 'running' };
  assert.deepEqual(wahrerLauf(d, { running: true, interrupted: false, turn: { start: 1, end: null, outcome: null } } as any, true), { running: true, korrektur: null });
  const tot = wahrerLauf(d, { running: false, interrupted: false, turn: { start: 1, end: 5, outcome: 'ok' } } as any, true);
  assert.equal(tot.running, false); assert.equal(tot.korrektur?.zustand, 'wartet'); assert.match(tot.korrektur!.grund, /Zug beendet/);
  const ab = wahrerLauf(d, { running: false, interrupted: true, turn: null } as any, true);
  assert.equal(ab.korrektur?.zustand, 'abgebrochen'); assert.match(ab.korrektur!.grund, /abgebrochen|Neustart/);
  const fehlt = wahrerLauf(d, undefined, true);
  assert.equal(fehlt.running, false); assert.match(fehlt.korrektur!.grund, /kein laufender Zug|Neustart/i);
  assert.equal(wahrerLauf(d, { running: false, queued: { pos: 2, since: 1 } } as any, true).running, true, 'in der Schlange gilt als aktiv');
  assert.deepEqual(wahrerLauf(d, undefined, false), { running: true, korrektur: null }, 'Brücke nicht erreichbar → nichts behaupten');
  assert.deepEqual(wahrerLauf({ lastStatus: 'done' }, undefined, true), { running: false, korrektur: null });
});

test('Übergabe: „- Übergeben an: Hauptchat — …“ bzw. „Status: übergeben“ erkannt, sonst null', () => {
  assert.deepEqual(uebergabeAus('### Stand\n- Erledigt: x\n- Übergeben an: Hauptchat — Merge von tariff-app#193\nStatus: fertig'), { an: 'Hauptchat', was: 'Merge von tariff-app#193' });
  assert.deepEqual(uebergabeAus('Status: übergeben an Hauptchat'), { an: 'Hauptchat', was: '' });
  assert.deepEqual(uebergabeAus('- Uebergeben an: Christoph'), { an: 'Christoph', was: '' });
  assert.equal(uebergabeAus('- Braucht Knut: nichts\nStatus: fertig'), null);
  assert.equal(uebergabeAus(null), null);
});

test('Dokumente: PDF, PPTX, DOCX, HTML-Seiten werden Download-Links (nicht index.html), je mit Dateiname', () => {
  const f = (rel: string) => ({ rel, size: 1, mtimeMs: 1 });
  const l = dokumentLinks('500-bot', [f('bericht.md'), f('folien.pptx'), f('angebot.pdf'), f('index.html'), f('seite.html'), f('x/bilanz.xlsx'), f('bild.png'), f('notiz.docx')]);
  assert.deepEqual(l.map((x) => x.label).sort(), ['angebot.pdf', 'bilanz.xlsx', 'folien.pptx', 'notiz.docx', 'seite.html']);
  assert.ok(l.every((x) => x.art === 'dokument' && x.url.startsWith('/api/files/agenten/500-bot/')));
  assert.ok(l.find((x) => x.label === 'bilanz.xlsx')!.url.endsWith('/x/bilanz.xlsx'));
  const k = kartenLinks({ id: 's1', bericht: true, paket: '500-bot', dateien: [f('bericht.md'), f('a.pdf')], basis: null, kopf: null, chat: null });
  assert.ok(k.some((x) => x.art === 'dokument' && x.label === 'a.pdf'), 'auch ohne Paketdienst-Adresse');
});

test('Heute fertig trägt die Dokumente jedes Strangs mit', () => {
  const k: any = { id: 'a', titel: 'Ergebnis', strangTitel: 'S', thema: 'Bot', ampel: 'review', running: false, wartet: false, eta: null, statusAt: '2026-11-03T08:00:00.000Z', chat: 'https://c/a',
    links: [{ art: 'bericht', label: 'Bericht', url: '#/b' }, { art: 'dokument', label: 'folien.pptx', url: '/api/files/agenten/500-x/folien.pptx' }] };
  const f = fertigHeute([k], [], '2026-11-03T05:00:00.000Z');
  assert.deepEqual(f[0].dokumente, [{ label: 'folien.pptx', url: '/api/files/agenten/500-x/folien.pptx' }]);
});

test('Heute erledigt: Tagesgrenzen Wien; Stränge, gepushte PRs, Entscheidungen, Releases des Tages — nichts von anderen Tagen', () => {
  const g = tagGrenzen('2026-11-03'); assert.equal(g.von, '2026-11-02T23:00:00.000Z'); assert.equal(g.bis, '2026-11-03T23:00:00.000Z');
  assert.equal(tagGrenzen('2026-07-01').von, '2026-06-30T22:00:00.000Z', 'Sommerzeit');
  const e = baueErledigt('2026-11-03', {
    straenge: [{ id: 'a', titel: 'Lückenliste steht', strang: 'Umzug', thema: 'Werkbank', at: '2026-11-03T08:00:00Z', link: '#/leitstand?bericht=a', dokumente: [{ label: 'x.pdf', url: '/u' }] }, { id: 'b', titel: 'Gestern', strang: 'G', thema: '', at: '2026-11-02T08:00:00Z', link: null, dokumente: [] }],
    pushes: [{ strang: 'a', repo: 'olaf-bot', zweig: 'feat/x', commit: 'abcdef1234', at: '2026-11-03T09:00:00Z', pr: 'https://github.com/o/r/pull/5' }, { strang: 'z', repo: 'r', zweig: 'z', commit: 'z', at: '2026-11-01T09:00:00Z', pr: null }],
    entscheidungen: [{ titel: 'Frist?', antwort: 'ja', at: '2026-11-03T10:00:00Z', auto: false }, { titel: 'alt', antwort: 'nein', at: '2026-10-01T10:00:00Z', auto: false }],
    releases: [{ name: 'Release 31b', at: '2026-11-03T11:00:00Z' }],
  });
  assert.deepEqual(e.zahlen, { straenge: 1, pushes: 1, entscheidungen: 1, releases: 1 });
  assert.equal(e.straenge[0].dokumente.length, 1); assert.equal(e.pushes[0].commit, 'abcdef1');
  assert.equal(e.datum, '2026-11-03');
});
