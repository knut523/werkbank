# Plan — Orchestrator setzt Stränge selbst fort (kein Halt am Schrittlimit)

**Status:** GEBAUT lokal (11.10.2026), Council R2 PASS, nicht ausgerollt. **branch:** feat/orch-auto-weiter
> Knut, 11.10.2026: „du hast max schrittlimits … check mal mit dem orchestrator dass sollte nicht passieren"

## Befund
- Jeder Zug endet nach `BRIDGE_MAX_TURNS` (Standard 40, `claude-bridge/src/sessions.ts:89`); der Strang bleibt dann
  `waiting` mit „Schrittlimit des Zuges erreicht — `send <id> weiter`" (`web/server/orchestrator.ts:92`). Ebenso Zeitlimit (15 min),
  Parallelgrenze, Brücken-Neustart, Kontingent. Fortgesetzt wird nur, wenn jemand `send weiter` schickt.
- Überbrückung seit 11.10. 18:40: Wächterskript in der Hauptsitzung (`orch-autoweiter-live.sh`, Job-Scratch) — hängt an einer laufenden Sitzung.

## Schnitt
1. Werkbank-Server: Für **orchestrierte** Stränge (nicht für normale Chats) sendet der Server bei `limit`, `timeout`, `interrupted`,
   „Nachricht nicht angekommen“ und `busy` automatisch „weiter“ (busy: nach 2 min erneut). Kontingent (`rate_limit`): erneut nach 30 min
   bzw. sobald ein anderes Konto frei ist (Lastverteilung).
2. Deckel je Strang: `ORCH_AUTO_WEITER_MAX` (Standard 30). Danach `failed` mit Grund „30× automatisch fortgesetzt — Chat ansehen“ und eine
   Meldung in „Heute“.
3. Kein „weiter“, wenn der Strang auf eine Rückfrage (`orch ask`) wartet, `review_ready` gemeldet hat oder geprüft ist.
4. `orch list`/„Heute“ zeigen „automatisch fortgesetzt (n)“.
5. Optional: Schrittlimit für orchestrierte Stränge höher (`ORCH_MAX_TURNS`, z. B. 150) — weniger Zug-Wechsel.
6. Danach Wächterskript abschalten.

## Definition of Done
1. Strang endet mit `limit` → innerhalb 60 s neuer Zug ohne Zutun (Test mit Mock-Brücke).
2. `timeout`, `interrupted`, `busy` werden fortgesetzt; `rate_limit` frühestens nach 30 min oder bei freiem zweiten Konto.
3. Nach `ORCH_AUTO_WEITER_MAX` Fortsetzungen: `failed` mit Grund + Eintrag in „Heute“, keine weitere Fortsetzung.
4. Wartende Rückfrage, `review_ready` und geprüfte Stränge werden nie automatisch fortgesetzt.
5. Normale (nicht orchestrierte) Chats bleiben unverändert.
6. Zähler sichtbar in `orch list` und „Heute“.
7. Server-Neustart verliert den Zähler nicht (in Mongo am Strang).

## Umsetzung (Entwurf 11.10.2026, vor Council)
- **Wo:** `web/server/orchestrator.ts`. `orchStatus` liefert zusätzlich `cause` (`limit` · `timeout` · `interrupted` · `lost` ·
  `busy` · `rate_limit`). Reine Entscheidung `autoWeiter(run, st, ctx)` → `send` | `stop` | `wait` | `none` (testbar ohne Uhr).
- **Takt:** `startAutoWeiter()` aus `main.ts`, eigener Timer (auch bei `WERKBANK_NO_JOBS=1`), alle 20 s
  (`ORCH_AUTO_WEITER_TICK_MS`), aus mit `ORCH_AUTO_WEITER=off`. Liest nur `orchestrator_runs` → normale Chats bleiben unberührt (DoD 5).
