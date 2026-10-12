---
title: "Plan — Workspace: schreiben während der Arbeit, Themen-Gruppen, Hauptchat überwacht die Unter-Chats"
nummer: offen
paket: 154-workspace-hauptchat-monitor
status: in-arbeit
branch: feat/hauptchat-monitor
basis: fix/bridge-idle-timeout (678ab86 = Live release/werkbank-2026-10-12 + Leerlauf-Zeitlimit)
created: 2026-10-12
owner: Knut
---

# Plan — Workspace: schreiben während der Arbeit, Themen-Gruppen, Hauptchat überwacht die Unter-Chats

> Knut, 12.10.2026 abends: „Ich kann nichts eingeben, wenn er arbeitet, ich kann ihn nur stoppen.“ · „Die Chatdarstellung
> ist gut, aber jetzt noch in Themengebiete mit Dropdown wäre toll, automatisch.“ · „Irgendwie müssen die Tasks dem
> Maintask Bescheid geben, wenn sie was brauchen oder Zeitlimit oder irgendwas anderes ist — der Hauptchat muss so
> monitoren wie du.“

## 1. Befund (belegt)

### 1.1 Schreiben während der Arbeit
- **LibreChat-Client:** Das Textfeld bleibt während eines Zugs bedienbar, aber `useTextarea.handleKeyDown` bricht bei
  `Enter && isSubmitting` sofort ab, und `ChatForm` zeigt statt „Senden“ nur „Stopp“ (`isSubmitting && showStopButton`).
  Der Senden-Knopf ist zusätzlich `disabled={… || isSubmitting …}`.
- **Brücke:** Eine zweite Nachricht an eine laufende Unterhaltung beantwortet `handleTurn` mit „Diese Unterhaltung arbeitet
  noch an der vorigen Nachricht. Bitte kurz warten.“ (`sessions.ts`, Zweig `existing`). `lockFor`/„chat-busy“ betrifft nur
  andere Chats derselben Person (Parallelgrenze), nicht diesen Fall. Für Stränge lehnt `sendOrch` mit 409 „arbeitet noch“ ab.
- **Agent SDK 0.3.284 (nachgelesen und ausprobiert):** `query({ prompt })` nimmt statt eines Strings auch
  `AsyncIterable<SDKUserMessage>` (Streaming-Input). `SDKUserMessage.priority: 'now' | 'next' | 'later'`. Das CLI legt
  nachgeschobene Nachrichten in seine Warteschlange und **faltet sie zwischen zwei Werkzeugaufrufen in den laufenden Zug ein**
  (`sdk.d.ts`: „queued user message folded in mid-turn“). Mit `--replay-user-messages` meldet das CLI jede Nachricht in dem
  Moment zurück, in dem es sie dem Modell gibt (`isReplay: true`, mit unserer `uuid`).
  Versuch am 12.10. mit `claude-haiku-4-5` (Skript im Bericht): Nachricht nach 9 s in einen Zug mit zwei `sleep 6`-Befehlen
  geschoben → Echo bei 11,2 s direkt nach den Werkzeugergebnissen, die Antwort nennt das Geheimwort, **ein** Ergebnis.
  Kommt die Nachricht zu spät (Zug ohne weitere Werkzeuge), hängt das CLI im selben Lauf **einen zweiten Zug** an
  (Echo + zweites Ergebnis). Beide Fälle tragen also, solange die Eingabe offen bleibt, bis jede Nachricht bestätigt ist.

### 1.2 Seitenleiste
- `HauptchatSection.tsx` (Paket 144) gruppiert die Unter-Chats nach **Lauf** (`laufName`: Titelteil vor „:“). Heute hat damit
  fast jeder Strang seine eigene Gruppe („Rechner b“, „Cockpit“, „Flex“, „Bot“, „Admin-PRs fertig machen“, „Hardware“,
  „Doppelversand Folge-PRs“). Einzelne Stränge stehen ohne Kopf da. Ein Thema über mehrere Läufe gibt es nicht.

### 1.3 Hauptchat überwacht — warum es am 12.10. um 16:40 nicht gegriffen hat
- **Live ist:** Leitstand-Meldungen (Plan 132) für `fertig`, `braucht Antwort`, `blockiert`, `Deckel`, `review_ready`,
  Knuts Antworten und das eigene „weiter“ des Hauptchats. **Technische Zugenden der Stränge (Schritt-/Zeitlimit, Neustart,
  verlorene Nachricht, Parallelgrenze, Kontingent) melden bewusst nichts** (`strandEvent`: `if (st.cause) return null`).
  Die Annahme dahinter: Das automatische „weiter“ (Plan auto-weiter) übernimmt.
