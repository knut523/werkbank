// Deck-Review (docs/plan-deck-review.md): reine Regeln — Dateinamen, Fassungen, Status, Token, Rate-Limit, sichere Pfade, Hash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  dateiLesen, fassungVergleich, gruppieren, naechsteFassung, statusWechsel, rueckmeldungErlaubt, markierungPruefen, markierungText,
  neuesToken, tokenHash, tokenFormOk, linkGueltig, ablaufAus, Fenster, folienPfad, pgmHash, geaendert, nachrichtAnUnterchat, kommentarPruefen,
  STATUS_TEXT, deckTitel, slugOk, fassungOk,
} from '../server/decks.ts';

test('Dateiname: Datum, Slug, Fassung und Art; alles andere ist kein Deck', () => {
  assert.deepEqual(dateiLesen('2026-11-06_deck_olaf-zwischengate_v7-skizze.pdf'), { datum: '2026-11-06', slug: 'olaf-zwischengate', fassung: 'v7-skizze', art: 'pdf' });
  assert.deepEqual(dateiLesen('2026-11-05_deck_db1-modell-analyse_v1-2.pptx'), { datum: '2026-11-05', slug: 'db1-modell-analyse', fassung: 'v1-2', art: 'pptx' });
  assert.equal(dateiLesen('2026-04-23_deck_olaf-stage-gate.pdf'), null, 'ohne Fassung');
  assert.equal(dateiLesen('2026-11-03_notiz_x_v1.pdf'), null, 'keine Deck-Art');
  assert.equal(dateiLesen('2026-11-03_deck_../etc_v1.pdf'), null, 'Slug mit Pfadteilen');
  assert.equal(dateiLesen('2026-11-03_deck_x_v1.pdf.bak'), null);
});

test('Fassungen: natürliche Reihenfolge (v5 < v5-1 < v5-2 < v5-10 < v6 < v7 < v7-skizze)', () => {
  const l = ['v6', 'v5-10', 'v7-skizze', 'v5', 'v5-2', 'v7', 'v5-1'];
  assert.deepEqual([...l].sort(fassungVergleich), ['v5', 'v5-1', 'v5-2', 'v5-10', 'v6', 'v7', 'v7-skizze']);
});

test('Gruppieren: je Slug die Fassungen, pdf bevorzugt, bei Doppelten die neuere Datei', () => {
  const g = gruppieren([
    { pfad: '/a/2026-11-05_deck_flex_v1.pptx', mtime: 1 },
    { pfad: '/a/2026-11-05_deck_flex_v1.pdf', mtime: 2 },
    { pfad: '/b/2026-11-06_deck_flex_v2.pdf', mtime: 5 },
    { pfad: '/c/2026-11-06_deck_flex_v2.pdf', mtime: 9 },
    { pfad: '/c/2026-11-06_deck_wirt_v1.pptx', mtime: 3 },
    { pfad: '/c/readme.md', mtime: 3 },
  ]);
  assert.deepEqual(g.map((d) => d.slug), ['flex', 'wirt'], 'nach neuester Änderung? nein — alphabetisch stabil');
  const flex = g[0];
  assert.deepEqual(flex.fassungen.map((f) => f.fassung), ['v1', 'v2']);
  assert.equal(flex.fassungen[0].pdf, '/a/2026-11-05_deck_flex_v1.pdf');
  assert.equal(flex.fassungen[0].pptx, '/a/2026-11-05_deck_flex_v1.pptx');
  assert.equal(flex.fassungen[1].pdf, '/c/2026-11-06_deck_flex_v2.pdf', 'die neuere von zwei gleichnamigen');
  assert.equal(g[1].fassungen[0].pdf, null);
  assert.equal(flex.mtime, 9);
});

test('Nächste Fassung: v5 → v5-1, v5-1 → v5-2, v7-skizze → v7-skizze-1', () => {
  assert.equal(naechsteFassung('v5'), 'v5-1');
  assert.equal(naechsteFassung('v5-1'), 'v5-2');
  assert.equal(naechsteFassung('v5-19'), 'v5-20');
  assert.equal(naechsteFassung('v7-skizze'), 'v7-skizze-1');
});

