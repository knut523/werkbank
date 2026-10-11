---
status: Schnitt 1 von docs/plan-roadmap-zu-agent.md (E5) — Plan 09.10.2026, Council siehe unten
quelle: docs/plan-roadmap-zu-agent.md, Teile B + C + Bedingung 11; Bedingung 5 (review_ready); E1–E5 entschieden (Knut, 09.10.2026)
---

# Schnitt 1: „Heute“, eine Liste „bei mir“, Buckets, Review-Schlange

## Ziel

Die Werkbank wird ein Werkzeug statt einer Sammlung Seiten: Wer sie öffnet, landet auf **„Heute“** und sieht in
einer Liste, was auf ihn wartet — zuerst fertige Agentenläufe zum Review, dann Fragen und Entscheidungen, dann
den Tag, dann Tickets, die Pflege brauchen. Die Roadmap zeigt je Thema kompakt: wartet auf dich · in Arbeit ·
als Nächstes · erledigt. „Agent ansetzen“ an Specs (Teil A) ist **nicht** in diesem Schnitt.

## Stand heute (Code, Branch-Basis origin/dev)

- `#/` ist „Einrichtung“; die Navigation hat 9 Einträge, die LibreChat-Leiste 7.
- „Für mich offen“ (`ForMe`) steht nur auf der Roadmap; Hygiene steht als eigenes Panel auf Board und Sprint;
  „Mein Tag“ hat eine eigene Ticketliste. „Bei mir“ ist an vier Stellen verteilt.
- Agentenläufe (`agent_runs`, `mode: chat`) kennen `läuft / wartet auf ja / fertig`. „Fertig“ heißt nur „Sitzung
  bereit“ — auch nach Zeitlimit, Schrittlimit oder Fehler. Eine Abschlussmarke gibt es nicht.
- Antworten in einen bestehenden Chat kann nur LibreChat selbst; die Werkbank legt bisher nur neue Chats an.

## Schnitte (je ein Commit)

**S1 Fertig-Marke (Brücke + MCP + Server).**
- Werkbank-MCP: neues Werkzeug `review_ready({ gemacht, nicht_gemacht, risiko, dod: [{ punkt, stand: ja|teilweise|nein, beleg? }], artefakte?: [] })`,
  Klasse `read` (ändert nur Werkbank-Zustand). Die Brücke gibt dem MCP-Prozess die Unterhaltung mit (`WERKBANK_CONV_ID`).
- `POST /internal/review-ready`: prüft Pflichtfelder (alle drei Texte nicht leer, mind. ein DoD-Punkt), sucht den
  neuesten Chat-Lauf dieser Person in dieser Unterhaltung und setzt `reviewReadyAt`, `review {…}`, löscht `reviewedAt`/`rework`.
  Ohne Lauf: Fehlermeldung an den Agenten („kein Werkbank-Lauf zu diesem Chat“), nichts gesetzt.
- Brücke merkt sich je Unterhaltung, wie die letzte Runde endete (`end`: ok · max_turns · timeout · error ·
  frage_verfallen), `/sessions` liefert es mit; `refreshChatRuns` speichert es als `endReason`.
- `CHAT_AGENT_INSTRUCTION`: Schritt „Zum Schluss `review_ready` aufrufen“ und E1 (a): bei Code lokaler Branch mit
  Commits, danach als letzter Schritt `git push` des Feature-Branches anstoßen (das System fragt; Draft-PR erst nach
  dem Push).

**S2 Review-Schlange und „Heute“-API (Server).**
- Reine Funktion `reviewQueue(runs)` → je Lauf genau ein Eimer:
  `review` (reviewReadyAt, nicht geprüft) · `frage` (wartet auf ja) · `haengt` (fertig ohne Marke, endReason ≠ ok) ·
  `still` (fertig ohne Marke, endReason ok — hat ohne Abschluss aufgehört, meist eine Rückfrage im Text) · `laeuft`.
  Geprüfte (`reviewedAt`) und Besprechen-Chats fallen raus; Läufe älter als 14 Tage ohne Marke auch.
- `GET /api/today`: Review-Schlange der Person + „Wartet auf dich“ (heutiger `ForMe`-Inhalt, Tickets ohne/über Datum
  entfallen dort, die stehen in der Hygiene) + Tag (Blöcke heute aus Mein Tag) + Zähler `n`.
- `GET /api/today/count`: nur der Zähler für die Navigation (Review + Frage + Hängt + Still + offene Sync-Fragen
  + PRs, bei denen ich dran bin + Hygiene ohne „später“).