- **Nachgestellt aus den Live-Protokollen und der Datenbank (nur gelesen):** 14:25:42 UTC bekamen vier Stränge „weiter“ von
  Hand (`f0c476a5`=24ccefb3 Rechner b, `7558493d`=93ab16ec Admin-PRs, `b9ceefc6`=6b742e30 Cockpit, `9421640e`=d7a7b2ab Flex).
  Um 14:40:42 endeten alle vier am alten 15-Minuten-Gesamtlimit (das Leerlauf-Limit 678ab86 ging erst 14:48 live).
  Danach kam **kein** `orch-auto-weiter` im Web-Log. Den Brücken-Neustart um 14:48:51 setzte ebenfalls niemand automatisch fort.
- **Ursache:** Zu jedem dieser vier Stränge stand eine **offene Sammel-Rückfrage**, die der Hauptchat mit
  `orch ask --strand` angelegt hatte: q-8aec2b (24ccefb3, 12:07), q-95001c (6b742e30, 12:28), q-da785e (93ab16ec, 13:23),
  q-72a711 (d7a7b2ab, 11:21). `autoOne` zählt *jede* offene Frage zum Strang als „wartet auf eine Rückfrage“, und `autoWeiter`
  liefert dann `none`, ohne Spur im Protokoll. Das galt auch, nachdem um 14:25 längst wieder jemand „weiter“ geschickt hatte.
  Ein Strang kann aber gar nicht auf eine solche Frage warten: Stränge haben keine Rückfragen und sammeln Entscheidungen mit
  Empfehlung, und ein technisches Zugende heißt, er war mitten in der Arbeit.
  Zugleich meldete `strandEvent` nichts, weil `cause` gesetzt war. Der Hauptchat erfuhr also nichts.
  Die Zähler „3 bzw. 5“ sind `autoTotal` und haben mit dem Deckel nichts zu tun (`autoStreak` war 0).
- **„failed (Brücke neu gestartet)“:** `orchStatus` meldet einen abgebrochenen Zug als `failed`, obwohl er nur auf das
  automatische „weiter“ wartet. Gesperrt hat auch hier die offene Rückfrage (Flex d7a7b2ab).
- **CLI:** `orch send <id> TEXT` liest den Text nur aus `--text` oder stdin, Positionsargumente fallen weg. Ohne Pipe ergibt
  das 400 „Nachricht fehlt“, mit offener Pipe hängt der Aufruf. `call()` bricht jede Anfrage nach 60 s ab
  (`AbortSignal.timeout(60_000)`). `start` mit G0 (fetch, Prüfungen) kann länger dauern: Der Server legt den Strang trotzdem an,
  der Hauptchat versucht es erneut, und es entsteht ein doppelter Start.

## 2. Grilling — Entscheidungen (Rückfrage an Knut, mit Empfehlung; gebaut ist jeweils die Empfehlung)

Der Strang darf keine Rückfragen stellen. Darum ist jede Frage hier mit der Empfehlung umgesetzt, und Knut kann sie umdrehen.

