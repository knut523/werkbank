---
status: Council 08.10.2026 — HOLD (0,74); wartet auf Knuts Entscheidungen E1–E5
quelle: Knut, 08.10.2026: „make it a real good tool to use, also make it so I can take an item from the roadmap, make it a Jira task — and then in the same go assign an agent to complete so I just need to review“ · „Werkbank im Produkt-View immer noch nicht aufgeräumt genug … in den einzelnen Buckets wäre es gut zu wissen, was done ist und was als nächstes kommt“
---

# Von der Roadmap zum Agenten — und eine Produktansicht, die man benutzt

## Ziel

Knut nimmt einen Roadmap-Eintrag (Spec), macht mit **einem** Klick daraus ein Jira-Ticket und setzt im selben
Schritt einen Agenten darauf an. Der Agent arbeitet nach plan-to-pr bis zum Review-Stand (Plan, Code, PR-Entwurf
oder Dokument). Knut sieht in **einer** Liste, was zum Review wartet, und muss nur noch prüfen und freigeben.
Die Produktansicht zeigt je Thema auf einen Blick: was erledigt ist, was läuft, was als Nächstes kommt, was auf
ihn wartet.

## Stand heute (Code)

- Karten-Agent auf einem **bestehenden** Ticket: `POST /api/board/issue/:key/agent` (Projekt zuordnen,
  Workstream-Bereich im Vault, Chat mit plan-to-pr-Anweisung, `agent_runs`).
- **Kein Ticket-Anlegen** in der Werkbank. Jira-Schreiben gibt es für Kommentar, Status, Datum
  (`jira.ts`), mit den Jira-Zugangsdaten der Person.
- Spec ↔ Ticket: `addJiraFrontmatter` (links.ts) setzt `jira:` in eine Vault-Notiz.
- Roadmap-Seite: Rangliste, Zustände (Swimlanes Thema × 5 Zustände, ~100 Karten), PR-Review, offene
  Entscheidungen, Konsistenz, seit heute „Für mich offen“.
- Agent fertig: Dateien landen in „Meine Dateien“; es gibt **keine Review-Schlange** „Agent fertig, bitte prüfen“.

## Vorschlag

### A. „Als Aufgabe an einen Agenten“ an jeder Spec (Roadmap → Jira → Agent)

1. Knopf an jeder Spec-Karte (Zustände, Rangliste, Spec-Ansicht im Wissen): **„Agent ansetzen“**.
2. Dialog mit Vorschau (nichts wird ohne Bestätigung geschrieben):
   - **Dubletten-Prüfung** gegen die Jira-Kopie (Spec-Slug, `jira:` der Spec, Titel-Stichworte); Treffer → statt
     neu anlegen „an PM-xxx ansetzen“.
   - **Ticket-Felder nach OLAF-Konvention**: Typ Task, `parent` = Workstream (Vorschlag aus `domain:` → Workstream-
     Tabelle, änderbar), Titel aus der Spec, Beschreibung mit `Ziel:` (Spec-Ziel), `Ergebnis:` (aus Zustand: Plan →
     „Plandatei + PR-Entwurf“, Pre-Plan → „Entscheidungsvorlage“), Link auf die Spec, DoD als Liste; Owner = Knut
     (oder der Agent-Verantwortliche), Priority Medium, Fällig +14 Tage.
   - **Agent-Auftrag**: Modus „bis Review“ (Standard) oder „nur Plan“; freie Notiz.
3. Bestätigen → in einem Rutsch: Ticket anlegen (Jira-Zugang der Person) → zurücklesen und prüfen, dass parent,
   assignee, priority, duedate wirklich gesetzt sind → `jira:` in die Spec schreiben → Jira-Kopie auffrischen →
   Karten-Agent starten (vorhandener Weg) mit der Spec als Kontext.
4. Fehler mitten im Ablauf: angelegtes Ticket bleibt, Spec-Link und Agent werden nachgeholt oder als Fehler gezeigt —
   kein zweites Ticket beim erneuten Klick (Idempotenz über die Spec: `jira:` schon gesetzt → Schritt 1 entfällt).

### B. Review-Schlange „Wartet auf dein Review“

- Unter „Für mich offen“ und auf der Startseite: jeder fertige Agentenlauf (Sitzung „bereit“) mit Ticket, was er
  hinterlassen hat (Plan-Notiz, Dateien, PR-Link, offene Fragen „  - Knut:“), Knöpfe **„Ansehen“** (Chat),
  **„Passt“** (Lauf als geprüft markieren, optional Jira-Kommentar „von Knut geprüft“ — nur mit Bestätigung),
  **„Nacharbeit“** (Notiz zurück in denselben Chat).