- Aktionen an einem Lauf (nur eigene Läufe, sonst 403):
  `POST /api/runs/:id/passt` → `reviewedAt`; mit `comment: true` erst Vorschau, nach `confirm` Jira-Kommentar
  „Von <Vorname> geprüft: <gemacht>“ über den vorhandenen Schreibweg (E2: nur kommentieren, kein Status).
  `POST /api/runs/:id/reply { text }` → Text als nächste Nachricht in **denselben** LibreChat-Chat
  (`/api/messages/:conv` → letzte Nachricht → `/api/agents/chat` mit `conversationId` + `parentMessageId`).
  Damit gehen „Nacharbeit“ (Notiz; setzt `reviewReadyAt` zurück, `rework` mit Zeit), ✅ Ja / ✖️ Nein auf eine
  Rückfrage und „Weiter“ bei „hängt“. Nicht im Trockenlauf.

**S3 Startseite „Heute“ und eine Liste „bei mir“ (Web).**
- `#/` = Heute; Einrichtung wandert nach `#/einrichtung` (alte Links `#/` aus Fehlermeldungen zeigen „Einrichtung“
  als Link in der Fußzeile; ohne Anmeldung bleibt die Einrichtung die erste Seite).
- Reihenfolge: **Wartet auf dein Review** (Karten mit Ticket, Gemacht / Nicht gemacht / Risiko, DoD-Liste mit
  Stand, Artefakte und geschriebene Dateien, Knöpfe Ansehen · Passt · Nacharbeit) → **Wartet auf dich**
  (Rückfragen der Agenten mit ✅/✖️ direkt in der Karte, hängende/stille Läufe mit „Weiter“/„Ansehen“, Sync-Fragen,
  Entscheidungen, PRs) → **Dein Tag** (heutige Blöcke, Link „Mein Tag“) → **Tickets, die Pflege brauchen**
  (`HygienePanel`). Läuft noch: eine Zeile „n Agenten arbeiten“.
- Gemeinsame Komponente `BeiMir` (= diese Liste). Board, Sprint, Mein Tag und Roadmap zeigen statt eigener Listen
  eine Zeile „Bei mir: n offen → Heute“ (`BeiMirLink`). Der Roadmap-Kasten „Für mich offen“ entfällt dort.

**S4 Navigation (Web + LibreChat-Leiste).**
- Oben: **Heute (n) · Roadmap · Board · Sprint · Wissen**; im Fuß: Mein Tag · Ziele · Skills · Dateien & Teilen ·
  Einrichtung. LibreChat-Leiste dieselben fünf (Overlay `WerkbankNav.tsx`, `WerkbankRoute.tsx`: Einrichtung bleibt
  als Route `/wb/einrichtung` erreichbar).
- Zähler aus `/api/today/count`, frisch bei Seitenwechsel und alle 60 s.

**S5 Roadmap-Überblick als Buckets (Web + Server).**
- Neue reine Funktion `topicBuckets(specs, decisions, runs)` je Thema: **Wartet auf dich** (offene `- Knut:`-Zeilen
  in Specs und Themen-Übersicht; Zahl + erste 2) → **In Arbeit** (Zustand 4-Review mit PR-Live-Stand; laufende
  Agenten auf Tickets der Specs) → **Als Nächstes** (Top 3 nach Rang aus 3-Plan/2-Pre-Plan, ohne erledigte/aktive
  Tickets) → **Erledigt** (Zahl 5-Live, letzte 3 nach `last-verified`, mit Datum „geprüft“).
  Themen sortiert nach „wartet auf dich“, dann bestem Rang.
- Tabs: **Überblick** (Standard, Buckets; je Thema „alle Zustände ▾“ klappt die Swimlane auf) · **Rangliste** ·
  **PR-Review** · **Pflege ⋯** (Konsistenz, Ordnung). Alte Adressen (`#/roadmap/kanban|ordnung|check|entscheidungen|prio`)
  funktionieren weiter.
- Handy (≤ 760 px): Buckets und Ranglisten-Tabelle gestapelt (eine Karte je Zeile, Spaltenname als Beschriftung).

## Nicht in diesem Schnitt

Teil A (Spec → Jira → Agent, Bedingungen 1–4, 7–10), Jira-Status durch „Passt“ (E2: nie), Push-Automatik (E1 a:
Push bleibt Rückfrage), Live-Werkbank neu starten/ausrollen.

## Definition of Done

