// Themen-Gruppen der Unter-Chats (docs/plan-hauptchat-monitor.md, S2): automatische Zuordnung mit den echten Strängen vom
// 12.10.2026 (Titel, Paket, Ordner), Handwert vor Automatik, Gruppierung und Reihenfolge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoThema, themaOf, cleanThema, groupThemen, SONSTIGES } from '../server/themen.ts';

const HEUTE = [
  { title: 'Rechner b: Feedback 12.10. + PRs (Rechner, Tracking) fertig machen', paket: '147-rechner-feedback-prs', cwd: '/home/knut/work/knut/olaf-tariff-app-rechner-neu', want: 'Rechner' },
  { title: 'Cockpit: Bank unter Vertrieb, einheitliche Status-Begriffe, kurzer Filter-Text', paket: '150-cockpit-feedback-12-10', cwd: '/home/knut/work/knut/olaf-admin-ck-gesamt', want: 'Cockpit' },
  { title: 'Flex: kein Dankeschön, Markenfragen, Idee einfacher', paket: '148-flex-feedback', cwd: '/home/knut/work/knut/olaf-tariff-app-flex-pilot', want: 'Flex' },
  { title: 'Bot: eine Antwort pro Nachricht, Übergabe nur wenn nötig', paket: '149-bot-doppelantwort', cwd: '/home/knut/work/knut/olaf-bot-gespraech', want: 'Bot' },
  { title: 'Admin-PRs fertig machen: Benutzer, Partner-API (+Mail/Magic-Link), Umfragen, Bot', paket: '151-admin-prs-fertig', cwd: '/home/knut/work/knut/olaf-admin-benutzer', want: 'Admin' },
  { title: 'Hardware: Liste links einklappbar wie Kundenakte + PR fertig', paket: '152-hardware-liste', cwd: '/home/knut/work/knut/olaf-admin-hardware', want: 'Admin' },
  { title: 'Doppelversand Folge-PRs: Admin-Retry-Panel + Rest auf #99', paket: '153-doppelversand-folge-prs', cwd: '/home/knut/work/olaf-durable-func-agent-7baae96c', want: 'Admin' },
  { title: 'Workspace: schreiben während Arbeit, Themen-Gruppen, Hauptchat überwacht Unter-C', paket: '154-workspace-hauptchat-monitor', cwd: '/home/knut/work/knut/werkbank-idle-timeout', want: 'Workspace' },
  { title: 'Sprint Review/Planning und Summary', paket: '143-sprint-werkbank', cwd: '/home/knut/work/knut/werkbank-sprint', want: 'Sprint' },
  { title: 'Release 5 vorbereiten', paket: '145-werkbank-release-5', cwd: '/home/knut/work/knut/werkbank-release5', want: 'Workspace' },
];

test('DoD 4: die Stränge vom 12.10. landen im richtigen Thema (Titel → Paket → Ordner)', () => {
  for (const x of HEUTE) assert.equal(autoThema(x), x.want, x.title);
  assert.equal(autoThema({ title: 'Irgendwas Neues', paket: null, cwd: '/tmp/x' }), SONSTIGES);
  assert.equal(autoThema({ title: 'Ohne sprechenden Titel', cwd: '/home/knut/work/knut/olaf-tariff-app-flex-pilot' }), 'Flex', 'Ordner als letzte Quelle');
  assert.equal(autoThema({ title: 'Robotik' }), SONSTIGES, '„bot“ nur als eigenes Wort');
});

test('Handwert vor Automatik; „auto“ stellt zurück; Länge geprüft', () => {
  assert.equal(themaOf({ ...HEUTE[6], thema: 'Durable' }), 'Durable');
  assert.equal(themaOf({ ...HEUTE[6], thema: null }), 'Admin');
  assert.equal(cleanThema('auto'), null);
  assert.equal(cleanThema('  '), null);
  assert.equal(cleanThema(' Neu\tes  Thema '), 'Neu es Thema');
  assert.throws(() => cleanThema('x'.repeat(31)), /30 Zeichen/);
});

test('Gruppen: nur offene, „wartet/gestoppt“ zuerst, „Sonstiges“ zuletzt, im Thema nach Status', () => {
  const d = (title: string, startedAt: number, thema?: string) => ({ title, startedAt: new Date(startedAt), ...(thema ? { thema } : {}) });
  const g = groupThemen([
    { d: d('Flex: a', 1), word: 'fertig' as const },
    { d: d('Bot: b', 2), word: 'läuft' as const },
    { d: d('Cockpit: c', 3), word: 'wartet' as const },
    { d: d('Cockpit: d', 4), word: 'läuft' as const },
    { d: d('Zufall', 5), word: 'wartet' as const },
    { d: d('Flex: geprüft', 6), word: null },
  ]);
  assert.deepEqual(g.map((x) => x.thema), ['Cockpit', 'Bot', 'Flex', 'Sonstiges']);
  assert.deepEqual(g[0].items.map((x) => x.d.title), ['Cockpit: c', 'Cockpit: d']);
  assert.deepEqual(g[0].counts, { läuft: 1, wartet: 1, fertig: 0, gestoppt: 0 });
  assert.equal(g.find((x) => x.thema === 'Flex')!.items.length, 1, 'von Knut geprüft fällt raus');
});
