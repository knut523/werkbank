---
titel: Werkbank — Tagesabschluss als Durchgang mit Empfehlungen
stand: 07.10.2026 · portiert 09.10.2026
owner: Knut
zweig: feat/tagesabschluss (von origin/dev 259f375; Vorgänger lokal in ~/work/werkbank, 92d51cb, nie gepusht)
quelle: Tagesabschluss-Chat 07.10.2026 (Knut), Entscheidungen 1–7 unten
---

# Tagesabschluss als Durchgang

## Ziel

Der Tagesabschluss geht alle eigenen PM-Tickets durch, die heute zählen, und gibt **je Ticket eine Empfehlung** mit
Grund: verschieben (mit Datum), bleibt, Done, Backlog ohne Datum, anschauen, oder „Agent vorlaufen lassen“. Die Person
antwortet gesammelt, die Änderungen werden mit **einer** Rückfrage geschrieben, und für Tickets, die angegangen werden
sollen, startet danach je ein eigener Chat mit einem Agenten.

Anlass (Knut, 07.10.): Heute fragte der Abschluss nur die drei heute angefassten Tickets ab, eins davon mit einem Stand,
der schon im eigenen Jira-Kommentar stand; die Rückfrage vor dem Schreiben zeigte nur „Status → In Progress, ja/nein“.
Die Übersicht über 36 Tickets kam erst auf Nachfrage.

## Portierung auf origin/dev (09.10.2026)

Die Scheiben 1–4 lagen uncommittet in `~/work/knut/werkbank-tagesabschluss` (Basis 92d51cb, lokale Geschichte).
Gesichert als Patch, auf `origin/dev` übertragen; einziger Konflikt: `confirmQuestion` in `claude-bridge/src/tools.ts`
— dev hat inzwischen Antwort-Knöpfe (`ANSWER_BUTTONS`, `neutralizeAnswerAnchors`); die neuen Rückfragen nutzen sie.

Dazu beim Portieren:
- `agent_start` startet über **dieselbe** Funktion wie „Agent“ am Board (`startTicketAgent` in `main.ts`: Projekt
  zuordnen, Workstream-Bereich, Vorname, Sperre „ein Agent je Ticket und Person“) — vorher rief die interne Route
  `startChatAgent` ohne Projekt/Bereich. Der Orchestrator-Weg (`feat/orchestrator`) passt nicht: er startet Stränge mit
  Arbeitsordner ohne Jira und nur über den internen Kanal der Haupt-Sitzung.
- Klasse `confirm` für `jira_update_many` und `agent_start` auch im Auto-Modus (Arbeitsordner und „voll“) getestet.
- API-Test hing an der Uhrzeit (ab 16 Uhr Abend-Slot) — `WERKBANK_EOD_HOUR=24` im Test.

## Stand vor dem Bau (92d51cb)

- Vorlage `vorlage-tagesabschluss` (`librechat/librechat.yaml:135`): drei Zeilen, höchstens drei Fragen, keine neuen Tickets.
- Fragen: `touchedToday()` (`web/server/hygiene.ts:135`) + Hygiene-Punkte, `pickQuestions()` mit `MAX_PER_SESSION = 3`,
  Block `hygieneBlock()` (`web/server/context.ts:100`), zusammengesetzt in `sessionStart()` (`web/server/assist.ts:83`).
  `opts.eod` = Vorlage oder „Tagesabschluss“ am Anfang (`claude-bridge/src/server.ts:274`); ab 16 Uhr ohne `eod` gibt es
  denselben Block automatisch.
- Schreiben: `jira_update` (ein Ticket je Aufruf, `web/mcp/werkbank-tools.ts:64` → `/internal/jira-update`,
  `web/server/main.ts:1609`). Rückfrage `confirmQuestion()` (`claude-bridge/src/tools.ts:239`) zeigt nur die neuen Werte.
- Chat mit Agent auf einem Ticket gibt es schon am Board: `startChatAgent()` (`web/server/agent.ts:143`), Route
  `/api/board/issue/:key/agent`. Aus einem Chat heraus nicht aufrufbar.