1. `review_ready` existiert im Werkbank-MCP (Klasse `read`), verlangt Gemacht / Nicht gemacht / Risiko und mindestens einen DoD-Punkt mit Stand, setzt `agent_runs.reviewReadyAt` am Lauf der eigenen Unterhaltung; ohne Lauf oder mit fehlenden Feldern: Fehler, nichts gesetzt (Test).
2. Zeitlimit, Schrittlimit, Fehler und verfallene Rückfrage erscheinen als „hängt“, nie als „wartet auf Review“; ein Lauf ohne Marke, der normal endete, erscheint als „wartet auf dich“ (Test über `reviewQueue` und über die Brücke).
3. `#/` zeigt „Heute“ in der Reihenfolge Review-Schlange → Wartet auf dich → Tag → Tickets mit Pflegebedarf; ohne Anmeldung die Einrichtung.
4. „Passt“ markiert geprüft; ein Jira-Kommentar entsteht nur nach Vorschau und Bestätigung (Test: ohne `confirm` 0 Schreibvorgänge im Jira-Mock); „Nacharbeit“ schickt die Notiz in denselben Chat und nimmt den Lauf aus der Review-Schlange; ✅/✖️ auf eine Rückfrage geht in denselben Chat (Test mit LibreChat-Nachbau: `conversationId` und `parentMessageId` gesetzt). Fremde Läufe: 403.
5. Eine gemeinsame Liste „bei mir“: Board, Sprint, Mein Tag und Roadmap verlinken auf Heute statt eigene Listen zu zeigen.
6. Navigation Werkbank und LibreChat-Leiste: Heute · Roadmap · Board · Sprint · Wissen, Rest im Fuß; Zähler „Heute (n)“.
7. Roadmap-Standard ist der Überblick mit Buckets je Thema (Wartet auf dich → In Arbeit → Als Nächstes → Erledigt), volle Swimlane je Thema aufklappbar; Tabs Überblick · Rangliste · PR-Review · Pflege ⋯; alte Adressen gehen.
8. Am Handy (390 px) keine waagrechte Rollbalken auf Heute und Roadmap-Überblick; Tabellen gestapelt.
9. Tests der Brücke und der Web-App grün, `vite build` grün; Screenshots vom echten Build auf einer isolierten Instanz (Handy + Desktop) mit `bericht.md` unter `~/work/knut/review-pakete/114-werkbank-heute/`; Live-Werkbank unberührt.
10. README/PLAN nachgezogen; lokale Commits auf `feat/heute-review-schlange`, nichts gepusht.

## Council (09.10.2026)

Hinweis: Die drei als Teilagenten gestarteten Stimmen (Spezialist, Advocatus Diaboli auf zweitem Modell, UX-Experte)
haben keinen Bericht zurückgegeben (Teilagenten-Typ ohne Rückgabe); das Teilagenten-Limit je Nachricht war danach
erreicht. Die Stimmen wurden deshalb in der Hauptsitzung nacheinander und getrennt geführt — schwächer als ein
zweites Modell, für Knut zur Nachprüfung markiert.

**Befürworter.** Fast alles ist vorhanden (agent_runs, Sitzungsstatus der Brücke, ForMe, Hygiene, Timebox); neu
sind ein Werkzeug, zwei Routen und eine Seite. Die Fertig-Marke macht „fertig“ zum ersten Mal überprüfbar, die
Antwort in denselben Chat schließt die Schleife ohne Kontextwechsel.

**Spezialist (Technik/Sicherheit), im Code nachgesehen.**
- Die Brücke baut die MCP-Server je Zug (`server.ts:275`, `mcpServersFor`), `convId` ist dort bekannt → `WERKBANK_CONV_ID`
  im Env ist sicher; die Unterhaltung kommt aus dem Env, nie aus den Argumenten → ein Agent kann keinen fremden Lauf markieren.
- LibreChat: `GET /api/messages/:conv` (`routes/messages.js:274`) liefert die Nachrichten der Person; `POST
  /api/agents/chat/:endpoint` nimmt `conversationId` + `parentMessageId` (`controllers/agents/request.js:174ff`). Wartet die
  Brücke auf „ja“, ist der Zug in LibreChat schon beendet (`detach`), der neue Zug landet in `handleTurn` → `existing.pending`
  (`sessions.ts:573`). Läuft ein Zug, antwortet die Brücke „arbeitet noch“ → **Antworten nur, wenn der Lauf nicht „läuft“**.
- Rundenende an vier Stellen: `result.subtype` (`sessions.ts:433`), Zeitlimit (`:270`), verfallene Rückfrage (`:519`),
  Fehler (`:759`), dazu Kontingent erschöpft. Beim Start jeder Runde zurücksetzen.