- **Wann:** `limit`/`timeout`/`interrupted`/`lost` sofort, sobald die Antwort gespeichert ist (spätestens 30 s nach Zugende; mit dem 20-s-Takt also ≤ 50 s);
  `busy` 2 min nach dem Zugende; `rate_limit` 30 min nach dem Zugende oder früher, wenn die Person ≥ 2 Claude-Konten hat und
  laut Brücke eins frei ist.
- **Nie:** `reviewedAt` (geprüft), `reviewReadyAt` (review_ready gemeldet — dafür setzt `/internal/review-ready` die Marke jetzt
  auch an einem Orchestrator-Strang), offene Rückfrage mit `strand = id`, `autoStopped`.
- **Kein Doppel-Senden:** atomarer Anspruch `autoFor = <Zug-Kennung>` in Mongo (Zugbeginn bzw. `lastSentAt` bei `lost`); nach
  Neustart oder mit zwei Servern wird derselbe Zug nie zweimal fortgesetzt. Schlägt das Senden fehl, wird der Anspruch
  zurückgenommen (nächster Takt versucht es erneut), der Zähler steigt nicht.
- **Zähler (DoD 6/7):** am Strang in Mongo: `autoTotal` (angezeigt), `autoStreak` (für den Deckel, eine Handnachricht über
  `orch send` setzt ihn auf 0), `autoLastAt`, `autoLastCause`.
- **Deckel (DoD 3):** fällig, aber `autoStreak ≥ ORCH_AUTO_WEITER_MAX` (30) → `autoStopped` setzen (Status `failed`, Grund
  „30× automatisch fortgesetzt — Chat ansehen“) und eine Rückfrage `kind: auto-weiter` anlegen — sie steht in „Heute“ unter
  „Wartet auf dich“ und zählt in „Heute (n)“. Optionen „Fortsetzen“ (schickt „weiter“, Zähler neu) und „Anhalten“ (Strang geprüft).
- **Sichtbar (DoD 6):** `orch list` hängt „· automatisch fortgesetzt (n)“ an; `/api/today` liefert `orchAuto` (offene Stränge mit
  n > 0), „Heute“ zeigt eine Zeile dazu.
- **Schnitt 5:** `ORCH_MAX_TURNS` in der Brücke für orchestrierte Züge; ohne Variable unverändert `BRIDGE_MAX_TURNS`.
- **Schnitt 6** (Wächterskript abschalten) betrifft die Live-Sitzung → Knut, nicht dieser Branch.

## Council R1 (11.10.2026) — HOLD (0,7)
Gegenstimme, stärkste Punkte: (a) „weiter“ geht raus, bevor LibreChat die Antwort des Limit-Zuges gespeichert hat → Elternnachricht
falsch, der Chat verzweigt; (b) Absturz zwischen Anspruch und Senden → der Zug ist „beansprucht“, aber nie fortgesetzt — hängt für
immer; (c) zwei Takte überlappen (langsames LibreChat) → doppelte Arbeit; (d) eine Handnachricht setzt den Deckel zurück — das alte
Wächterskript (sendet per `orch send`) würde ihn aushebeln; (e) `busy` zählt auf den Deckel: bei voller Brücke scheitert ein Strang
nach 30 × 2 min, ohne einen Token verbraucht zu haben.
Bindende Bedingungen:
1. [must-fix] Fortsetzen nach `limit`/`timeout` erst, wenn die letzte gespeicherte Nachricht eine Antwort ist, die nach dem Zugbeginn
   entstand — oder 30 s nach Zugende (dann ohne Antwort; mit Takt ≤ 50 s < 60 s aus DoD 1). Test: reine Logik.
2. [must-fix] Der Anspruch setzt `lastSentAt` gleich mit (vor dem Senden). Kommt die Nachricht nie an, wird der Strang nach 3 min
   `lost` und wieder fortgesetzt — kein Hängenbleiben, jeder Versuch zählt auf den Deckel.