- Ein Lauf ist „fertig“, wenn die Sitzung „bereit“ ist **und** der Agent eine Abschlussmarke gesetzt hat
  (letzte Antwort enthält „Bereit zum Review“ / Plan-to-PR-Abschluss) — sonst „wartet auf dich“ (Rückfrage).

### C. Produktansicht aufräumen

- **Themen als kompakte Buckets** (Standard): je Thema eine Zeile/Karte mit vier Feldern:
  **Erledigt** (letzte 3 Live mit Datum, Zähler) · **In Arbeit** (Review mit PR-Stand, laufende Agenten) ·
  **Als Nächstes** (Top 3 nach Rang aus Plan/Pre-Plan, mit „Agent ansetzen“) · **Wartet auf dich** (offene
  Knut-Zeilen). Die volle Swimlane-Ansicht klappt pro Thema auf.
- Kopf der Seite: „Für mich offen“ (heute gebaut) bleibt oben; Tabs reduziert auf **Überblick · Rangliste ·
  PR-Review · Konsistenz** (Entscheidungen gehen in „Für mich offen“ auf, „Ordnung“ in Konsistenz).
- Jede Spec-Karte zeigt „zuletzt gegen Code geprüft: Datum · Commit“ (aus dem Spec-Abgleich).

## Definition of Done (Entwurf)

1. „Agent ansetzen“ an einer Spec legt nach Vorschau genau ein Jira-Ticket mit Workstream-Parent, Owner, Priority,
   Fälligkeit, Ziel/Ergebnis an, liest es zurück, schreibt `jira:` in die Spec und startet den Agenten.
2. Dubletten-Prüfung vor dem Anlegen; erneuter Klick legt kein zweites Ticket an.
3. Ohne Jira-Zugang / ohne Claude-Token: klare Meldung, nichts halb angelegt.
4. Review-Schlange zeigt fertige Läufe mit Ergebnis; „Passt“ und „Nacharbeit“ funktionieren; Jira-Kommentar nur nach
   Bestätigung.
5. Produktansicht: Buckets je Thema als Standard, volle Ansicht aufklappbar; Tabs reduziert.
6. Tests (Jira-Mock für Anlegen/Zurücklesen/Dublette/Fehler mittendrin), README, ausgerollt, Review.

## Offene Fragen (für Knut nach dem Council)

- Owner des Tickets: Knut oder „der Agent“ (ein Jira-Konto für Agenten gibt es nicht)?
- Darf „Passt“ den Jira-Status umsetzen (z. B. „In Review“ → „Done“), oder nur kommentieren?


## Council (08.10.2026) — Urteil

Vier getrennte Stimmen: Befürworter, Technik/Sicherheit, Bedienbarkeit (ganzes Werkzeug), Advocatus Diaboli (anderes
Modell). Den schwersten Einwand (GitHub) im Code nachgeprüft: `git push` und jedes GitHub-Schreiben fragen in der
Brücke immer nach (`claude-bridge/src/tools.ts:36–47`, Knut 06.10.: „push only with acceptance or orders“); Lauf
max. 40 Schritte, 15 min je Runde, Rückfrage verfällt nach 30 min (`sessions.ts:79–81`).

```
VERDICT: HOLD (confidence 0.74)
WHY: Richtung stimmt und nutzt fast nur Vorhandenes, aber „nur noch reviewen“ ist ohne ehrlichen GitHub-Schluss,
     verlässliche Fertig-Marke und harte Sperren (Rechte, Dubletten, offene Entscheidungen) ein leeres Versprechen —
     und die Roadmap-Reparatur allein macht das Werkzeug nicht gut (kein Einstieg, „bei mir“ an fünf Stellen).
```

### Verbindliche Bedingungen

1. **[must-fix] Nur Admins, nur nach Vorschau.** „Agent ansetzen“ legt nur für `ADMIN` an, nie im Trockenlauf; die
   Vorschau schreibt nichts (Test: 0 Schreibvorgänge).
2. **[must-fix] Echtes Anlegen mit Zurücklesen.** `createIssue` über den konfigurierten Schreibweg (MCP
   `createJiraIssue` oder REST `POST /rest/api/3/issue`), accountId über `GET /myself`; danach `refreshIssue` und
   Abweichungen bei parent/assignee/priority/duedate mit den vorhandenen Aktionen nachziehen, sonst Fehler zeigen.
3. **[must-fix] Keine Dubletten, kein zweites Ticket.** Live-JQL-Suche (`summary ~` und `text ~`, 2–3 Varianten) vor
   dem Anlegen; Spec-Slug in die Beschreibung; Absichts-Dokument `spec_tickets` (eindeutig je Spec) vor dem POST,
   Schlüssel sofort danach speichern; erneuter Klick setzt fort (Test: Fehler mittendrin + neuer Versuch = 1 POST).
