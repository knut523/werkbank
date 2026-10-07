---
titel: Werkbank — Orchestrator-Chat (P2)
stand: 07.10.2026
owner: Knut
zweig: feat/orchestrator-chat (auf feat/werkbank-e5-mobile)
quelle: review-pakete/71-werkbank-auto-multi/plan.md, Abschnitt 4 P2; Entscheidung E4 (2) „P2, dann P3“ (Knut, 07.10.2026)
---

# Orchestrator-Chat

## Ziel

Ein Chat verteilt Arbeit auf mehrere Teilagenten (z. B. „prüfe die 4 PM-Tickets meines Workstreams“) und führt die
Ergebnisse im selben Chat zusammen. Teilagenten sind lesend oder schreiben nur über denselben Wächter wie der Chat.
Keine parallelen Chats, keine Änderung an der Sperre „ein Zug je Person“ (das ist P3).

## Stand heute (feat/werkbank-e5-mobile, 075a7fb)

- Teilagenten gibt es schon: `Task`/`Agent` sind Klasse `read` (`claude-bridge/src/tools.ts:19`), ihre lesenden
  Werkzeuge erscheinen als „↳ …“-Zeile ohne Zuordnung zum Teilagenten (`claude-bridge/src/sessions.ts:321`).
- Text, Denken und Fortschritt der Teilagenten werden verworfen (`sessions.ts:273`, `:297`). Das bleibt so (Befund 77, E).
- Es gibt keine eigenen Rollen: Claude nimmt die eingebauten Agenten (`general-purpose`, `Explore` …), die alle
  Werkzeuge erben. Schreiben geht trotzdem nur über den Wächter (`makeGuard`, `sessions.ts:384`), weil der
  PreToolUse-Hook auch für Werkzeuge der Teilagenten feuert.
- Eine Rückfrage aus einem Teilagenten sieht aus wie eine des Chats (`sessions.ts:411`, `confirmQuestion`); man weiß
  nicht, wer fragt.
- Keine Obergrenze an Teilagenten je Zug; `maxTurns` (40) zählt nur den Haupt-Faden.
- `turn end` loggt Tokens des Zuges (`sessions.ts:643`), aber nicht, wie viele Teilagenten liefen.
- Vorlagen (LibreChat `modelSpecs`, `librechat/librechat.yaml:49`) geben ihre Vorgabe als `promptPrefix` an die Brücke
  (`instructions`). Eine Vorlage „Koordinator“ gibt es nicht.
- SDK 0.3.284: Option `agents: Record<string, AgentDefinition>` (`sdk.d.ts:4465`, Felder `description`, `prompt`, `tools`,
  `disallowedTools`, `model`, `maxTurns`, `permissionMode`). Der Hook bekommt im Teilagenten `agent_id` und
  `agent_type` (`sdk.d.ts:181-187`).

## Scheiben

1. **Rollen + Wächter** (`claude-bridge/src/agents.ts`, `sessions.ts`):
   - `options.agents` mit drei festen Rollen:
     - `leser`: Vault, Dateien, Suche, Jira lesen; kein Schreiben, kein Bash.
     - `ticket-pruefer`: wie `leser`, mit Prüfauftrag je Ticket (Stand, Owner, Fälligkeit, DoD, Hygiene).
     - `schreiber`: darf schreiben, aber jede Änderung fragt wie im Chat.
   - Durchsetzung im Wächter, nicht nur per `disallowedTools`: Ein Aufruf aus `leser`/`ticket-pruefer`
     (`agent_type`), der nicht `read` ist, wird abgelehnt („🔒 Teilagent „leser“ ist nur lesend“).
   - Rückfragen aus einem Teilagenten beginnen mit „**Teilagent „<Rolle>“ möchte:**“; sie laufen über dieselbe
     `confirmChain`, also nacheinander.
   - Obergrenze `BRIDGE_MAX_SUBAGENTS` (Vorgabe 4) Teilagenten-Starts je Zug. Darüber lehnt der Wächter den Start ab
     und sagt Claude, es solle selbst zusammenfassen.
   - Keine verschachtelten Teilagenten (`Task`/`Agent` in `disallowedTools` der Rollen).
2. **Statuszeilen je Teilagent:** „↳ Teilagent <Beschreibung>: 🔎 …“ statt „↳ 🔎 …“, und „↳ Teilagent <Beschreibung>
   fertig“, sobald sein Ergebnis kommt. `turn end` loggt `teilagenten: N`.
3. **Vorlage „Koordinator“** in `librechat/librechat.yaml`: zerlegt den Auftrag, verteilt ihn auf die Rollen (höchstens
   4), fasst in einer Tabelle zusammen und schreibt nichts ohne Rückfrage.
4. **Tests** (Mock): Mock-Szenario `orchestrator-test` mit 3 Teilagenten (zwei `ticket-pruefer`, ein `schreiber`).
   Geprüft wird: gruppierte Zeilen, Zusammenfassung in einem Chat, Schreibversuch eines `leser` abgelehnt, Rückfrage
   des `schreiber` mit Präfix und nach „ja“ weiter, Obergrenze, `teilagenten` im Log.

## DoD

- Ein Testlauf mit 3 Teilagenten ergibt eine Zusammenfassung in einem Chat (Mock-Test).
- Rückfragen erscheinen nacheinander und sind eindeutig einem Teilagenten zuzuordnen (Präfix, Test).
- Lesende Rollen können nicht schreiben, auch nicht mit „ja“ (Test).
- Höchstens `BRIDGE_MAX_SUBAGENTS` Teilagenten je Zug (Test).
- Tokens und Zahl der Teilagenten je Zug stehen im Log (`turn end`).
- Keine Änderung an der Sperre „ein Zug je Person“ (E5-Tests bleiben grün).
- Vorlage „Koordinator“ im Modell-Menü; README-Abschnitt „Orchestrator-Chat“.
- `claude-bridge` `npm test`, `web` `npm test` und `npm run build` grün.

## Risiken

- **Echtes CLI ungeprüft:** Dass `agents` aus dem SDK mit `agent_type` im Hook ankommt und Claude die Rollen tatsächlich
  wählt, zeigt erst ein echter Zug (Mock spielt die Ereignisform laut `sdk.d.ts` nach). Erster echter Test: Vorlage
  „Koordinator“, „prüfe PM-321, PM-322, PM-331“; im Log `turn end … teilagenten: 3`.
- **Kosten:** Jeder Teilagent ist ein eigener Kontext auf dem Abo der Person. Die Obergrenze 4 begrenzt das.
- **Kontext des Orchestrators wächst** mit jedem Ergebnis; die Rollen-Prompts verlangen kurze Ergebnisse.
- **Rückfragen hintereinander:** Fragt ein `schreiber`, warten parallele Teilagenten nicht, aber der Zug endet erst
  nach der Antwort. Das ist wie heute im Chat.
- Eingebaute Agenten (`general-purpose`) bleiben verfügbar und laufen wie bisher über den Wächter, nur ohne Rollen-Sperre.
