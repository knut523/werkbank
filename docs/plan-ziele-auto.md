---
titel: Werkbank — Ziele automatisch zuordnen (wenn möglich)
stand: 11.10.2026
owner: Knut
zweig: feat/ziele-auto (Basis release/werkbank-2026-10-11, 31cb95d; nur lokal)
quelle: Auftrag Knut 11.10.2026 · Nachtrag Council Runde 2 (bindend) · Rückfragen q-4b326d, q-b31180 (q-07faa0 zurückgezogen)
bericht: ~/work/knut/review-pakete/127-ziele-auto/bericht.md
---

# Ziele automatisch zuordnen

## Auftrag (wörtlich)

> Ziele automatisch zuordnen, wenn möglich, zu Tasks.

Präzisiert durch die Haupt-Sitzung:

> Ziel: Tickets ohne Ziel bekommen automatisch eins, wenn es eindeutig ist; sonst ein Ein-Klick-Vorschlag; nie still raten.
> Regelwerk (deterministisch, erklärbar — Begründung je Zuordnung sichtbar):
> 1. Ticket-Key steht im Beleg/Text eines Ziels → dieses Ziel (sicher).
> 2. Parent-Kette (auch über Workstream/Epic): hat der Workstream/Epic ein Ziel oder steht er im Beleg → erben (sicher, wenn genau eins).
> 3. Verknüpfte Roadmap-Spec mit `ziel:` im Frontmatter → dieses Ziel (sicher).
> 4. Mehrere Kandidaten oder nur Textähnlichkeit → Vorschlag „mittel“ zur Bestätigung, keine Automatik.
> Automatische Zuordnungen werden als solche markiert (Quelle „auto: Regel n“), sind mit einem Klick zu ändern, laufen
> beim Laden/periodisch, überschreiben nie eine manuelle Zuordnung oder KEINS. Prüfe vorher gegen die echten Daten …
> wie viele der offenen PM-Tickets je Regel getroffen würden — Zahl in den Bericht; wenn eine Regel kaum trifft,
> weglassen (ponytail).

Nachtrag aus Council Runde 2 (bindend, wörtlich):

> Einzige Zielquelle sind die IDs aus ziele-olaf.md. Ein vorhandenes Jira-Label ziel-* gewinnt immer. Keine neue
> Zielquelle (kein Workstream-/Themen-Ziel aus domain:). Automatisch gilt nur Regel 1 (Ticket-Key steht im Beleg des
> Ziels). Abgeleitete Zuordnungen (Parent/Epic über eine Tabelle Epic→Ziel-ID, Spec ziel:) gelten nur als
> 'vorgeschlagen', zählen NICHT in die KR-Bewertung, bis Knut bestätigt. Mehrdeutig → kein Vorschlag.

## Stand vor dem Bau

- Ziel = Zeile aus `olaf/1-Projects/ziele-olaf.md` (`web/server/goals.ts` `parseGoalsFile`) plus Sprintziele aus dem
  Planning. Ticket-Keys der ganzen Zeile landen in `GoalRow.tickets` und zählen im Fortschritt als „Beleg“, machen das
  Ticket aber nicht „mit Ziel“ (Deep-Dive: „M10-1 · Beleg“).
- Zuordnung lokal in Mongo `goal_assignments` (`web/server/local.ts`), Rückfall Jira-Label `ziel-<id>`, Sub-task erbt
  vom Task (`effectiveGoals`), Workstream/Epic brauchen keins (`needsGoal`).
- Halbautomatik: Vorschlagsdatei (`WERKBANK_GOAL_PROPOSALS`, `loadProposals`), angezeigt in `GET /api/goals/assign`,
  übernommen per `POST /api/goals/import` (alle „hoch“ oder einzeln `mode: keys`). Oberfläche: Ziele → Zuordnen.

## Messung gegen die echten Daten (11.10.2026, nur lesend)

Jira-Spiegel der Werkbank (Mongo `werkbank.jira_issues`: 324 Tickets, 105 offen), `goal_assignments` (75 Tickets),
`ziele-olaf.md` (10 Zeilen; Spalte Beleg nennt nur PM-379 bei KR3), 160 Roadmap-Specs (4 mit `ziel:`).
26 offene Tickets brauchen ein Ziel; keins davon trägt ein `ziel-*`-Label (es gibt im ganzen Spiegel keins).