| # | Frage | Optionen | Empfehlung (gebaut) |
|---|---|---|---|
| G1 | Was passiert mit einer Nachricht während des Zugs? | a) in den laufenden Zug einfalten (wie Claude Code), sonst danach als nächster Zug · b) nur „danach“ (Warteschlange) · c) Zug abbrechen und neu starten | **a** — der Agent sieht sie beim nächsten Schritt; nur wenn der Zug ohne Zustellung endet, sendet der Client sie danach selbst |
| G2 | Wo sieht man die nachgereichte Nachricht? | a) als Zeile „📨 Nachgereicht, gelesen: …“ in der laufenden Antwort · b) als eigene Benutzer-Nachricht im Verlauf | **a** — LibreChat kann während eines Zugs keine zweite Benutzer-Nachricht speichern; die Zeile bleibt im gespeicherten Verlauf |
| G3 | Für wen gilt „schreiben während der Arbeit“? | a) alle Chats (Team inkl.) · b) nur Admins | **a** — ist eine reine Bequemlichkeit, keine neue Berechtigung; Not-Aus `BRIDGE_NACHREICHEN=off` |
| G4 | Themen-Gruppen für welche Chats? | a) nur Hauptchat-Bereich (Unter-Chats) · b) auch Knuts normale Chats in LibreChats Liste | **a** — LibreChats eigene Liste ist virtualisiert und nach Datum sortiert; ein Umbau dort ist ein eigener, größerer Patch |
| G5 | Wie entsteht das Thema? | a) feste Stichwortliste über Titel → Paket → Arbeitsordner, sonst „Sonstiges“, von Hand überschreibbar · b) Modell klassifiziert | **a** — vorhersagbar, kostet nichts, Fehlgriffe korrigiert `orch thema <id> <Thema>` bzw. der Hauptchat |
| G6 | Themenliste | Rechner · Flex · Cockpit · Admin · Bot · Workspace · Sprint · Roadmap · Sonstiges | **so** — Reihenfolge der Prüfung: Flex vor Rechner (Flex liegt im Tarif-App-Repo), Cockpit vor Admin |
| G7 | Von Hand ändern — wo? | a) `orch thema` (CLI) + Werkzeug `orch_thema` für den Hauptchat · b) zusätzlich Menü je Zeile in der Seitenleiste | **a** jetzt; b als Folgeschnitt, wenn Knut es oft braucht |
| G8 | Blockiert eine offene Rückfrage zum Strang das automatische „weiter“? | a) nie (außer der Deckel-Frage) · b) nur, wenn sie nach der letzten Nachricht an den Strang angelegt wurde · c) wie heute (immer) | **a** — ein technisches Zugende heißt „mitten in der Arbeit“; anhalten geht ausdrücklich mit `orch review` |
| G9 | Wann meldet ein Strang „hängt“ an den Hauptchat? | a) wenn ein technisches Zugende nach 5 min nicht fortgesetzt ist (Sicherheitsnetz) · b) bei jedem technischen Zugende | **a** — b weckte den Hauptchat bei jedem Zeitlimit; das automatische „weiter“ greift normalerweise binnen 20–40 s |
| G10 | Status nach Brücken-Neustart | a) `waiting` „wird automatisch fortgesetzt“ · b) `failed` wie heute | **a** — es ist kein Fehler; rot nur, wenn auch die Fortsetzung scheitert (dann „hängt“) |
| G11 | `orch send <id> TEXT` | a) Positionsargumente sind der Text · b) klar abweisen | **a**; `--text` und Positionstext zugleich → Fehler |
| G12 | CLI-Zeitlimit | a) `start`/`nachtbau` 15 min, sonst 60 s, `ORCH_CLI_TIMEOUT_S` überschreibt · b) überall 15 min | **a** — bei Zeitablauf Hinweis „Server arbeitet evtl. weiter — vor erneutem Start `orch list`“ |
| G13 | Darf der Hauptchat einem *laufenden* Strang schreiben? | a) ja, über dasselbe Nachreichen (`orch_send` an laufenden Strang → eingefaltet) · b) nein, 409 wie heute | **a** — genau das ist „monitoren wie du“; Deckel/Prüfung-Regeln bleiben |

## 3. Schnitte (je Punkt eigene Commits)

### S1 — Schreiben während der Arbeit
1. **Brücke** (`sessions.ts`): Prompt als Streaming-Input (erste Nachricht + Posteingang), `extraArgs['replay-user-messages']`.
   `injectMessage(userId, conv, text)` nimmt eine Nachricht nur an, wenn der Zug läuft und nicht auf „ja/nein“ wartet; sie geht mit
   `priority: 'next'` und eigener `uuid` hinein. Das Echo (`isReplay`, unsere `uuid`) setzt den Stand „gelesen“ und schreibt
   „📨 Nachgereicht, gelesen: …“ in die laufende Antwort. Die Eingabe schließt beim Ergebnis nur, wenn keine Nachricht mehr offen
   ist; sonst wartet sie auf den Folgezug des CLI. Endet der Zug ohne Echo (Abbruch, Zeitlimit, Fehler), gilt die Nachricht
   als „nicht gelesen“. Bei einem Kontowechsel werden offene Nachrichten erneut eingereiht.
   `BRIDGE_NACHREICHEN=off` = altes Verhalten (String-Prompt).
2. **Brücke** (`server.ts`): `POST /internal/inject`, `GET /internal/inject/<id>` (interner Schlüssel).
3. **Web** (`main.ts`): `POST /api/chat/nachreichen {conv, text}` und `GET /api/chat/nachreichen/<id>`. Gilt für die angemeldete
   Person und nur ihre eigenen Unterhaltungen, denn der Brücken-Schlüssel ist `person:chat`.