## Entscheidungen (Knut, 07.10.2026)

1. Umfang: eigene offene Tickets, die überfällig sind, in ≤ 7 Tagen fällig, ohne Datum oder heute bearbeitet.
2. Lesen: bis zu 4 Teilagenten `ticket-pruefer` lesen Beschreibung + Kommentare; im Chat nur das Ergebnis.
3. Form: je Gruppe eine Tabelle mit Empfehlung; Antwort gesammelt („alles ok außer …“).
4. Schreiben: neues `jira_update_many` (eine Rückfrage für alle) **und** bessere Einzelrückfrage (Titel, alt → neu, Grund).
   Sammelweg erst testen; geht er nicht, beantwortet die Person erst alles, dann einzeln nach Jira (Knut, 07.10.).
5. Agent vorlaufen: je gewähltem Ticket ein **neuer eigener Chat**, der nach dem Abschluss gestartet wird.
6. Voller Durchgang nur bei ausdrücklichem Start (Vorlage / „Tagesabschluss“); ab 16 Uhr in anderen Chats bleiben es
   höchstens drei Fragen plus Hinweis auf den Durchgang.
7. Neue Tasks im Tagesabschluss erlaubt, wenn die Person es ausdrücklich verlangt — nach `olaf-jira` (Dublettenprüfung,
   Workstream, Ziel/Ergebnis, Owner, Datum), mit Rückfrage.

## Scheiben

1. **Bessere Einzelrückfrage** (`web/mcp/werkbank-tools.ts`, `claude-bridge/src/tools.ts`):
   `jira_update` bekommt die optionalen Felder `summary` (Ticket-Titel), `was` (bisheriger Wert, z. B. „To Do, fällig
   02.10.“) und `reason`. `confirmQuestion` zeigt: **PM-386 „Testumfang …“** · Status To Do → **In Progress** · Grund: ….
   Die Werkbank-Route ignoriert die drei Felder (nur Anzeige).
2. **`jira_update_many` — erst testen** (`werkbank-tools.ts`, `main.ts`, `tools.ts`): `changes: [{key, summary?, was?,
   reason?, comment?, status?, due?}]`, höchstens 25. Klasse `confirm`; eine Rückfrage mit einer Zeile je Ticket. Route
   `/internal/jira-update-many` prüft alle Schlüssel vorab (unbekannt → 404, nichts geschrieben), schreibt dann der Reihe
   nach und meldet je Ticket `ok` oder den Fehler (kein Abbruch beim ersten Fehler).
   - **Gemessen 07.10.:** ein MCP-Schreibaufruf ≈ 1 s (`claude-bridge.log`, `via: direkt`); ein Ticket mit Datum +
     Kommentar 2–3 s, 15 Tickets 30–45 s. Das Werkzeug bricht heute nach 30 s ab (`werkbank-tools.ts`, `call()`), also
     Zeitlimit je Aufruf mitwachsen lassen (10 s je Ticket, höchstens 300 s).
   - **Test (Knut, 07.10.: „müssten wir testen ob das geht“):** (a) Trockenlauf mit 25 Änderungen, (b) echter Lauf auf
     zwei, drei eigenen Tickets, die Knut nennt.
   - **Geht es nicht** (Zeitlimit, Teilfehler unklar, MCP verweigert Serien): Ausweichweg nach Knut — die Person
     beantwortet erst den ganzen Durchgang, danach schreibt der Chat **Ticket für Ticket** mit `jira_update` und der
     Rückfrage aus Scheibe 1. Scheibe 3 nennt beide Wege; welcher gilt, steht nach dem Test fest.