| Regel | trifft (von 26) | Rückblick (Tickets mit Ziel) | Status nach Council Runde 2 |
|---|---|---|---|
| 1 Ticket im Beleg genau eines Ziels | 0 (PM-379 hat schon KR3) | – | **automatisch** (gebaut) |
| 2 Parent/Workstream/Epic | 0 (kein Workstream hat ein Ziel, keine Tabelle Epic→Ziel) | – | nur Vorschlag; Tabelle fehlt → q-b31180 |
| 3 Spec `ziel:` | 1 (PM-211 → Z-SVC) | 3 von 6 passend | **nur Vorschlag** (gebaut) |
| W Workstream-Geschwister einstimmig | 10 | 19 von 22 (86 %) | verworfen: neue Zielquelle |
| W′ Workstream-Mehrheit ≥ 75 % | +6 | 7 von 12 (58 %) | verworfen |

Herkunft der 75 bestehenden Zuordnungen: 69 „Claude – Vorschlag 30.09.“ (Quelle `vorschlag-auto`, teils Sicherheit
„mittel“), 6 Knut. Ob die 69 nach der neuen Regel weiter zählen → q-4b326d (Bestand bleibt unverändert).

## Entscheidungen

| # | Frage | Entscheidung | wer |
|---|---|---|---|
| E1 | Automatik ja/nein | nur Regel 1 automatisch | Council Runde 2 (bindend) |
| E2 | Workstream-Geschwister als Vorschlag | nein — neue Zielquelle | Council Runde 2 (bindend) |
| E3 | Spec `ziel:` | nur Vorschlag, einzeln per Klick, mehrdeutig → keiner | Council Runde 2 (bindend) |
| E4 | Regel 1 aus der ganzen Zeile oder nur Spalte Beleg | nur Spalte Beleg | Council Runde 2 (Devil's Advocate), geflaggt |
| E5 | „Label gewinnt immer“ | Automatik/Vorschläge fassen Tickets mit irgendeinem `ziel-*`-Label nie an; die Vorrangregel lokal vor Label (Runde 7) bleibt sonst unverändert — es gibt heute 0 Labels | Agent, geflaggt |
| E6 | Vorschlagsdatei vs. Spec-Vorschlag | Datei gewinnt; nennt die Datei das Ticket, nimmt „übernehmen“ nie still den Spec-Vorschlag | Agent + Council |
| E7 | Wer bestätigt | wer in der Werkbank „übernehmen“ klickt (Verlauf zeigt Person und Quelle) | Agent, geflaggt |
| E8 | 69 Claude-Zuordnungen vom 30.09. | offen, Empfehlung: bleiben gültig | Knut (q-4b326d) |
| E9 | Tabelle Epic→Ziel-ID anlegen | offen, Empfehlung: nein | Knut (q-b31180) |

## Umsetzung

1. `goals.ts`: `autoEligible` (keine Werkbank-Zuordnung — auch nicht KEINS/entfernt —, kein `ziel-*`-Label, braucht
   ein Ziel), `rule1Goals` (nur Zeilen aus ziele-olaf.md, nur Spalte Beleg, kein Gate, genau ein Ziel),
   `specProposals` (alle verknüpften Specs mit Ziel nennen genau dasselbe Ziel aus ziele-olaf.md).
2. `local.ts`: `autoSetGoal` legt nur an (`insertOne`, Duplikat = nichts tun) — überschreibt nie, auch nicht im
   Rennen; Verlauf mit Quelle `auto: Regel 1`, Person „Werkbank (automatisch)“.
3. `main.ts`: `applyAutoGoals` beim Laden (`GET /api/goals`, `GET /api/goals/assign`) und nach jedem vollen
   Jira-Abgleich; `proposals()` als gemeinsame Quelle für Anzeige und Übernahme; `GET /api/goals/assign` liefert
   zusätzlich `auto` (automatisch zugeordnete) und `computed` (Spec-Vorschläge); Import `mode: keys` übernimmt
   Spec-Vorschläge mit Quelle `vorschlag-spec`, `mode: hoch` nie.
4. `Ziele.tsx`: Spec-Vorschläge nicht vorausgewählt, Zeile zeigt Ziel + Kurztext, „Vorschlag aus Spec · Sicherheit
   mittel“ und Begründung; Abschnitt „Automatisch zugeordnet“ mit Chip „auto: Regel 1“, Begründung (Zeile in
   ziele-olaf.md) und Auswahl „ändern …“; Kopfzeile erklärt die Automatik.

Nicht gebaut: Workstream-Signal (E2), Tabelle Epic→Ziel (E9), Umbewertung der 69 (E8), Jira-Labels (bleibt aus).
Infra: keine neue Einstellung.

## Definition of Done

- Messung je Regel steht mit Zahlen im Bericht, Abschnitt „Für Knut zur Nachprüfung“ vorhanden.
- Ein offenes Ticket ohne Zuordnung und ohne `ziel-*`-Label, das in der Spalte Beleg genau eines Ziels aus
  ziele-olaf.md steht, bekommt beim Laden der Ziele bzw. nach dem Jira-Abgleich dieses Ziel, markiert als
  „auto: Regel 1“ mit Begründung, sichtbar im Abschnitt „Automatisch zugeordnet“ und im Verlauf.
- Eine automatische Zuordnung lässt sich dort mit einer Auswahl ändern; danach überschreibt sie kein Laden mehr.
  KEINS, „entfernt“, manuelle Zuordnungen und Tickets mit Label werden nie automatisch angefasst.
- Spec `ziel:` erscheint nur als Vorschlag (nicht vorausgewählt, nicht gespeichert, zählt nicht im Ziel-Deep-Dive),
  wird nur einzeln per „übernehmen“ gespeichert (Quelle `vorschlag-spec`), nie mit „alle mit Sicherheit hoch“;
  mehrdeutig → kein Vorschlag.
- Keine Jira-Schreibvorgänge; `WERKBANK_GOALS_TO_JIRA` unverändert aus.
- `npm test` grün, Vite-Build grün, Screenshots vorher/nachher/Demonstration im Bericht.

## Council

Runde 1 (Plan mit Workstream-Signal): mit Teilagenten angesetzt, die keinen Bericht ablieferten (Explore-Agenten in
diesem Strang); die Rollen liefen deshalb nacheinander im selben Modell (Skill-Rückfall „ein Modell“). Ergebnis
eingearbeitet: geerbte Ziele zählen nicht doppelt; berechnete Vorschläge nie vorausgewählt; „übernehmen“ und Anzeige
aus derselben Regel (Regressionstest). Danach durch den Nachtrag Runde 2 überholt.

Runde 2 (dieser Stand, Rollen nacheinander):

- **Proponent:** Automatik nur aus einem von Menschen geschriebenen Beleg, atomar nur-anlegen, Vorschläge werden nicht
  gespeichert und zählen damit nicht; jede Regel des Nachtrags hat einen Test.
- **Spezialist:** Schreiben beim GET ist hier gewollt („beim Laden“) und idempotent; nach dem vollen Abgleich (alle
  15 min) reicht als „periodisch“. `proposals()` liest bei jedem Laden die Specs (wie `/api/roadmap/order`) — ok bei
  160 Specs. Zurücksetzen (`goal ''`) einer automatischen Zuordnung löscht sie, das nächste Laden setzt sie wieder,
  solange der Beleg das Ticket nennt — gewollt; „ablehnen“ geht über „bewusst ohne Ziel“ oder ein anderes Ziel.
- **Devil's Advocate:** (1) `GoalRow.tickets` sammelt Keys aus der ganzen Zeile — ein im Ergebnis erwähnter Blocker
  würde automatisch zugeordnet; der Nachtrag sagt „im Beleg“ → **behoben** (nur Spalte Beleg, Regressionstest rot→grün).
  (2) Die Automatik trifft heute 0 Tickets — der sichtbare Nutzen ist ein Spec-Vorschlag. Bleibt so stehen, ehrlich im
  Bericht. (3) „Mit einem Klick“ ist Auswahl + Bestätigung, also zwei.
- **UX:** Herkunft, Sicherheit und Begründung sind je Zeile sichtbar; Kopfzeile muss erklären, wann automatisch
  zugeordnet wird → **ergänzt**. Auf dem Handy liegt die Vorschlagsspalte rechts außerhalb (war vorher genauso) →
  zurückgestellt, im Bericht.

VERDICT: PASS (confidence 0.8) — Bindende Bedingungen, alle erfüllt auf diesem Stand:
1. [must-fix] Regel 1 nur aus der Spalte Beleg — erledigt, Test in `test/goals.test.ts`.
2. [must-fix] Kopfzeile erklärt die Automatik — erledigt.
3. [verify] Messung der endgültigen Regeln auf echten Daten im Bericht — 26 / Regel 1: 0 / Spec: 1.
4. [verify] keine Jira-Schreibvorgänge — API-Test zählt `jira.writes`.
5. [verify] ganze Suite + Build grün auf dem Commit-Stand.
