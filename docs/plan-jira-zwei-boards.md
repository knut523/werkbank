# Plan: Zwei Jira-Übersichten umschaltbar (Release 17c)

Stand 16.10.2026 · Owner Knut · Auftrag (Knut, 16.10.: „sollte auch beide Jira lesen und 2 Overviews haben … umschaltbar“).
Baut auf `docs/plan-jira-seiten.md` (17b: zweite Seite nur je Schlüssel live) auf.

## Ziel

Das Entwicklungs-Jira (`max-energy`, Projekt OLAF) bekommt wie PM eine Kopie in der Werkbank. Unter Planen → Board und
Planen → Sprint schaltet ein Umschalter „PM-Board | OLAF-Board“ zwischen den beiden Seiten; die Auswahl gilt je Person.
Filter und Suche wirken auf die gewählte Seite. Die Übersicht („Wartet auf dich“) zeigt Tickets beider Seiten mit
Seiten-Kennzeichen. Schreiben bleibt bei der Hauptseite (PM, Jira-MCP); OLAF bleibt nur lesen.

## Entscheidungen (umgesetzt nach Empfehlung, Knut bestätigt im Review — Fragen D1–D5 im Bericht)

- D1 Ablage: eigene Collection je weiterer Seite (`jira_issues_olaf`, Abgleich-Stand `meta.jira_sync_olaf`). Alles, was heute
  `jira_issues` liest (Pflege, Ziele, Sprint-Zyklus, Mein Tag, Spec-Ordnung), bleibt unverändert PM — kein OLAF-Ticket rutscht
  unbemerkt in PM-Regeln.
- D2 Bahnen im OLAF-Board: Epics (OLAF hat keine Workstreams); Spalten = die Status, die vorkommen, nach Jira-Statuskategorie.
- D3 Sprint OLAF: der laufende Jira-Sprint (`sprint in openSprints()`), nicht der Workspace-Sprint aus dem Vault.
- D4 „Wartet auf dich“ für OLAF: mir zugewiesen, offen, und im laufenden Jira-Sprint oder überfällig (ohne Datum ist im
  Entwicklungs-Jira normal und wäre nur Rauschen).
- D5 Takt wie PM: Vollabgleich alle 15 min (mit Löschschutz), inkrementell jede Minute; je Seite eigene Sperre, eigener Fehler.

## Umsetzung

| Stelle | Änderung |
|---|---|
| `web/server/jira.ts` | Kopie je Seite (`mirrorOf`), `syncMirror`/`syncIncremental`/`recordSyncError` mit Seite, offener Sprint im Vollabgleich, Bahnen-Typ und Spalten in `boardModel` |
| `web/server/main.ts` | `/api/board?site=OLAF`, `/api/board/sync` mit Seite, Detail aus der Kopie (nur lesen), Takt je Seite, `boardSite` in `/api/prefs`, OLAF-Tickets in „Wartet auf dich“ |
| `web/src/pages/Board.tsx` | Umschalter, Zustand je Seite, OLAF ohne Ziehen/Pflege/Ziel-Filter, Hinweis „nur lesen“ |
| `web/src/pages/Sprint.tsx` | Umschalter; OLAF zeigt den laufenden Jira-Sprint nach Status |
| `web/src/pages/Uebersicht.tsx` | Seiten-Kennzeichen an Tickets |

## Infra

Keine neue Einstellung, kein neues Geheimnis: Seiten wie in 17b (`WERKBANK_JIRA_SITES`, optional). Neue Collection entsteht
beim ersten Abgleich; kein Migrationsschritt. Rückbau: Collection `jira_issues_olaf` und `meta.jira_sync_olaf` löschen.

## Tests

`web/test/api.test.ts` mit dem zweiten Jira-Nachbau: Abgleich OLAF (Kopie, Löschschutz, inkrementell), Board je Seite,
Sprint-Filter, Detail aus der Kopie, Schreiben 409, Auswahl je Person, „Wartet auf dich“ mit Seite. Bilder beider Boards.