3. **Durchgang statt drei Fragen** (`hygiene.ts`, `context.ts`, `assist.ts`, `librechat.yaml`):
   - `reviewSet(all, who, today)` liefert die Tickets nach Entscheidung 1, gruppiert (überfällig · heute fällig ·
     bis +7 Tage · ohne Datum · heute bearbeitet, sonst nicht dabei), je Zeile Key, Titel, Status, Fällig, letzte Änderung.
   - Bei `eod` (ausdrücklicher Start) baut `sessionStart` statt `hygieneBlock` den Block `reviewBlock()`: die Liste plus
     Anweisung (Teilagenten `ticket-pruefer`, Tabellen mit Empfehlung, gesammelte Antwort, `jira_update_many`, Angebot
     „Agent vorlaufen“, neue Tasks nur auf ausdrücklichen Auftrag nach `olaf-jira`).
   - Ab 16 Uhr ohne `eod`: unverändert drei Fragen, plus eine Zeile „Für den vollen Durchgang: Vorlage Tagesabschluss“.
   - Vorlagentext in `librechat.yaml` angepasst.
4. **Agent vorlaufen = neuer Chat** (`werkbank-tools.ts`, `main.ts`, `tools.ts`): Werkzeug `agent_start {key, note}` →
   `/internal/agent-start` → `startChatAgent(u, i, note, 'work')`, gleiche Schranken wie die Board-Route (Trockenlauf,
   Claude-Token, ein laufender Agent je Ticket). Klasse `confirm` (startet einen Chat, der Tokens kostet). Rückgabe:
   Link auf den neuen Chat. Der Durchgang ruft es erst nach der Jira-Runde auf, je gewähltem Ticket einmal.

## Tests

- S1: `confirmQuestion('mcp__werkbank__jira_update', {key, summary, was, reason, status})` enthält Titel, alt, neu, Grund;
  ohne die Felder wie bisher.
- S2: Route — unbekannter Schlüssel → 404 und nichts geschrieben; ein Fehler mittendrin → übrige geschrieben, Fehler je
  Key gemeldet; > 25 → 400. Klasse `confirm` in allen drei Modi (normal, auto, auto-voll). Rückfrage listet alle Zeilen.
- S3: `reviewSet` — Gruppen und Grenzen (heute, +7, +8, ohne Datum, Done/Workstream/fremd raus, Doppelte nur einmal in
  der vordersten Gruppe). `sessionStart` mit `eod` → Durchgang-Block, ohne `eod` ab 16 Uhr → drei Fragen + Hinweis.
- S4: Route — Trockenlauf → 409, unbekanntes Ticket → 404, ohne Token → 412, sonst `startChatAgent` gerufen. Klasse
  `confirm` in allen drei Modi.
- `npm test` in `web/` und `claude-bridge/` grün.

## Definition of Done

- Ein Tagesabschluss über die Vorlage listet alle Tickets nach Entscheidung 1 mit Empfehlung je Ticket.
- Gesammelte Änderungen gehen mit einer Rückfrage nach Jira; die Rückfrage zeigt je Ticket Titel, alt → neu, Grund.
- Einzelne `jira_update`-Rückfragen zeigen Titel, alt → neu, Grund, wenn das Modell sie mitgibt.
- „Agent vorlaufen“ startet nach „ja“ je Ticket einen eigenen Chat und verlinkt ihn.
- Ab 16 Uhr in anderen Chats: weiter höchstens drei Fragen.

## Nicht drin

- Kein Lauf über Nacht (Entscheidung 5 b verworfen).
- Keine Vorab-Empfehlungen per Skript auf dem Server (2 c verworfen).
- Kein neues Werkzeug zum Anlegen — neue Tasks laufen über den Atlassian-MCP mit der bestehenden Rückfrage.

## Risiken

- Kontext: 36 Zeilen Liste ≈ 1 000 Tokens im Sitzungsstart — nur bei `eod`, daher vertretbar.
- `was` kommt vom Modell und kann falsch sein; es ist Anzeige, nicht Grundlage des Schreibens.
- Viele Chats auf einmal: `agent_start` je Ticket einzeln bestätigt; ein laufender Agent je Ticket (bestehende Schranke).
- Konflikt mit den uncommitteten Änderungen in `werkbank-dev` (`tools.ts` Zeilen 88–145): beim Zusammenführen von Hand.
- Sammelweg gegen echtes Jira noch nicht gemessen (Wochenende: nur Mock). Offen für Montag: Test (b) auf 2–3 Tickets, die Knut nennt.

