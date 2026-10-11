# Plan — Orchestrator setzt Stränge selbst fort (kein Halt am Schrittlimit)

**Status:** PLAN ONLY (11.10.2026). **branch:** feat/orch-auto-weiter
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