4. **Strang** (`sendOrch`): läuft der Strang → nachreichen statt 409 (G13). Deckel- und Prüfregeln gelten unverändert.
5. **Client** (Patch 60 + Overlay `Nachreichen.tsx`): Während `isSubmitting` sind Enter und ein Knopf „Nachreichen“ neben „Stopp“
   aktiv. Ein Hinweis unter dem Eingabefeld zeigt den Stand: „zugestellt — der Agent sieht es beim nächsten Schritt“ →
   „gelesen“. Kam die Nachricht nicht an (kein Zug mehr oder ungelesen beendet), sendet der Client sie nach dem Zug als normale
   Nachricht.
6. Mock: Streaming-Input, Einfalten an Werkzeuggrenzen, Folgezug nach dem Ergebnis; Szenario `langsam-test`.

### S2 — Themen-Gruppen in der Seitenleiste
1. `web/server/themen.ts`: `themaOf(run)` (Handwert `thema` vor Regeln über Titel → Paket → Ordner), `groupThemen(docs)`.
2. `overview()` liefert zusätzlich `themen: [{ thema, counts, strands }]` (nur offene; Reihenfolge: wartet/gestoppt zuerst).
3. `orch thema <id> <Thema|auto>` (CLI, `/internal/orchestrator/thema`), Werkzeug `orch_thema`, `POST /api/leitstand/thema` (Admin).
4. `HauptchatSection.tsx`: Gruppen je Thema, jede auf-/zuklappbar (Zustand je Thema in `localStorage`; Vorgabe offen, wenn
   etwas wartet oder gestoppt ist), Kopf mit Zahl und erstem Status. Der Hauptchat bleibt oben, darunter die Unter-Chats.

### S3 — Hauptchat überwacht
1. **Ursache 16:40:** `autoOne` zählt nur noch Deckel-Fragen (`kind: 'auto-weiter'`) als Sperre (G8). Jede Entscheidung „nicht
   fortsetzen“ bei technischem Zugende wird am Strang festgehalten (`autoHold {why, at, cause}`) und einmal protokolliert.
2. **Sicherheitsnetz:** `strandEvent` meldet `hängt`, wenn ein technisches Zugende nach `LEITSTAND_HANG_MS` (5 min) nicht
   fortgesetzt ist, mit Ursache und `autoHold.why` (G9).
3. **Neustart:** `orchStatus` → `waiting` „Zug abgebrochen (Brücke neu gestartet) — wird automatisch fortgesetzt“ (G10).
4. **Anweisung an den Hauptchat** (`LEITSTAND_APPEND`): Reaktion je Meldung: hängt → Ursache lesen, `orch_send … weiter`;
   braucht Antwort → selbst klären oder Rückfragen bündeln (`orch_ask`, eine je Strang); fertig/review_ready → kurz
   zusammenfassen; blockiert → Grund prüfen, nächsten Schritt oder Knut fragen.
5. **CLI:** `send` mit Positionstext (G11), Zeitlimit je Befehl (G12).

## 4. Definition of Done
1. Während ein Zug läuft, nimmt der Chat Enter/„Nachreichen“ an. Die Nachricht erreicht den laufenden Agenten beim nächsten
   Werkzeugschritt (Echo → „gelesen“), sichtbar als Zeile in der Antwort. (Test Brücke + Bild/Video)
2. Kommt die Nachricht zu spät für den Zug, läuft sie im selben Lauf als Folgezug. Endet der Zug ohne Zustellung, sendet der
   Client sie danach als normale Nachricht. (Test Brücke: Folgezug, Abbruch → „nicht gelesen“)
3. `BRIDGE_NACHREICHEN=off` → exakt das alte Verhalten (String-Prompt, 409/Hinweis). (Test)
4. Seitenleiste: Unter-Chats nach Thema gruppiert, jede Gruppe aufklappbar, Hauptchat oben. Die heutigen Stränge landen
   richtig (Test mit den echten Titeln/Ordnern), und `orch thema` überschreibt. (Test + Bild)
5. Regressionstest 16:40: Strang mit Zeitlimit und offener Sammel-Rückfrage wird automatisch fortgesetzt; die Deckel-Frage
   sperrt weiter. (Test)
6. Brücken-Neustart → `waiting` und automatisch fortgesetzt. (Test)
7. Technisches Zugende, das nach 5 min nicht fortgesetzt ist → genau eine Meldung `hängt` an den Hauptchat. (Test)
8. `orch send <id> weiter` sendet „weiter“, `--text` + Positionstext → Fehler, `start` wartet bis 15 min. (Test)
9. Brücken- und Web-Tests grün (bekannter Umgebungsfehler „Eigene Claude-Konfiguration je Person“ ausgenommen), Client baut.