3. [must-fix] Ein Takt läuft nie doppelt (Sperre im Prozess); zwischen Prozessen schützt der atomare Anspruch.
4. [must-fix] Handnachricht (`orch send`, Antwort „Fortsetzen“): `autoStreak = 0`, `autoStopped` weg, offene `auto-weiter`-Rückfrage
   zurückgezogen, `reviewReadyAt` weg. Bericht nennt: Wächterskript vor dem Ausrollen abschalten (sonst setzt es den Deckel zurück).
5. [verify] `busy` zählt auf den Deckel (eine Regel, kein Sonderfall); im Bericht als Entscheidung für Knut mit Empfehlung.
6. [verify] Mock-Ende-zu-Ende: limit → neuer Zug ≤ 60 s; Deckel → `failed` + Rückfrage, keine weitere Fortsetzung; offene Rückfrage
   blockiert; normaler Chat mit `limit` bleibt unberührt; Neustart der Web-App behält den Zähler und sendet nicht doppelt.

## Council R2 (11.10.2026, gegen den gebauten Stand) — PASS (0,8)
- B1 erfüllt: `autoWeiter` wartet auf die gespeicherte Antwort (höchstens `AUTO_SAVE_MS` = 30 s); Ende-zu-Ende prüft die
  Elternnachricht („weiter“ hängt an der Limit-Antwort).
- B2 erfüllt: der Anspruch setzt `lastSentAt`; reine Tests für `lost` und für „abgebrochen, danach gesendet“.
- B3 erfüllt: `ticking`-Sperre im Prozess, atomarer Anspruch `autoFor` in Mongo; Neustart-Test sendet nicht doppelt.
- B4 erfüllt: `sendOrch` setzt `autoStreak`, `autoStopped` und `reviewReadyAt` zurück und zieht offene `auto-weiter`-Rückfragen
  zurück; das Wächterskript steht im Bericht unter „Braucht Knut“.
- B5 erfüllt: `busy` zählt auf den Deckel — Entscheidung für Knut im Bericht.
- B6 erfüllt: fünf Ende-zu-Ende-Tests mit Mock-Brücke (DoD 1, 3+6, 4, 5, 7).
- Neu aus dem Review-Pass, eingebaut: Zugenden, die länger als 6 h zurückliegen (`AUTO_STALE_MS`), werden nie automatisch
  fortgesetzt — sonst setzt der erste Takt nach dem Ausrollen alle alten, ungeprüften Limit-Stränge auf einmal fort.
Bedingungen für das Ausrollen (nicht in diesem Branch): Wächterskript `orch-autoweiter-live.sh` vor dem Neustart der Live-Web-App
abschalten (Schnitt 6); `ORCH_MAX_TURNS` erst nach Knuts Entscheidung setzen.

## DoD-Stand (Branch feat/orch-auto-weiter, lokal)
- [x] 1. `limit` → neuer Zug ohne Zutun, ≤ 60 s (Takt 20 s + höchstens 30 s Speicher-Wartezeit) — `test/orchestrator.test.ts` „Auto-weiter DoD 1“.
- [x] 2. `timeout`, `interrupted`, `busy` (nach 2 min) fortgesetzt; `rate_limit` frühestens nach 30 min oder bei freiem zweiten Konto — reine Tests.
- [x] 3. Nach `ORCH_AUTO_WEITER_MAX`: `failed` + Grund + Rückfrage in „Heute“, keine weitere Fortsetzung — Ende-zu-Ende.
- [x] 4. Offene Rückfrage, `review_ready`, geprüft → nie — rein + Ende-zu-Ende (Rückfrage, review_ready am Strang).
- [x] 5. Normale Chats unverändert — Ende-zu-Ende (Limit im normalen Chat, keine Nachricht der Werkbank).
- [x] 6. Zähler in `orch list` („automatisch fortgesetzt (n)“) und „Heute“ (`/api/today` → `orchAuto`, Zeile auf der Seite).
- [x] 7. Zähler in Mongo am Strang (`autoTotal`, `autoStreak`, `autoFor`) — Neustart-Test.