4. **[must-fix] Keine stillen Entscheidungen.** Start nur für Specs in `3-Plan` ohne offene `- Knut:`-Zeile; sonst
   statt „Agent ansetzen“ der Knopf „Entscheiden“ (öffnet die offenen Fragen).
5. **[must-fix] Verlässliches „bereit zum Review“.** Neues Werkbank-Werkzeug `review_ready({summary, dod, artifacts})`
   (Klasse `read`), setzt `agent_runs.reviewReadyAt` mit Pflichtformat „Gemacht / Nicht gemacht / Risiko“ und
   DoD-Selbstauskunft je Punkt; Timeout, Schrittlimit und Fehler erscheinen getrennt als „hängt“, nicht als fertig;
   „Nacharbeit“ setzt den Lauf zurück.
6. **[must-fix] Ehrlicher GitHub-Schluss** (siehe E1): der Agent endet mit einem fertigen Branch und **einer** letzten
   Rückfrage „pushen + Draft-PR?“, die in der Review-Karte mit ✅ beantwortet wird.
7. **[must-fix] Vault-Schreiben sicher.** `jira:` in die Spec nur bei freier Sync-Sperre (`syncLocked`), mit
   Hash-Prüfung und `writeAtomic`; sonst nachholen.
8. **[must-fix] Spec als Kontext über den Pfad**, nicht in der Notiz (`AgentPlace.specPath` → `placeLine`).
9. **[verify] Parallelgrenze sichtbar.** Ist das Chat-Limit voll, bleibt das Ticket angelegt und der Agent steht
   „wartet auf freien Platz“ mit Startknopf — kein halber Zustand ohne Anzeige.
10. **[verify] Tests** mit erweitertem `jira-mock` (`POST /issue`, Fehlereinspeisung), MCP-Mock `createJiraIssue`.
11. **[must-fix] Werkzeug statt Seite** (Bedienbarkeit): Startseite **„Heute“** (`#/`) mit Review-Schlange →
    Wartet auf dich → Tag → überfällige Tickets; **eine** Liste „bei mir“ als gemeinsame Komponente (Board-Hygiene,
    Sprint, Mein Tag verlinken dorthin); Navigation auf **Heute · Roadmap · Board · Sprint · Wissen** (Rest im Fuß),
    LibreChat-Leiste gleich; Roadmap-Standard **Überblick (Buckets)**, Reihenfolge Wartet auf dich → In Arbeit →
    Als Nächstes → Erledigt, sortiert nach „wartet auf dich“; „Ordnung/Konsistenz“ unter „Pflege ⋯“; Tabellen am
    Handy gestapelt; Zähler „Heute (n)“ in der Navigation; Rückfragen direkt in Review-/Board-Karte beantworten.

NOTES (stärkster Einwand, bleibt sichtbar): Ein Klick, der Jira-Ticket **und** schreibenden Agenten erzeugt, ist
mächtig; die Sperren 1–4 und die getrennte, sichtbare Fortsetzung bei Fehlern (3, 9) sind keine Kür.

## Entscheidungen für Knut

- **E1 GitHub-Schluss.** (a) Agent endet mit lokalem Branch, letzte Rückfrage „pushen + Draft-PR?“ wartet bis zu
  24 h und ist in der Review-Karte mit ✅ beantwortbar · (b) Agenten aus „Agent ansetzen“ dürfen Feature-Branches
  ohne Rückfrage pushen und Draft-PRs öffnen (Merge/main/develop bleiben gesperrt) · (c) nur lokaler Diff in der Karte.
  Empfehlung: **(a)** — hält deine Regel „push nur mit Zustimmung“, kostet dich einen Tipp.
- **E2 Owner und „Passt“.** Owner = du (kein Agentenkonto); „Passt“ kommentiert nur („von Knut geprüft“), Status
  setzt du selbst. Empfehlung: **so**.
- **E3 Fälligkeit.** Ende des laufenden Sprints statt pauschal +14 Tage. Empfehlung: **Sprintende**.
- **E4 Workstream.** Standard PM-70 (Produkt OLAF), im Dialog änderbar. Empfehlung: **so**.
- **E5 Reihenfolge.** Erst „Heute“ + eine Liste „bei mir“ + Buckets + Review-Schlange (B, C, Bedingung 11), direkt
  danach „Agent ansetzen“ (A) — oder alles in einem Plan. Empfehlung: **ein Plan, zwei PR-Schnitte in dieser Reihenfolge**.