test('Status: erlaubte Wechsel, abgelehnt nur mit Grund', () => {
  assert.equal(statusWechsel('offen', 'gesendet', ''), null);
  assert.equal(statusWechsel('gesendet', 'umgesetzt', ''), null);
  assert.match(String(statusWechsel('gesendet', 'abgelehnt', '')), /Grund/);
  assert.equal(statusWechsel('gesendet', 'abgelehnt', 'passt nicht zur Storyline'), null);
  assert.equal(statusWechsel('umgesetzt', 'offen', ''), null, 'wieder öffnen');
  assert.equal(statusWechsel('notiz', 'offen', ''), null, 'Notiz doch an den Unter-Chat');
  assert.match(String(statusWechsel('notiz', 'gesendet', '')), /nicht/);
  assert.match(String(statusWechsel('offen', 'quatsch' as any, '')), /Status/);
  for (const s of ['offen', 'gesendet', 'umgesetzt', 'abgelehnt', 'notiz']) assert.ok(STATUS_TEXT[s as keyof typeof STATUS_TEXT]);
  assert.doesNotMatch(Object.values(STATUS_TEXT).join(' '), /Strang/, 'sichtbare Begriffe ohne „Strang“');
});

test('Rückmeldung des Unter-Chats: nur für gesendete (oder schon zurückgemeldete) Kommentare, nur umgesetzt/abgelehnt', () => {
  assert.equal(rueckmeldungErlaubt('gesendet', 'umgesetzt'), true);
  assert.equal(rueckmeldungErlaubt('umgesetzt', 'abgelehnt'), true, 'Korrektur');
  assert.equal(rueckmeldungErlaubt('offen', 'umgesetzt'), false, 'nie gesendet');
  assert.equal(rueckmeldungErlaubt('notiz', 'umgesetzt'), false);
  assert.equal(rueckmeldungErlaubt('gesendet', 'offen' as any), false);
});

test('Markierung: Rechteck in Anteilen 0..1, sonst null; Text für den Unter-Chat', () => {
  assert.deepEqual(markierungPruefen({ x: 0.1, y: 0.2, w: 0.3, h: 0.15 }), { x: 0.1, y: 0.2, w: 0.3, h: 0.15 });
  assert.equal(markierungPruefen(null), null);
  assert.equal(markierungPruefen({ x: -1, y: 0, w: 0.5, h: 0.5 }), null);
  assert.equal(markierungPruefen({ x: 0.9, y: 0, w: 0.5, h: 0.5 }), null, 'ragt hinaus');
  assert.equal(markierungPruefen({ x: 0.1, y: 0.1, w: 0, h: 0.5 }), null, 'leer');
  assert.equal(markierungPruefen({ x: '0.1', y: 0.1, w: 0.2, h: 0.2 }), null, 'keine Zahl');
  assert.match(markierungText({ x: 0.1, y: 0.2, w: 0.3, h: 0.15 }), /links.*oben|oben.*links/);
  assert.match(markierungText({ x: 0.1, y: 0.2, w: 0.3, h: 0.15 }), /10–40 %/);
});

test('Kommentar: Text 1–4000 Zeichen, Folie 0 (ganzes Deck) bis 999, Name höchstens 40', () => {
  assert.deepEqual(kommentarPruefen({ text: ' Hallo ', folie: 3, name: ' Peter ' }), { text: 'Hallo', folie: 3, name: 'Peter', markierung: null });
  assert.match(String((kommentarPruefen({ text: '   ', folie: 1 }) as any).fehler), /leer/);
  assert.match(String((kommentarPruefen({ text: 'x'.repeat(4001), folie: 1 }) as any).fehler), /lang/);
  assert.match(String((kommentarPruefen({ text: 'x', folie: -1 }) as any).fehler), /Folie/);
  assert.match(String((kommentarPruefen({ text: 'x', folie: 1.5 }) as any).fehler), /Folie/);
  assert.equal((kommentarPruefen({ text: 'x', folie: 1, name: 'n'.repeat(80) }) as any).name.length, 40);
  assert.equal((kommentarPruefen({ text: 'x', folie: 0, markierung: { x: 0, y: 0, w: 1, h: 1 } }) as any).markierung, null, 'Markierung nur auf einer Folie');
});

test('Token: 32 Byte Zufall, base64url, gespeichert wird nur der Hash; Form wird vor der Suche geprüft', () => {
  const a = neuesToken(), b = neuesToken();
  assert.notEqual(a, b);
  assert.equal(tokenFormOk(a), true);
  assert.equal(tokenFormOk('abc'), false);
  assert.equal(tokenFormOk(a + '/'), false);
  assert.equal(tokenFormOk(undefined), false);
  assert.match(tokenHash(a), /^[0-9a-f]{64}$/);
  assert.notEqual(tokenHash(a), a);
});

