// R30b-Nachbesserung (Knut 02.11., echter Fall): Unter-Chat „Cockpit-ARR: Preis für importierte Verträge (EG/BEG/Rest)“
// (574aa7bb, blockiert) bat um „Zugang zu DEV: Tunnel mit lesender Rolle oder die 5–10 Ergebniszeilen der SQL“ — die Karte
// sagte „Nichts für dich — der Hauptchat kann das ausführen (push-nach-gate)“, mit Marke „wichtig“ und Kopf „1 Frage an dich“.
// Regeln: Zugänge/Zugangsdaten/Tunnel/DB/Geld/Recht/externe Personen und offene D-Entscheidungen sind immer (a); unsicher → (a).
// Kopf zählt nur (a); (b) trägt nie „wichtig“ und kommt beim Hauptchat an. Dazu die drei Beispiele des früheren Nachtrags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { klassifiziere, sqlAus, prsAus } from '../server/braucht.ts';
import { braucheBraucht, kartEingabe, wendeAufInbox, aktionText, type BrauchtFakten } from '../server/brauchtab.ts';
import { chatStatus, offeneJeStrang, hauptchatJeStrang, CHAT_STATUS_TEXT } from '../server/chatstatus.ts';
import { fragenAus } from '../server/entscheidungsseite.ts';

const ALLE = ['push-nach-gate', 'merge-im-worktree', 'skill-installieren', 'strang-neustarten', 'cli-lesen'];
const ctx = (o: Partial<Parameters<typeof klassifiziere>[1]> = {}) => ({
  kennung: 'b-x', beantwortet: (_k: string) => false, paketLive: (_n: number) => false, prZu: (_pr: string) => null as boolean | null,
  laufNeuere: (_l: string) => false, hauptchatAktionen: ALLE, ...o,
});
const fakten = (o: Partial<BrauchtFakten> = {}): BrauchtFakten => ({ beantwortet: [], paketeLive: [], prsZu: [], laeufeNeuer: [], aktionen: ALLE, ...o });

// Der echte Fall: die Bitte des Strangs wörtlich; die Karte zeigte „push-nach-gate“ — im Stand stand also auch der Push
// („Push und Draft-PR nach deinem Ok“ steht im Bericht des Pakets 379 unter offen:).
const ECHT = 'Zugang zu DEV: Tunnel mit lesender Rolle oder die 5–10 Ergebniszeilen der SQL (siehe oben).';
const ECHT_MIT_PUSH = `${ECHT} Danach Push und Draft-PR nach deinem Ok.`;
const SQL = "SELECT mp.max_energy_rate_ap FROM meter_points mp JOIN contracts c ON c.id = mp.contract_id\nORDER BY mp.max_energy_rate_synced_at DESC LIMIT 10;";
const STAND = `Ich brauche die Einheit von rate_ap:\n\n\`\`\`sql\n${SQL}\n\`\`\`\n\n### Stand\n- Braucht Knut: ${ECHT_MIT_PUSH}`;

test('echter Fall 574aa7bb: DEV-Zugang/SQL ist (a) — auch wenn die Zeile zusätzlich „Push“ sagt', () => {
  for (const z of [ECHT, ECHT_MIT_PUSH]) {
    const r = klassifiziere(z, ctx());
    assert.equal(r.art, 'entscheidung', z);
    assert.equal(r.nurKnut, 'datenbank');
    assert.equal(r.aktion, undefined, 'keine Hauptchat-Aktion');
    assert.match(r.wasTun, /DEV-Abfrage ausführen lassen/);
    assert.match(r.wasTun, /lesenden Zugang geben/);
    assert.match(r.wasTun, /Zahlen selbst liefern/);
    assert.match(r.wasTun, /Zugang zu DEV: Tunnel/, "die Bitte des Unter-Chats steht wörtlich dabei");
    assert.doesNotMatch(r.wasTun, /Nichts für dich|push-nach-gate/);
  }
});

test('harte Regeln: Zugangsdaten · Prod-DB · Geld · Recht · externe Person schlagen jede erkannte Aktion', () => {
  const faelle: [string, string][] = [
    ['ADMIN_API_KEY rotieren, danach pushen', 'zugang'],
    ['Passwort für den Tunnel schicken und Push freigeben', 'zugang'],
    ['Prod-DB-Abfrage fahren, dann Merge', 'datenbank'],
    ['Rechnung von Melious bezahlen, danach Push-Ok', 'geld'],
    ['Überweisung freigeben und pushen', 'geld'],
    ['AVV unterschreiben, dann Merge', 'recht'],
    ['Bei Christoph nachfragen, danach Push', 'extern'],
    ['Kunden anrufen und danach den Strang neu starten', 'extern'],
  ];
  for (const [z, art] of faelle) {
    const r = klassifiziere(z, ctx());
    assert.equal(r.art, 'entscheidung', z);
    assert.equal(r.nurKnut, art, z);
  }
});

