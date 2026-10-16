# Plan: Zweite Jira-Seite im OLAF Workspace (Release 17b)

Stand 16.10.2026 · Owner Knut · Auftrag (Knut, 16.10.: „also für Workspace“): das Entwicklungs-Jira (`max-energy`, Projekt
OLAF, Schlüssel `OLAF-123`) neben der bestehenden Seite (`maxenergy`, Projekt PM) lesen.

## Ziel

Schlüssel wie `OLAF-394` funktionieren überall, wo die Werkbank Tickets zeigt: richtiger Browse-Link, Ticket-Kachel an
Vault-Notizen, Spec-Kopf (`jira: OLAF-…`) mit Status, Board-Detail, Suche im Board. Gelesen wird über dieselbe
Gateway-Adresse mit der cloudId der Seite und derselben Anmeldung (Token je Person bzw. Pilot-Lesetoken) — geprüft:
`myself` 200, `OLAF-394` lesbar.

## Entscheidungen (aus dem Auftrag)

- Konfiguration: Vorgabe PM → `https://maxenergy.atlassian.net` (cloudId 606f753a…), OLAF → `https://max-energy.atlassian.net`
  (cloudId 7aec26a2-2eca-46bb-a608-9be55c1dd167). `WERKBANK_JIRA_SITES` (JSON-Liste `{prefix, site, cloudId}`) ersetzt die
  Vorgabe, ist **kein Pflicht-Env**; die erste Seite ist die Hauptseite.
- Die Hauptseite bleibt die einzige mit Kopie, Board, Sprint und Schreiben. Andere Seiten: nur lesen, live je Schlüssel,
  10 Minuten im Speicher.
- Schreiben bleibt wie heute über den Jira-MCP (nur maxenergy freigegeben). Für Schlüssel anderer Seiten lehnt die Werkbank
  Schreibwege mit 409 und dem Hinweis „Schreiben über den Jira-MCP im Chat (ggf. /mcp neu verbinden)“ ab.
- Einrichtung zeigt „Jira“ je Seite: lesen ok/nein (GET `/myself` der Seite), schreiben (Hauptseite wie bisher, andere: Hinweis).

## Umsetzung

| Stelle | Änderung |
|---|---|
| `web/server/config.ts` | `jiraSites()`, `siteFor(key)`, `siteBase()`, `browseUrl(key)` nach Präfix |
| `web/server/jira.ts` | `jiraFetch(…, site)`, `fremdesTicket`/`fremdeTickets` (live, 10 min Cache), `siteLesen` |
| `web/server/links.ts` | Ticket-Schlüssel aller Seiten in Vault-Notizen |
| `web/server/main.ts` | Kacheln an Notizen, Spec-Tickets (Roadmap, Spec-Ordnung), Board-Detail (nur lesen), Schreibsperre, Einrichtung je Seite, `jiraSites` in `/api/config` |
| `web/src` | Board-Detail mit Link der richtigen Seite und ohne Schreibknöpfe; Board-Suche öffnet `OLAF-…`; Einrichtung mit Tabelle je Seite |

Im Demo-/Testbetrieb liest die Werkbank andere Seiten nur, wenn sie eine eigene Test-Basis haben — nie ins Netz.

## Infra-Notiz

Neu und optional: `WERKBANK_JIRA_SITES`. Ohne Eintrag gilt die Vorgabe oben; nichts muss in `.env.local` ergänzt werden.
Keine Datenmigration (die Kopie bleibt PM).

## Tests

`web/test/jira-seiten.test.ts` (Konfiguration, Präfix, Browse-Link, Vault-Schlüssel, nie ins Netz) und in `web/test/api.test.ts`
ein zweiter Jira-Nachbau je Seite: Board-Detail `OLAF-394` live, 404 für Unbekanntes, Schreiben 409 ohne Schreibaufruf,
Kacheln an einer Notiz mit `PM-` und `OLAF-`, Einrichtung je Seite.