test('Link: gültig nur vor Ablauf und nicht widerrufen; Ablauf 1–90 Tage, Vorgabe 14', () => {
  const jetzt = Date.parse('2026-11-07T12:00:00Z');
  assert.equal(linkGueltig({ ablauf: new Date(jetzt + 1000), widerrufen: null }, jetzt), true);
  assert.equal(linkGueltig({ ablauf: new Date(jetzt - 1), widerrufen: null }, jetzt), false);
  assert.equal(linkGueltig({ ablauf: new Date(jetzt + 1000), widerrufen: new Date(jetzt) }, jetzt), false);
  assert.equal(ablaufAus(undefined, jetzt).getTime(), jetzt + 14 * 86_400_000);
  assert.equal(ablaufAus(500, jetzt).getTime(), jetzt + 90 * 86_400_000);
  assert.equal(ablaufAus(0, jetzt).getTime(), jetzt + 1 * 86_400_000);
});

test('Rate-Limit: höchstens max je Fenster und Schlüssel, danach wieder frei', () => {
  const f = new Fenster(3, 1000);
  assert.deepEqual([f.erlaubt('a', 0), f.erlaubt('a', 10), f.erlaubt('a', 20), f.erlaubt('a', 30)], [true, true, true, false]);
  assert.equal(f.erlaubt('b', 30), true, 'anderer Schlüssel');
  assert.equal(f.erlaubt('a', 1011), true, 'Fenster vorbei');
});

test('Folienpfad: nur gültige Slugs/Fassungen/Nummern, immer unter der Wurzel', () => {
  const w = '/tmp/decks';
  assert.equal(folienPfad(w, 'flex', 'v7-1', 3), join(w, 'flex', 'v7-1', 's-03.png'));
  assert.equal(folienPfad(w, 'flex', 'v7-1', 120), join(w, 'flex', 'v7-1', 's-120.png'));
  assert.equal(folienPfad(w, '..', 'v1', 1), null);
  assert.equal(folienPfad(w, 'flex', '../../etc', 1), null);
  assert.equal(folienPfad(w, 'flex', 'v1', 0), null);
  assert.equal(folienPfad(w, 'flex', 'v1', 1000), null);
  assert.equal(folienPfad(w, 'flex', 'v1', 1.5), null);
  assert.equal(slugOk('a-b-1'), true); assert.equal(slugOk('A'), false); assert.equal(fassungOk('v1-x'), true); assert.equal(fassungOk('v1/..'), false);
});

test('Hash aus PGM: unterer Rand (Fußzeile, 12 %) zählt nicht; Änderung darüber schon', () => {
  const pgm = (fill: (y: number) => number, w = 10, h = 100) => {
    const kopf = Buffer.from(`P5\n# Kommentar\n${w} ${h}\n255\n`);
    const daten = Buffer.alloc(w * h); for (let y = 0; y < h; y++) daten.fill(fill(y), y * w, (y + 1) * w);
    return Buffer.concat([kopf, daten]);
  };
  const a = pgmHash(pgm(() => 10));
  assert.equal(pgmHash(pgm((y) => (y >= 90 ? 200 : 10))), a, 'nur Fußzeile anders');
  assert.notEqual(pgmHash(pgm((y) => (y === 50 ? 200 : 10))), a);
  assert.equal(pgmHash(Buffer.from('kein Bild')), null);
});

test('Geändert: Folien, deren Hash sich unterscheidet oder die neu sind; ohne Hashes unbekannt', () => {
  assert.deepEqual(geaendert(['a', 'b', 'c'], ['a', 'x', 'c', 'd']), [2, 4]);
  assert.equal(geaendert([], ['a']), null);
  assert.equal(geaendert(['a'], null), null);
});

test('Nachricht an den Unter-Chat: je Kommentar Kennung, Folie, Fassung, Markierung, wer; Ablageziel und Rückmeldeweg', () => {
  const t = nachrichtAnUnterchat({
    slug: 'flex', titel: 'Flex', fassung: 'v7-2', ordner: '/x/teilen/vortrag-flex', heute: '2026-11-07',
    kommentare: [
      { id: 'k1', folie: 0, fassung: 'v7-1', text: 'Storyline straffen', autor: 'Knut', markierung: null },
      { id: 'k2', folie: 4, fassung: 'v7-2', text: 'Zahl falsch', autor: 'Peter', extern: true, markierung: { x: 0.7, y: 0.6, w: 0.2, h: 0.2 } },
    ],
  });
  assert.match(t, /\[k1\] Ganzes Deck/);
  assert.match(t, /\[k2\] Folie 4 \(Fassung v7-2\).*Peter \(extern\)/);
  assert.match(t, /Markierung: .*rechts.*unten|Markierung: .*unten.*rechts/);
  assert.match(t, /\/x\/teilen\/vortrag-flex\/2026-11-07_deck_flex_v7-3\.pptx/);
  assert.match(t, /deck_rueckmeldung/);
  assert.match(t, /deck="flex"/);
});

test('Deck-Titel aus dem Slug', () => {
  assert.equal(deckTitel('olaf-zwischengate'), 'Olaf zwischengate');
});