- `/api/today/count` darf weder GitHub noch den Vault-Index anfassen; `refreshChatRuns` höchstens alle 30 s.

**Advocatus Diaboli.**
1. *must-fix* Agent ruft `review_ready` und arbeitet weiter (oder stellt danach die Push-Frage) → Karte sagt „bereit“, Lauf
   läuft. → „läuft“ schlägt die Marke; „wartet auf ja“ mit Marke zeigt die Review-Karte **mit** der Rückfrage.
2. *must-fix* Alte Läufe haben nie eine Marke → „Heute“ flutet mit „still“. → Nur Läufe, die mit der neuen Anweisung
   gestartet wurden (`reviewable: true`), und nur 14 Tage.
3. *must-fix* `#/` umstellen bricht Links („unter Einrichtung“), LibreChat-Standardseite `einrichtung` → `#/` und den
   e2e-Durchlauf. → Einrichtung auf `#/einrichtung`, alle Verweise umstellen, LibreChat-Standard `heute`.
4. *should* ✅ aus der Werkbank, während der Chat in einem Tab offen ist → der Tab kennt die neue Nachricht erst nach
   Neuladen. → Hinweis an der Karte, Link „Chat öffnen“.
5. *should* Doppelklick auf „Passt + Kommentar“ → zwei Kommentare. → idempotent über `commentedAt`.
6. *should* „Erledigt“ nach `last-verified` ist kein Live-Datum. → Beschriftung „geprüft“, nicht „live seit“.
7. *should* Board/Sprint verlieren die Pflege-Antworten vor Ort. → Link mit Zahl, gut sichtbar; Bedingung 11 verlangt genau
   das — für Knut zur Nachprüfung.

**UX-Experte (Plan + vorhandener Code, ohne Screenshots).**
- (3) Review-Karte: genau **eine** Primäraktion „Passt“; „Nacharbeit“ sekundär, klappt ein Textfeld in der Karte auf
  (kein Dialog); „Ansehen“ als Link. Oben Ticket + Titel, dann Gemacht; „Nicht gemacht“ und „Risiko“ farbig abgesetzt;
  DoD als Liste ✓ / ◐ / ✗.
- (3) ✅/✖️ auf eine Agenten-Rückfrage nur mit sichtbarem Fragetext (was genau wird freigegeben) — die Brücke liefert ihn.
- (2) Leere Abschnitte weglassen; ein einziger Leerzustand „Nichts wartet auf dich“ mit Weg zur Roadmap.
- (2) Zielgrößen ≥ 44 px am Handy für die Knöpfe der Karten; Zähler in der Navigation mit `aria-label`.
- (2) Bucket-Zeile: Desktop vier Spalten, Handy gestapelt mit Spaltenname; leere Felder „—“; „alle Zustände ▾“ mit
  `aria-expanded`.

**Finalizer.**

```
VERDICT: HOLD (confidence 0.78)
WHY: Schnitt ist klein und nutzt Vorhandenes; ohne die Bedingungen würde „bereit zum Review“ lügen (weiterarbeitender
     Agent, Altläufe) und „#/“ bräche Links.
BINDING CONDITIONS:
  K1 [must-fix] Eimer-Vorrang: läuft > wartet auf ja > Marke > hängt > still; Test über reviewQueue.
  K2 [must-fix] „still“ nur für reviewable-Läufe ≤ 14 Tage; Altläufe nie in der Schlange (Test).
  K3 [must-fix] Antworten nur auf eigene, nicht laufende Läufe; nie im Trockenlauf; Test 403/409.
  K4 [must-fix] Fragetext der offenen Rückfrage aus der Brücke an der Karte.
  K5 [must-fix] Einrichtung unter #/einrichtung, alle Verweise und die LibreChat-Leiste nachgezogen.
  K6 [must-fix] Passt-Kommentar nur nach confirm, idempotent (Test: 0 Schreibvorgänge ohne confirm, 1 bei Doppelklick).
  K7 [verify]   Handy 390 px: Heute und Überblick ohne waagrechtes Rollen (Screenshot).
  K8 [verify]   /api/today/count ohne GitHub/Vault, refreshChatRuns gedrosselt.
NOTES: Der Weg „Antwort aus der Werkbank in denselben Chat“ ist gegen den LibreChat-Nachbau getestet, nicht gegen echtes
       LibreChat — erst die Sichtprüfung mit echtem LibreChat (nach Ausrollen) beweist ihn.
```