## Council (09.10.2026, nach der Portierung)

Stimmen getrennt als Teilagenten: Spezialist (Technik/Sicherheit), Advocatus Diaboli (anderes Modell); Befürworter und
Finalizer in der Hauptsitzung. Für Knut zur Nachprüfung (Wochenend-Regel: im Sinne von Knut entschieden).

**Befürworter.** Der Code war schon da und geprüft (S1–S4); die Portierung ist mechanisch bis auf einen Konflikt. Der
Durchgang behebt genau den Anlass vom 07.10. (drei Fragen, Stand stand schon im Kommentar, nackte Rückfrage).

**Spezialist.** `confirm` greift in allen Modi (Werkbank-Regel vor „voll“), auch für Teilagenten; `ticket-pruefer` ist
nur lesend. Lücken: `agent_start` ohne Projekt/Bereich (anderer Weg als das Board); Kommentar in der Rückfrage gekürzt,
geschrieben voll; `summary`/`was` vom Modell; Werkzeug-Zeitlimit kleiner als die Server-Laufzeit → Modell sieht Fehler,
Server schreibt weiter, Wiederholung doppelt Kommentare; kein `isMine`; doppelte Schlüssel; „ohne Datum“ unbegrenzt;
ungültiges `updated` wirft; `eod` ohne Jira-Schreibrecht still.

**Advocatus Diaboli.** Dieselben Punkte schärfer: 25 Zeilen werden blind bestätigt (riskante Änderungen markieren);
fremde Tickets über Anweisungen in Ticket-Texten (Prompt-Injection beim Lesen); Abend-Slot wird beim Start verbraucht;
Kosten der Teilagenten ohne Budget.

```
VERDICT: HOLD → nach Umsetzung PASS (confidence 0.8)
WHY: Richtung und Schranken stimmen; ohne die Punkte zeigte die Rückfrage nicht genau, was geschrieben wird, und der
     Sammelweg ließe sich auf fremde Tickets lenken.
BINDING CONDITIONS (alle umgesetzt, Tests in Klammern):
  T1 [must-fix] agent_start über startTicketAgent wie das Board (gemeinsame Funktion; api.test „Agent vorlaufen“).
  T2 [must-fix] Rückfrage zeigt Kommentar vollständig (≤ 1500, mehr lehnt die Werkbank ab); Done und „Datum entfernen“
                mit ⚠️ markiert (bridge.test „Rückfrage vor Jira …“).
  T3 [must-fix] Titel aus der Rückfrage wird gegen die Kopie geprüft, sonst 409 und nichts geschrieben; „bisher“ heißt
                „bisher (laut Chat)“ (api.test Task-Hygiene).
  T4 [must-fix] Gesammelt nur eigene Tickets (isMine), keine doppelten Schlüssel — sonst nichts geschrieben.
  T5 [must-fix] Server-Frist = Werkzeug-Frist − 5 s; danach „nicht versucht“; bei Zeitüberschreitung sagt das Werkzeug
                „nicht wiederholen, erst Stand lesen“.
  T6 [should]   ≤ 15 Zeilen je Gruppe + „und N weitere“; Aufteilen in ≤ 25 je Aufruf; ungültige Daten brechen nicht.
  T7 [should]   Tagesabschluss ohne Jira-Schreibrecht sagt, warum es keinen Durchgang gibt.
  V1 [verify]   Montag, echtes Jira: Sammelweg auf 2–3 Tickets, die Knut nennt (Zeit je Ticket, MCP-Werkzeug-Zeitlimit
                von Claude Code ≥ 300 s, Teilfehler).
NOTES: Abend-Slot wird beim ausdrücklichen Start verbraucht (Entscheidung 6 so gewollt) — für Knut zur Nachprüfung.
       Die Einzelroute `jira_update` prüft weiter nicht auf „eigene“ (Stand dev, bewusst unverändert).
