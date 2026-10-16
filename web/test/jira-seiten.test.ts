// Mehrere Jira-Seiten (Release 17b, Knut 16.10.2026): Vorgabe PM → maxenergy, OLAF → max-energy; WERKBANK_JIRA_SITES ersetzt
// die Vorgabe; Schlüssel wählen ihre Seite nach Präfix (Browse-Link, Lesen über die cloudId der Seite); Ticket-Schlüssel beider
// Seiten in Vault-Notizen; Lesen anderer Seiten nur mit Test-Basis (nie ins Netz).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jiraSites, siteFor, siteBase, browseUrl, isMainSite, OLAF_DEV_SITE } from '../server/config.ts';
import { extractTicketRefs } from '../server/links.ts';
import { fremdLesbar, fremdesTicket } from '../server/jira.ts';

test('Vorgabe ohne Env: Hauptseite PM (maxenergy) zuerst, OLAF auf max-energy; Präfix wählt die Seite', () => {
  const s = jiraSites({} as any);
  assert.deepEqual(s.map((x) => [x.prefix, x.site, x.main]), [['PM', 'https://maxenergy.atlassian.net', true], ['OLAF', 'https://max-energy.atlassian.net', false]]);
  assert.equal(s[1].cloudId, '7aec26a2-2eca-46bb-a608-9be55c1dd167');
  assert.equal(siteFor('OLAF-394', s).site, 'https://max-energy.atlassian.net');
  assert.equal(siteFor('PM-12', s).main, true);
  assert.equal(siteFor('XY-1', s).main, true, 'unbekannter Präfix → Hauptseite');
  assert.equal(siteBase(s[1]), `https://api.atlassian.com/ex/jira/${OLAF_DEV_SITE.cloudId}/rest/api/3`);
  assert.equal(isMainSite('olaf-1', s), false, 'Präfix ohne Groß/klein');
});

test('WERKBANK_JIRA_SITES: gültige Liste ersetzt die Vorgabe (erste = Hauptseite); kaputtes Env → Vorgabe', () => {
  const env = { WERKBANK_JIRA_SITES: JSON.stringify([
    { prefix: 'PM', site: 'https://maxenergy.atlassian.net', cloudId: '606f753a-fd3a-4d69-9b8b-ef9574984080' },
    { prefix: 'DEV', site: 'https://dev.example.net', cloudId: '11111111-2222-3333-4444-555555555555', base: 'http://127.0.0.1:9/rest/api/3/' },
    { prefix: 'kaputt', site: 'ftp://x', cloudId: 'nein' },
  ]) } as any;
  const s = jiraSites(env);
  assert.deepEqual(s.map((x) => x.prefix), ['PM', 'DEV']);
  assert.equal(s[1].base, 'http://127.0.0.1:9/rest/api/3', 'Test-Basis ohne Schrägstrich am Ende');
  assert.equal(siteBase(s[1]), 'http://127.0.0.1:9/rest/api/3');
  assert.deepEqual(jiraSites({ WERKBANK_JIRA_SITES: 'kein json' } as any).map((x) => x.prefix), ['PM', 'OLAF']);
  assert.deepEqual(jiraSites({ WERKBANK_JIRA_SITES: '[]' } as any).map((x) => x.prefix), ['PM', 'OLAF']);
});

test('browseUrl nach Präfix (Prozess-Env ohne WERKBANK_JIRA_SITES = Vorgabe)', () => {
  assert.equal(browseUrl('PM-321'), 'https://maxenergy.atlassian.net/browse/PM-321');
  assert.equal(browseUrl('OLAF-394'), 'https://max-energy.atlassian.net/browse/OLAF-394');
});

test('Vault: Schlüssel beider Seiten aus Frontmatter, Text und Browse-Links', () => {
  const r = extractTicketRefs({ jira: ['PM-1', 'OLAF-394'] }, 'Siehe https://max-energy.atlassian.net/browse/OLAF-12 und OLAF-13; „OLAF-Werkbank“ ist kein Schlüssel.');
  assert.deepEqual(r.map((x) => `${x.key}:${x.via}`).sort(), ['OLAF-12:link', 'OLAF-13:text', 'OLAF-394:frontmatter', 'PM-1:frontmatter']);
});

test('Andere Seiten lesen: nie ohne Zugang; im Test-/Demobetrieb nur mit eigener Test-Basis; Hauptseiten-Schlüssel nie live', async () => {
  const olaf = { ...OLAF_DEV_SITE, main: false };
  assert.equal(fremdLesbar({ ...olaf, base: 'http://127.0.0.1:9/rest/api/3' }), true);
  assert.equal(fremdLesbar({ ...olaf, main: true }), false);
  assert.equal(await fremdesTicket(null, 'OLAF-394'), null, 'ohne Zugang nichts');
  assert.equal(await fremdesTicket({ email: 'a@b', token: 't', source: 'x' } as any, 'PM-1'), null, 'PM steht in der Kopie');
});
