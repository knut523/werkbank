# Plan Release 31 „Umzug“, Schnitt 1+2: Lage, pr_lage, Jira beide Seiten, Fragenpaket

Stand 02.11.2026 · Auftrag Knut („ja“, Entscheidungsseite RL08) · Grundlage: Lückenliste und Abnahme aus Paket 400
(20 Aufträge vom 02.11., Zusatz „Was ist offen? auf einen Blick“). Basis `release/werkbank-2026-11-02` (= Live R30).

## Ziel

Knut arbeitet nur noch im Werkbank-Hauptchat. Dieser Schnitt schließt die Lücken der Abnahme-Zeilen 1, 5, 6, 7 und 15
und liefert die Ansicht „Lage“, die „was ist offen?“ ohne Nachfrage beantwortet. Alles hinter Schaltern, Vorgabe aus.

## Schalter (alle Vorgabe aus, Wert `on`)

| Schalter | wirkt auf |
|---|---|
| `WERKBANK_PR_LAGE` | Werkzeug `pr_lage` (Hauptchat), Abschnitt „PR-Lage“ der Lage-Ansicht |
| `WERKBANK_LAGE` | Ansicht „Lage“ (`#/lage`, `/api/lage`), Eintrag in der Leiste |
| `WERKBANK_JIRA_ZWEI_SEITEN` | `jira_anlegen`, `jira_duplikate`, `jira_update(_many)` auf der zweiten Seite, Owner-Prüfung im Einzel-Update |
| `WERKBANK_FRAGENPAKET` | Werkzeug `fragenpaket` und gebündelte Antworten |

Schalter aus = Verhalten wie R30 (Werkzeug antwortet „Schalter aus“, Route 404, keine Leisten-Änderung).

## Bausteine

1. **`pr_lage`** (`web/server/prlage.ts`, rein + dünner Abruf). Eine lesende GraphQL-Suche
   `is:pr is:open org:<Org>` (Orgs aus `WERKBANK_PR_REVIEW_ORGS`, Vorgabe WirStrom1) über das Lesetoken, `graphql()` lehnt
   Mutationen ab. Je PR: Reviews (wer, Zustand, wann), neueste Kommentare von Christoph (`bizarrochris`, Liste aus den
   Ticker-Einstellungen), Tags `@review`/`@fix` mit Zeit, `mergeable` und `mergeStateStatus` (GraphQL-Gegenstück zu REST
   `mergeable_state`), Ticker-Stand (Schalter, letzter Lauf, Review- und Fix-Stränge je PR aus `pr_reviews`/`pr_fixes`),
   „von uns gepusht“ (letzter Commit von `knut523` bzw. Push aus dem @fix-Weg seit heute früh). Ohne Token: Rückfall auf
   die Kopie `github_prs` mit Hinweis. Werkzeug nur im Hauptchat, Klasse `read`.
2. **Lage** (`web/server/lage.ts` rein, Route `/api/lage` nur Admin, Seite `web/src/pages/Lage.tsx`). Abschnitte:
   Für dich zu tun (nur echte Entscheidungen: Karten der Entscheidungsseite ohne Klasse „aktion“, plus Approve-Bitten =
   offene PRs, bei denen Knut als Reviewer angefragt ist) · Läuft (Stränge mit ETA) · Fertig seit heute früh
   (Ergebnis-Satz = Titel des Berichtskopfs, Link) · Erledigt der Hauptchat ((b)-Aktionen aus „Braucht dich“) · PR-Lage
   (aus `pr_lage`) · Themen (Flex, Bot, Werkbank, Service, Anmeldestrecke: ein Satz aus dem Abschnitt „Stand“ der
   Übersichtsnotiz im Vault bzw. dem Themen-Register, dazu die Zahl laufender/fertiger Stränge). Eine Spalte, lesbar bei
   390 px.
3. **Jira beide Seiten** (`web/server/jirawrite.ts`, `main.ts`). Schreiben mit `cloudId` der Seite nach Präfix
   (`siteFor`), Übergänge mit dem Lesezugang der Seite. `jira_duplikate` (lesend: JQL-Suche auf der Seite des Projekts) und
   `jira_anlegen` (Projekt PM → maxenergy, OLAF → max-energy; die Werkbank sucht vor dem Anlegen selbst noch einmal und
   lehnt ab, wenn ein Treffer nicht in `duplikate_gesehen` steht; Karte mit Klick über die Brücke). Owner-Prüfung im
   Einzel-Update wie im Stapel. Tickets der zweiten Seite werden für Titel/Owner live gelesen (`fremdesTicket`).
4. **Fragenpaket** (`web/server/fragenpaket.ts`). Werkzeug `fragenpaket(titel, fragen[])` legt je Frage eine Rückfrage
   (Kontext, Optionen, Empfehlung) mit Paket-Kennung an — sie erscheinen auf der Entscheidungsseite als eigene Gruppe
   „Fragenpaket: <titel>“; „Anders“ ist die Kommentarzeile. Einzelne Antworten wecken den Hauptchat nicht; ist das Paket
   vollständig beantwortet, geht eine gebündelte Meldung an den Hauptchat und je fragendem Strang eine Nachricht mit
   genau seinen Antworten. `fragenpaket_stand(id)` liest den Stand.

## Brücke

`claude-bridge/src/tools.ts`: neue Werkzeuge in `ORCH_MCP_TOOLS`; `pr_lage`, `jira_duplikate`, `fragenpaket_stand` →
`read`; `jira_anlegen` → `confirm` mit eigener Karte (Seite, Projekt, Titel, gesehene Duplikate) und `ask`-Regel im Auto-Modus (ebenso
`jira_update(_many)`); `fragenpaket` → ohne Klick wie `orch_ask` (legt nur Fragen an Knut an, ändert nur
Werkbank-Zustand), in Strängen gesperrt. Aktivitätszeilen für alle.

## Prüfungen

- Tests zuerst für die reinen Teile (prlage, lage, Seitenwahl/Duplikat-Regel, Paket-Bündelung), dann Bau.
- Suite: `scripts/werkbank.sh test` mit `sauber-env`, unter `flock /tmp/olaf-schwer.lock`.
- E2E an isolierter Instanz (`scripts/isoliert.sh`, Jira-Trockenlauf, GitHub über Testbasis), Screenshots 1440 und 390.
- Pass A/B/C, in C `challenge art=diff`; Regeltreue (AGENTS.md, olaf-feedback-check, Pre-Push-Gate `--checkliste`).

## Nicht-Ziele

Kein Live-Schalten, kein Push, keine Jira-Schreibzugriffe gegen echte Seiten. OAuth-Erweiterung der Werkbank auf die
Seite maxenergy ist Knuts Schritt. Schnitte 3 und 4 (Betrieb, Geheimnisse, Coolify, Dateien/Screenshots) bleiben draußen.