## 5. Rückweg
- Brücke: `BRIDGE_NACHREICHEN=off` (Neustart der Brücke) → String-Prompt wie vorher. Web/Client: Release-Zweig zurück auf
  `fix/bridge-idle-timeout` und `scripts/werkbank.sh update` (der Client-Stempel erkennt den alten Patch-Stand und baut neu).
- Themen: rein additiv (`themen` in der Übersicht); ein alter Client ignoriert das Feld.
- Auto-weiter: Rücknahme = Commit S3 zurücknehmen; `ORCH_AUTO_WEITER=off` schaltet ganz ab.

## 7. Council Runde 1 (12.10.2026) — HOLD 0,74

Stimmen: Proponent (für den Plan), Spezialist (gegen den Code), Advocatus diaboli (anderes Modell). Bindende Bedingungen:

1. **[must-fix] Eingabe schließen:** Beim Ergebnis schließen, wenn keine Nachricht mehr ungelesen ist. Immer schließen bei
   Kontingent (`rateLimited`), Abbruch oder spätestens `BRIDGE_NACHREICHEN_GRACE_S` (45 s) nach einem Ergebnis ohne Echo;
   die Nachricht gilt dann als „ungelesen“. Je Versuch ein neuer Posteingang. Beim Kontowechsel nur ungelesene erneut einreihen.
2. **[must-fix] Stand je Nachricht in eigener Map mit Ablaufzeit** (nicht im `Live`, das nach dem Zug verschwindet).
   `GET` nach Zugende liefert den Stand. Der Client sendet nur bei ausdrücklich „ungelesen“ neu, nie bei „unbekannt“.
   Annehmen und Schließen entscheidet derselbe synchrone Abschnitt (nach dem Schließen: abgelehnt, nicht „zugestellt“).
3. **[must-fix] Folgezug:** Echo einer Nachricht nach einem Ergebnis = neuer Folgezug → `outcome` zurücksetzen, der Ausgang
   kommt vom letzten Ergebnis (sonst falsches Auto-„weiter“ nach `error_max_turns`).
4. **[must-fix] Stopp:** Nach „Stopp“ sendet der Client nichts selbst; der Text kommt zurück ins Eingabefeld.
5. **[must-fix] Strang:** Nachreichen an einen laufenden Strang setzt **nicht** `lastSentAt` (sonst „lost“ nach 3 min und ein
   unnötiges „weiter“) und zählt nicht gegen den Deckel; eigenes Feld `lastInjectAt`. Der Anspruch des Auto-„weiter“ prüft
   zusätzlich `lastSentAt` unverändert (kein doppeltes „weiter“, wenn der Hauptchat gleichzeitig schickt).
6. **[must-fix] „hängt“** erst nach der gewollten Wartezeit: `busy` 2 min + Frist, `rate_limit` 30 min + Frist (oder freies
   Konto), sonst Frist. `autoHold` nur nennen, wenn es zum aktuellen Zug gehört.
7. **[must-fix] Brücke selbst sperrt:** kein Nachreichen bei offener ja/nein-Rückfrage, in einen beendeten Hauptchat oder
   mit einer Leitstand-Kennung `#leitstand-…` in der letzten Zeile. Knuts Nachreichen im Hauptchat setzt `lastHand`.
8. **[verify] Mock wie CLI:** Eingabe bleibt nach dem Ergebnis offen; Tests für Kontingent mit offener Nachricht,
   Folgezug nach Schrittlimit, Stopp mit Nachricht, `GET` nach Zugende, Frist ohne Echo.
9. **[must-fix] Plan ehrlich:** Wer im Strang-Chat selbst tippt, umgeht wie bisher `sendOrch` (G0-Stopp, Prüfung) — unverändert,
   steht im Bericht. Ein abgebrochener Strang (`waiting`) belegt seinen Worktree weiter (wie jeder offene Strang).

Notizen (nicht bindend, sichtbar gehalten):
- Advocatus: G8 nimmt die einzige „weiche Bremse“ (offene Frage) weg. Anhalten geht nur noch ausdrücklich: `orch review` bzw.
  „Anhalten“. → Entscheidung bei Knut (Braucht Knut).
- Advocatus: Die CLI wartet bei `start` bis 15 min. Der Hauptchat nutzt `orch_start` (MCP), nicht die CLI. Ein
  Idempotenzschlüssel für `start` wäre die saubere Lösung und ist ein eigener Schnitt.
- Patch 60 greift in LibreChat-Interna (`useTextarea`, `ChatForm`). `librechat-patch.sh` bricht beim Update laut ab, statt
  halb anzuwenden.

## 6. Verlauf
- 12.10.2026 abends: Befund, Plan v1 (dieser Stand), Bau S1–S3 im Strang 154.