test('offene D-Entscheidung in der Zeile → (a), auch neben einer Aktion; beantwortet → wie vorher', () => {
  assert.equal(klassifiziere('D1–D4 entscheiden, danach Push', ctx()).art, 'entscheidung');
  assert.equal(klassifiziere('D2 klären, Merge danach', ctx()).nurKnut, 'entscheidung');
  assert.equal(klassifiziere('D2 klären, Merge danach', ctx({ beantwortet: (k) => k === 'D2' })).art, 'veraltet', 'beantwortet → (c)');
});

test('Hauptchat-Aufgaben bleiben (b), wenn nichts davon zutrifft', () => {
  assert.equal(klassifiziere('Push-Ok für den Zweig', ctx()).aktion, 'push-nach-gate');
  assert.equal(klassifiziere('Skill im Repo installieren (Kopierpfad beachten)', ctx()).aktion, 'skill-installieren');
  assert.equal(klassifiziere('Strang nach Fehler neu starten', ctx()).aktion, 'strang-neustarten');
  assert.equal(klassifiziere('nach dem Deploy die CLI laufen lassen', ctx()).aktion, 'cli-lesen');
  // Wortgrenzen mit Umlauten: „Kontrolle“ ist keine „Rolle“, „Abo“ kein „DB“-Treffer, „Zeichen“ in „Kennzeichen“ zählt nicht.
  assert.equal(klassifiziere('Push nach Kontrolle des Kennzeichens', ctx()).art, 'aktion');
  // Pass C: „entschieden“ (schon entschieden) ist keine offene Entscheidung; foreign_key ist kein Zugang.
  assert.equal(klassifiziere('Knut hat entschieden: Skill im Repo installieren', ctx()).art, 'aktion');
  assert.equal(klassifiziere('foreign_key ergänzen, dann Push', ctx()).nurKnut, undefined);
});

// --- die drei Beispiele des früheren Nachtrags (UAT = veraltet, Ticker-Fix = veraltet, #193-Merge = (b)) ---
const uat = kartEingabe({ strand: 'e3ea4584', titel: 'Admin-UAT', zeile: 'Liste mit Skill-Kopierpfad abarbeiten und D1–D3 entscheiden' });
const ticker = kartEingabe({ strand: 'bb126900', titel: 'Ticker-Fix', zeile: 'Push-Ok für den Zweig, D1 entscheiden, nach dem Deploy die CLI laufen lassen', paket: 269 });
const merge = kartEingabe({ strand: 'cc193000', titel: 'tariff-app #193', zeile: 'Merge muss in diesem Strang erlaubt werden oder der Hauptchat führt ihn aus' });
const arr = kartEingabe({ strand: '574aa7bb', titel: 'Cockpit-ARR: Preis für importierte Verträge (EG/BEG/Rest)', zeile: ECHT_MIT_PUSH, sql: sqlAus(STAND) });

test('alle vier Karten zusammen: UAT (c) · Ticker (c) · #193 (b) · ARR (a) mit SQL zum Kopieren', () => {
  const r = braucheBraucht([uat, ticker, merge, arr], fakten({ beantwortet: ['e3ea4584:D1', 'e3ea4584:D2', 'e3ea4584:D3'], paketeLive: [269] }), { an: true });
  assert.deepEqual(r.geschlossen.map((g) => g.strand).sort(), ['bb126900', 'e3ea4584']);
  assert.deepEqual(r.aktionen.map((p) => [p.strand, p.aktion]), [['cc193000', 'merge-im-worktree']]);
  const a = r.punkte.find((p) => p.strand === '574aa7bb')!;
  assert.equal(a.art, 'entscheidung');
  assert.equal(a.nurKnut, 'datenbank');
  assert.equal(a.sql, SQL, 'die SQL aus dem Stand liegt der Karte bei');
  assert.deepEqual(a.antworten, ['ja', 'nein', 'anders', 'spaeter']);
});

test('sqlAus: erster ```sql-Block, sonst null', () => {
  assert.equal(sqlAus(STAND), SQL);
  assert.equal(sqlAus('kein Block'), null);
  assert.equal(sqlAus(null), null);
  assert.equal(sqlAus('```js\nx\n```'), null);
});

// --- Inbox, Entscheidungsseite, Chat-Status: Kopf zählt nur (a), (b) nie „wichtig“ ---
const eintrag = (strand: string, frage: string, o: Record<string, unknown> = {}) => ({ id: `b-${strand}-x`, art: 'braucht', frage, empfehlung: null,
  quelle: { text: 'Unter-Chat', strand, url: null, paket: null }, wartetSeit: null, blockiert: 1, antworten: ['ja', 'nein', 'anders', 'spaeter'],
  stufe: 'wichtig', stufeGrund: 'blockiert einen Strang', autoAb: null, daten: { strand, seen: null }, ...o }) as any;

test('wendeAufInbox: (b) verliert „wichtig“ und trägt die Zustellung; (a) trägt Grund und SQL', () => {
  const r = braucheBraucht([merge, arr], fakten(), { an: true });
  r.zustellung = { [r.aktionen[0].kennung]: 'zugestellt' };
  const out = wendeAufInbox([eintrag('cc193000', merge.zeile), eintrag('574aa7bb', arr.zeile)], r, { an: true });
  const b = out.find((e: any) => e.quelle.strand === 'cc193000'), a = out.find((e: any) => e.quelle.strand === '574aa7bb');
  assert.equal(b.stufe, 'normal'); assert.equal(b.autoAb, null); assert.equal(b.daten.hauptchat, 'zugestellt'); assert.deepEqual(b.antworten, []);
  assert.equal(a.daten.klasse, 'entscheidung'); assert.equal(a.daten.nurKnut, 'datenbank'); assert.equal(a.daten.sql, SQL);
  // Entscheidungsseite: (b) ohne „wichtig“, mit Zustellung im Text; (a) mit SQL.
  const fr = fragenAus(out).fragen;
  const fb = fr.find((f) => f.klasse === 'aktion')!, fa = fr.find((f) => f.klasse === 'entscheidung')!;
  assert.equal(fb.stufe, 'normal');
  assert.equal(fb.hauptchat, 'zugestellt');
  assert.match(fb.worum, /hat die Aufgabe bekommen/);
  assert.equal(fa.stufe, 'wichtig', '(a) behält seine Stufe');
  assert.equal(fa.sql, SQL);
  assert.equal(fa.nurKnut, 'datenbank');
});

test('ohne aktiven Hauptchat sagt die (b)-Karte das (liegt nicht still herum)', () => {
  const r = braucheBraucht([merge], fakten(), { an: true });
  const out = wendeAufInbox([eintrag('cc193000', merge.zeile)], r, { an: true });
  assert.equal(out[0].daten.hauptchat, 'kein-hauptchat');
  assert.match(fragenAus(out).fragen[0].worum, /kein Hauptchat aktiv/);
});

test('Kopf: „n Fragen an dich“ zählt nur (a); ein Strang nur mit (b) steht „beim Hauptchat“, nicht „braucht Knut“', () => {
  const b = { ...eintrag('cc193000', 'x'), daten: { strand: 'cc193000', klasse: 'aktion' } };
  const a = { ...eintrag('574aa7bb', 'y'), daten: { strand: '574aa7bb', klasse: 'entscheidung' } };
  const offen = offeneJeStrang([a, b]);
  assert.equal(offen.get('574aa7bb'), 1);
  assert.equal(offen.get('cc193000'), undefined, '(b) ist keine Frage an Knut');
  assert.equal(hauptchatJeStrang([a, b]).get('cc193000'), 1);
  const nurB = chatStatus({ zustand: 'blockiert', offeneFragen: 0, geprueft: false, beimHauptchat: 1 });
  assert.equal(nurB.status, 'hauptchat');
  assert.equal(CHAT_STATUS_TEXT[nurB.status], 'beim Hauptchat');
  assert.doesNotMatch(nurB.grund, /Frage/);
  const gemischt = chatStatus({ zustand: 'blockiert', offeneFragen: 1, geprueft: false, beimHauptchat: 1 });
  assert.equal(gemischt.status, 'braucht');
  assert.equal(gemischt.grund, '1 offene Frage an dich');
  // Ohne (b) und ohne Frage bleibt es beim alten Verhalten (blockiert → braucht Knut, Freitext).
  assert.equal(chatStatus({ zustand: 'blockiert', offeneFragen: 0, geprueft: false }).status, 'braucht');
});

// --- Nachtrag Knut 02.11.: tariff-app#193 (Merge develop, neun Konfliktdateien, Stand ~16.10.) ist heute konfliktfrei ---
const KARTE_193 = 'Der Merge muss in diesem Strang erlaubt werden, oder der Hauptchat führt ihn selbst aus';

test('#193 heute konfliktfrei (GitHub mergeable) → (c) veraltet, nicht (b) und schon gar nicht „braucht Knut“', () => {
  const ANLASS = 'tariff-app #193: Merge develop — Merge develop in olaf-tariff-app#193 (neun Konfliktdateien).';
  const r = klassifiziere(KARTE_193, ctx({ prs: ['olaf-tariff-app#193'], prKonfliktfrei: (p) => p === 'olaf-tariff-app#193', anlassText: ANLASS }));
  assert.equal(r.art, 'veraltet');
  assert.match(r.grund!, /olaf-tariff-app#193 ist heute konfliktfrei/);
  // Noch Konflikte → bleibt (b) wie im früheren Nachtrag.
  assert.equal(klassifiziere(KARTE_193, ctx({ prs: ['olaf-tariff-app#193'], prKonfliktfrei: () => false, anlassText: ANLASS })).art, 'aktion');
  // Pass C (Gegenprüfung): konfliktfrei ≠ gemergt — eine Bitte „PR mergen“ ohne Konflikt-Anlass bleibt offen.
  assert.notEqual(klassifiziere('PR olaf-tariff-app#193 nach develop mergen', ctx({ prs: ['olaf-tariff-app#193'], prKonfliktfrei: () => true })).art, 'veraltet');
  // … und eine harte Regel oder offene D-Frage in derselben Zeile schlägt „konfliktfrei“.
  assert.equal(klassifiziere('Konflikt ist weg; jetzt Zugangsdaten für DEV schicken', ctx({ prs: ['olaf-tariff-app#193'], prKonfliktfrei: () => true, anlassText: ANLASS })).art, 'entscheidung');
  assert.equal(klassifiziere('Konflikt gelöst, D3 entscheiden', ctx({ prs: ['olaf-tariff-app#193'], prKonfliktfrei: () => true, anlassText: ANLASS })).art, 'entscheidung');
  // Konfliktfrei zählt nur für Merge-/Konflikt-Bitten: eine Frage zum Inhalt bleibt offen.
  assert.equal(klassifiziere('Text der Preisseite freigeben?', ctx({ prs: ['olaf-tariff-app#193'], prKonfliktfrei: () => true })).art, 'entscheidung');
  // Über die Bündelung mit den Fakten des Servers.
  const k = kartEingabe({ strand: 'cc193000', titel: 'tariff-app #193', zeile: KARTE_193, prs: ['olaf-tariff-app#193'], anlassText: ANLASS });
  const b = braucheBraucht([k], fakten({ prsKonfliktfrei: ['olaf-tariff-app#193'] }), { an: true });
  assert.deepEqual(b.geschlossen.map((g) => g.strand), ['cc193000']);
  assert.equal(b.aktionen.length, 0);
});

test('Chat-Status: blockierter Unter-Chat, dessen Bitte veraltet ist, zeigt nie „braucht Knut“', () => {
  const r = chatStatus({ zustand: 'blockiert', offeneFragen: 0, geprueft: false, veraltet: 'PR olaf-tariff-app#193 ist heute konfliktfrei' });
  assert.equal(r.status, 'review');
  assert.match(r.grund, /Bitte erledigt: PR olaf-tariff-app#193/);
  assert.match(r.grund, /archivieren/);
  // Eine echte offene Frage schlägt das (dann braucht er Knut doch).
  assert.equal(chatStatus({ zustand: 'blockiert', offeneFragen: 1, geprueft: false, veraltet: 'x' }).status, 'braucht');
});

test('angehaltener/erledigter Strang: seine Bitte gilt nicht mehr → (c) mit Grund', () => {
  const r = klassifiziere('Skill im Repo installieren', ctx({ strangZu: 'der Unter-Chat wurde angehalten (Deckel)' }));
  assert.equal(r.art, 'veraltet');
  assert.match(r.grund!, /angehalten/);
  // Pass C: eine harte Regel bleibt Knuts Frage, auch wenn der Unter-Chat angehalten ist (nie still schließen).
  assert.equal(klassifiziere(ECHT, ctx({ strangZu: 'angehalten' })).art, 'entscheidung');
});

test('prsAus: GitHub-Adresse, repo#nr, Org/Repo#nr und Kurzname mit Leerzeichen', () => {
  assert.deepEqual(prsAus('https://github.com/WirStrom1/olaf-tariff-app/pull/193'), ['olaf-tariff-app#193']);
  assert.deepEqual(prsAus('Merge develop in olaf-tariff-app#193'), ['olaf-tariff-app#193']);
  assert.deepEqual(prsAus('WirStrom1/olaf-admin#354 ansehen'), ['olaf-admin#354']);
  assert.deepEqual(prsAus('tariff-app #193'), ['tariff-app#193']);
  assert.deepEqual(prsAus('D1 #3 klären', null), [], 'ohne Repo-Namen keine PR-Kennung');
});

test('Meldung an den Hauptchat: sagt, dass es keine Frage an Knut ist, und nennt den Freigabeweg', () => {
  const t = aktionText({ aktion: 'merge-im-worktree' });
  assert.match(t, /keine Frage an Knut/);
  assert.match(t, /Freigabewege/);
  assert.match(t, /merge-im-worktree/);
});
