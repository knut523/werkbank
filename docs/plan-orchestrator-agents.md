---
titel: Werkbank — Orchestrator startet und koordiniert Werkbank-Agenten
stand: 09.10.2026
owner: Knut
zweig: feat/orchestrator (auf origin/dev 259f375)
quelle: Knut, 09.10.2026: „Orchestrator auch direkt bauen … schau, dass du einzelne Agents auf der Werkbank startest und koordinierst (du bist der Orchestrator) … vorher so wie du sagst“
status: Council 09.10.2026 — HOLD (0,78); Bedingungen 1–10 in den Plan übernommen, gebaut auf feat/orchestrator
---

# Orchestrator-Agenten

## Ziel

Die Haupt-Sitzung von Claude Code (Knuts Assistent, läuft als VM-Nutzer) startet einzelne Werkbank-Agenten und
koordiniert sie. Jeder Arbeitsstrang (Werkbank-Scheiben, Flex, Bot, Partner-API, Cockpit …) ist ein **eigener,
normaler Werkbank-Chat in Knuts Konto** — Knut sieht Fortschritt live, kann jederzeit selbst hineinschreiben, und
findet alle Stränge zusammen über das Lesezeichen **„Orchestrator“** in der LibreChat-Leiste.

Kleinster tragfähiger Schnitt: ein lokaler, authentifizierter Einstieg (CLI + interne HTTP-Route, nur 127.0.0.1,
Geheimnis aus der vorhandenen `.env.local`), mit dem der Orchestrator

1. einen Agenten-Chat startet (Titel, Auftrag, Arbeitsordner/Worktree, optional Plandatei),
2. seine Stränge mit Status (läuft / wartet auf Eingabe / fertig / fehlgeschlagen), Auszug der letzten Antwort und
   Zeitstempeln auflistet,
3. eine Folgenachricht in einen Strang schickt,
4. einen Strang als geprüft markiert.

## Stand heute (origin/dev 259f375 = Live-Instanz)

- **Chat im Namen der Person anlegen** gibt es: `createLibreChat(u, text)` (`web/server/agent.ts:115`) signiert ein
  kurzlebiges LibreChat-Zugangstoken (`librechatAccessToken`, `web/server/auth.ts:134`, `JWT_SECRET`) und ruft
  `POST /api/agents/chat/Claude Code` auf. LibreChat fährt den Zug serverseitig (fortsetzbarer Stream), die Brücke
  bekommt `x-librechat-user-id/-conversation-id/-user-email` (`librechat/librechat.yaml:170`).
- Genutzt von „Agent ansetzen“ am Board (`startChatAgent`, `agent.ts:153`), Läufe in `werkbank.agent_runs`,
  Status aus der Brücke über `GET /sessions?user=` (`claude-bridge/src/server.ts:299`, `sessionsOf`,
  `sessions.ts:174`: läuft / wartet auf ja / bereit) — `refreshChatRuns` (`agent.ts:166`).
- **Interner Kanal**: Header `x-werkbank-internal` = `WERKBANK_INTERNAL_TOKEN` (aus `.env.local`, erzeugt von
  `scripts/setup.sh`), geprüft in `internalUser` (`web/server/main.ts:1727`, timingSafeEqual + Freigabeliste).
  Web und Brücke lauschen nur auf 127.0.0.1; der LibreChat-Proxy reicht `/werkbank/internal/*` nie durch (README).
- **Arbeitsordner**: `workDirFor(userId, convId)` (`sessions.ts:202`) — jeder neue Chat bekommt
  `scratch/<person>/chats/<chat>`, festgehalten in `cwd.json` (`sessions.ts:137`). Einen Repo-Worktree als `cwd`
  gibt es nicht.
- **Rechte**: Wächter `makeGuard` (`sessions.ts:455`) mit Klassen read / confirm / blocked / auto
  (`claude-bridge/src/tools.ts:113`). Merge, Force-Push, Push auf main/master/develop: gesperrt. Sonstiges GitHub-
  Schreiben (`git push`, `gh pr create` …, `tools.ts:38`) und Jira-Schreiben (Atlassian-MCP, `jira_update`, Bash
  gegen Atlassian): **Rückfrage „ja“** — ein „ja“ im Chat würde also pushen bzw. Jira schreiben. Auto-Modus „voll“
  für Knut (`scripts/start.sh`): Bash/Edits entscheidet der Klassifikator.
- **Grenzen**: Brücke `BRIDGE_MAX_PARALLEL_CHATS` (3) laufende Züge je Person; LibreChat `CONCURRENT_MESSAGE_MAX=2`
  (`librechat/.env:43`) gleichzeitige Generierungen je Konto (gezählt bis Zugende,
  `api/server/controllers/agents/request.js:207`); Zug max. 40 Schritte, 15 min (`sessions.ts:79–81`).
- **Filter in der UI**: LibreChat hat Lesezeichen (`interface.bookmarks: true`), `PUT /api/tags/convo/:id` setzt
  Tags einer Unterhaltung und legt das Lesezeichen bei Bedarf an (`conversationTag.ts:387`).
- Tagesabschluss-Zweig (`werkbank-tagesabschluss`, nicht committet, alter Stand): Werkzeug `agent_start` +
  `/internal/agent-start` startet Board-Agenten auf Tickets aus dem Chat — ticketgebunden, für einen anderen Zweck;
  wird hier **nicht** übernommen.

## Council (09.10.2026) — Urteil

Vier getrennte Durchgänge: Befürworter, Fachprüfer (Technik/Sicherheit, gegen Code und LibreChat v0.8.7 geprüft),
Advocatus Diaboli, Finalizer. Die beiden schwersten Einwände im Code bzw. auf der VM nachgeprüft:

- `~/.gitconfig` setzt `credential.https://github.com.helper=/home/knut/bin/git-credential-vaultwarden`; der Helfer
  liest die Vaultwarden-Sitzung von der Platte. Das Entfernen von `*TOKEN*`-Variablen (`sessions.ts:640`) hilft
  dagegen nicht — **jeder Push, der am Muster vorbeigeht (`git -C x push`, Alias, Skript), hätte Zugangsdaten**.
- LibreChat übernimmt eine vom Aufrufer gewählte `conversationId` für eine neue Unterhaltung
  (`request.js:216–217`, `convoAccess.js`: unbekannte Unterhaltung → weiter). Damit ist die Hash-Zuordnung unnötig.

```
VERDICT: HOLD (confidence 0.78)
WHY: Die Richtung (Strang = normaler Chat, interner Kanal, Lesezeichen) trägt und nutzt Vorhandenes, aber in der
     Entwurfsform fällt die Push/Jira-Sperre bei jeder gescheiterten Zuordnung offen aus, Push hat über den
     Credential-Helfer echte Zugangsdaten, und das „ja“ des Orchestrators in Knuts Namen ist unbegrenzt.
```

### Verbindliche Bedingungen (alle umgesetzt, siehe „Änderungen je Datei“)

1. **[must-fix] Zuordnung über die Unterhaltungs-ID, nicht über einen Hash.** Die Web-App wählt die
   `conversationId` (UUID), meldet `{userId, conv, dir}` über den internen Kanal bei der Brücke an und legt erst
   danach den Chat mit genau dieser ID an. Schlägt die Anmeldung fehl, wird kein Chat angelegt (fail closed).
   Die Zuordnung ist dauerhaft (`orch.json`), kein Zeitfenster, wird durch abgewiesene Züge nicht verbraucht.
2. **[must-fix] Keine Rückfragen in Strängen.** Alles, was im Chat „ja“ bräuchte (Klasse `confirm`, Eskalation des
   Auto-Modus), wird in einem Strang abgelehnt und dem Agenten gesagt, es unter „### Stand → braucht Knut“
   aufzuschreiben. Damit gibt es kein „ja“ des Orchestrators in Knuts Namen, keine verfallenden Rückfragen
   (`MAX_WAITING`, 30-min-Timeout) und kein Kapern einer Rückfrage durch `send`.
3. **[must-fix] Sperre vor allen Klassen** (`orchestratorBlock`): GitHub-Schreiben mit breiterem Muster
   (`git … push` auch mit `-C`/`-c`, `send-pack`, `curl … api.github.com` mit Daten), Atlassian-MCP alles außer
   lesend, `werkbank__jira_update*`, Bash-Schreiben an Atlassian, Schreiben unter `.git/`, `.claude/`, `.env*`,
   `git config` (schreibend), `core.hooksPath`.
4. **[must-fix] Push ohne Zugangsdaten.** Strang-Sitzungen bekommen `GIT_CONFIG_GLOBAL` = eigene Datei (nur
   `user.name/email`, leerer `credential.helper`, `pushInsteadOf` auf eine ungültige Adresse für github.com),
   `GIT_CONFIG_NOSYSTEM=1`, `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS`/`SSH_ASKPASS=/bin/false`. Ehrlich dokumentieren:
   wer die Umgebung im Befehl explizit überschreibt, kommt am Git-Teil vorbei; dann bleiben Muster und Klassifikator.
5. **[must-fix] Ausdrücklicher Zustand statt Textraten.** Die Brücke führt je Strang `turn {start, end, outcome}`
   (`ok | limit | timeout | error | rate_limit | busy | aborted`) persistent; ein Zug mit Start ohne Ende und ohne
   laufende Sitzung = `interrupted` (Brücke neu gestartet). Nur bei `ok` entscheidet die Status-Marke im Text.
6. **[must-fix] LibreChat-Nachrichten richtig lesen:** Antworttext aus `content[]` (`type: text`), `text` nur als
   Rückfall; Elternnachricht = neueste nach `createdAt`; 409 „parent still being saved“ → kurz wiederholen;
   429 → Fehler „Parallelgrenze (LibreChat)“.
7. **[must-fix] Pfadprüfung auf beiden Seiten** mit `realpath`: unter `WERKBANK_ORCH_ROOTS` (Vorgabe `$HOME/work`),
   nicht die Wurzel selbst, nicht der Vault, nicht `.runtime`; neue Route mit `timingSafeEqual`.
8. **[must-fix] Ein Worktree, ein offener Strang:** `start` lehnt einen Ordner ab, in dem schon ein nicht geprüfter
   Strang läuft/wartet (409), außer mit `--shared`.
9. **[must-fix] Titel und Lesezeichen setzen, ohne Fremdes zu überschreiben:** Titel über `POST /api/convos/update`
   (LibreChat erzeugt bei vorgegebener ID keinen Titel), Tags lesen und zusammenführen, dann `PUT /api/tags/convo`;
   Fehler hier stehen im Ergebnis, brechen den Strang nicht ab.
10. **[verify] E2E auf der isolierten Instanz** mit echtem Claude: Ordner greift, Status läuft → fertig,
    Folgenachricht setzt dieselbe Sitzung fort, ein `git push` im Strang ist gesperrt.

NOTES (stärkster Einwand, bleibt sichtbar): Muster sind keine Sandbox. Ein Agent mit Bash im Auto-Modus „voll“ kann
mit genug Absicht jede Mustersperre umgehen (Skript schreiben und ausführen, Umgebung überschreiben). Die Sperre
hält Versehen und naheliegende Wege auf; die harte Grenze wäre ein eigener Unix-Nutzer ohne Zugangsdaten (Option C,
`plan-parallele-chats.md`) — bewusst nicht in diesem Schnitt. Außerdem teilen alle Stränge Knuts Claude-
Konfiguration (`BRIDGE_CLAUDE_CONFIG_SHARED`), wie heute schon parallele Chats.

## Änderungen je Datei (so gebaut, nach dem Council)

### claude-bridge

- `src/tools.ts`: `orchestratorBlock(tool, input)` (Bedingung 3) — `BASH_BLOCKED` + `BASH_GITHUB_WRITE` + eigene Muster
  (`git [-C x|-c k=v …] push|send-pack`, `alias.*`, `git config` schreibend, `core.hooksPath`, `.git/hooks|config`,
  `gh pr|issue|api|…` außer view/list/diff/status/checks, `api.github.com`, Atlassian-Hosts), Datei-Werkzeuge unter
  `.git/`, `.claude/`, `.env*`, Atlassian-MCP außer lesend, `werkbank__jira_*`, GitHub-MCP schreibend.
  `orchDirProblem(dir)` + `orchRoots()` (Bedingung 7).
- `src/sessions.ts`: `orch.json` (Unterhaltung → `{dir, since, turn}`), `registerOrchestration` (nur neue
  Unterhaltungen: kein Sitzungs-, Ordner- oder Strang-Eintrag, nicht laufend → sonst 409), `orchStateOf`
  (läuft / letzter Zug mit Ausgang / `interrupted`), `orchGitEnv` (Bedingung 4), `ORCH_APPEND` im System-Prompt.
  Wächter: in Strängen zuerst `orchestratorBlock` (⛔), und statt jeder Rückfrage ein Ablehnen (🔒, Bedingung 2).
  Ausgang je Zug: `ok | limit | timeout | error | rate_limit | busy | aborted` (Bedingung 5).
- `src/server.ts`: `POST /internal/orchestrate` und `GET /internal/orch-state` (interner Schlüssel mit
  `timingSafeEqual`, Freigabeliste, UUID-Pflicht, Ordnerprüfung).
- `src/mock.ts`: `mock-antwort <Text>` (genaue Antwort, für Status-Marken in Tests).

### web

- `server/orchestrator.ts` (neu): `orchBrief`, `orchStatus` (rein), `messageText` (content[]-Teile), `statusMark`,
  `excerpt`, `decorate` (Titel + Lesezeichen zusammenführend, idempotent, selbstheilend in `list`, Bedingung 9),
  `startOrch` (Bedingung 1 und 8), `listOrch`, `showOrch`, `sendOrch` (Bedingung 6), `reviewOrch`; Rückfragen:
  `askKnut`, `listQuestions`, `getQuestion`, `answerQuestion`, `withdrawQuestion`.
- `server/agent.ts`: `createLibreChat(u, text, { conversationId, parentMessageId })`; 429/409 mit klarer Meldung.
- `server/main.ts`: `POST /internal/orchestrator/{start,list,show,send,review}`,
  `POST /internal/orchestrator/questions/{ask,list,get,withdraw}` (Person = `userId` oder `email`, Vorgabe Pilot-Konto),
  `GET /api/orchestrator/questions[?count=1]`, `POST /api/orchestrator/questions/:id/answer` (Sitzung + CSRF-Header).
- `server/db.ts`: Indizes `orchestrator_runs`, `orchestrator_questions`.
- `server/orch-cli.ts` (neu) + `scripts/orch`: CLI; liest nur `WERKBANK_INTERNAL_TOKEN` (Umgebung oder
  `WERKBANK_ENV_FILE`), nur lokale Ziel-URL.
- `src/pages/Roadmap.tsx`: Karte „Rückfragen des Orchestrators“ über „Für mich offen“ (Optionen mit Folgen, Empfehlung,
  Freitext, Link zum Strang; live über den vorhandenen Server-Event-Kanal). `src/App.tsx`: Zähler an „Roadmap“.

### Rückfragen an Knut (Zusatz Knut, 09.10.2026)

„Wenn du Fragen hast, kannst du mir über die Werkbank eine Notification senden — für alle Dinge, wo du wirklich Input
brauchst.“ Wiederverwendet: der Ort „Für mich offen“ auf der Roadmap-Seite und deren Live-Kanal (`roadmapChanged` →
SSE `github`). Eigene Sammlung `orchestrator_questions` statt des Vault-Sync-Protokolls, weil die Fragen nicht aus dem
Vault kommen und die Antworten der Orchestrator liest, nicht der Vault-Sync. Regel (CLI-Hilfe, README, Bericht): nur
echte Entscheidungen Knuts, immer mit eigener Empfehlung (`--recommend` ist Pflicht).

### sonst

- `librechat/.env`: `CONCURRENT_MESSAGE_MAX=5` (greift erst nach Neustart der Live-Instanz — Knuts OK).
- `scripts/isoliert.sh` (neu): zweite Werkbank aus diesem Checkout (Web 3170, LibreChat 3180, Brücke 3190, Mongo 27180,
  Meili 7790), alles unter `.runtime-iso/`; Vault-Sync-Verzeichnis, Meili-Index und Roadmap-Feed eigen.
- README: Abschnitt „Orchestrator-Agenten (CLI)“.

## Definition of Done

1. [x] `scripts/orch start --title … --cwd <worktree> [--plan <datei>] --prompt …` legt in Knuts Konto einen Chat
   „Orchestrator · <Titel>“ mit Lesezeichen „Orchestrator“ an; die Brücke arbeitet in `<worktree>` — `web/test/orchestrator.test.ts`, `claude-bridge/test/orchestrator-agents.test.ts`, E2E isoliert.
2. [x] `scripts/orch list` zeigt Status (running/waiting/done/failed + Grund), Auszug, gestartet/zuletzt — `orchStatus`-Test je Fall, E2E.
3. [x] `scripts/orch send <id> …` landet als Folgenachricht im selben Chat und setzt die Sitzung fort (`resume: true`) — Test + E2E.
4. [x] `scripts/orch review <id>` markiert geprüft; `list` blendet geprüfte aus, `--all` zeigt sie — Test + E2E.
5. [x] Im Strang sind `git push` (auch `git -C … push`), `gh pr create`, Atlassian-/Jira-Schreiben gesperrt, auch ohne Rückfrage-Weg; normale Chats unverändert — Tests; E2E: echter Claude-Zug, Push gesperrt; Git-Umgebung leitet Push ins Leere.
6. [x] Ohne/mit falschem internen Schlüssel 403; Ordner außerhalb der Wurzeln / nicht vorhanden / Plandatei fehlt: 400; ein Worktree, ein offener Strang (409) — Tests.
7. [x] Rückfragen: `orch ask` → Karte in der Werkbank mit Zähler → Antwort (Option/Freitext) → `orch questions get` — Test + E2E mit Screenshots.
8. [x] Brücke `npm test` 69/69; Web `npm test` 136/137 — der eine Fehler („Pflegefragen nur zu Tagesbeginn“) schlägt auf origin/dev genauso fehl (uhrzeitabhängig); `vite build` grün.
9. [x] E2E auf der isolierten Instanz, Live-Instanz unberührt; Bericht `review-pakete/107-werkbank-orchestrator/bericht.md`; Commit lokal auf `feat/orchestrator`, kein Push.

## Risiken

- **Vorgegebene Unterhaltungs-ID**: LibreChat erzeugt dann keinen Titel (deshalb setzt die Web-App ihn selbst); ändert
  ein LibreChat-Update dieses Verhalten (`request.js:216`), scheitert der Start sichtbar (kein stilles Weiterlaufen).
- **Parallelgrenzen**: LibreChat 2 (→ 5) und Brücke 3 laufende Züge. Ein abgewiesener Start wird `failed` mit Grund
  „Parallelgrenze“; der Orchestrator schickt später `send <id> weiter`.
- **Lange Stränge**: 40 Schritte / 15 min je Zug → `waiting` mit Grund „Limit, `send <id> weiter`“. Bewusst nicht
  automatisch fortgesetzt (Kosten, Kontrolle).
- **Keine Rückfragen im Strang**: was im normalen Chat ein „ja“ bräuchte, scheitert im Strang (bewusst). Ohne
  Auto-Modus kann ein Strang deshalb nur lesen; `start` meldet den Modus und warnt.
- **Gleiche Dateien**: ein offener Strang je Worktree ist erzwungen (409); `--shared` hebt das bewusst auf.
- **Geteilte Claude-Konfiguration**: alle Stränge laufen mit Knuts `~/.claude` (wie heute parallele Chats);
  gleichzeitige Schreibzugriffe auf `.claude.json` sind ein bekanntes Restrisiko.
- **Klassifikator ≠ Sperre**: Die Sperre greift über Muster (Bash) und Werkzeugnamen; ein Agent, der z. B. ein Skript
  schreibt, das pusht, und es dann ausführt, umgeht das Muster. Zweite Schicht: die Git-Umgebung ohne
  Credential-Helfer mit umgeleitetem Push (wirkt auch für Skripte, solange sie die Umgebung nicht selbst
  überschreiben), dritte: der Auto-Klassifikator. Keine Sandbox — ehrlich im Bericht.

## Bewusst nicht

- Kein Werkzeug `agent_start` im Chat (Werkbank-Agent startet Agenten) — der Orchestrator ist die Haupt-Sitzung.
- Keine eigene Werkbank-Seite für Stränge (das Lesezeichen reicht für den ersten Schnitt); keine Review-Schlange
  („Heute“, eigener Zweig).
- Keine automatische Fortsetzung bei Limits, keine Kette Strang → Strang.
- Kein Umbau der Live-Instanz; Umstellung nur mit Knuts OK (Bericht beschreibt die Schritte).
- Kein eigener Unix-Nutzer/Sandbox je Strang (Option C aus `plan-parallele-chats.md`).
- Kein Zähler in LibreChats eigener Leiste (bräuchte einen Overlay-Patch und einen Neubau des LibreChat-Clients); der
  Zähler steht in der Werkbank-Navigation und auf der Karte, die auch eingebettet unter `/wb/roadmap` erscheint.
- Keine Benachrichtigung nach außen (Mail, Push aufs Handy).

## Nachtrag: Profil `release` (Plan 213, Knut 17.10.2026)

Ein Release-Strang darf lokal mergen. In jedem anderen Strang bleibt Mergen gesperrt.

- **Start:** `orch start --profil release` mit einem Arbeitsordner, der ein **eigener Git-Worktree** (`git worktree add`)
  eines Werkbank-Repos ist (`origin` enthält „werkbank“). Haupt-Checkout, fremde Repos und die Live-Instanz lehnt die Brücke
  schon bei der Anmeldung ab (`releaseWorktreeProblem`, 400).
- **Erlaubt:** genau `git -C <Arbeitsordner> merge …` (auch `--abort`/`--continue`), als einzelner Befehl ohne `&&`, `;`,
  Pipe oder Befehlsersetzung (`releaseMerge`). Der Ordner muss im Befehl stehen, weil die Brücke das cwd der Shell nicht
  kennt. Konflikte löst der Strang mit Edit im Worktree; der Merge-Commit ist ein normaler lokaler Commit.
- **Weiter gesperrt:**
  - Push und alles, was nach GitHub schreibt;
  - Mergen ohne `-C` oder mit einem anderen Ordner;
  - zusätzlich alles, was live schaltet: `werkbank.sh`, Live-Instanz, `release-live-*.sh`, `systemctl`, `crontab`
    (`RELEASE_BLOCK`).
- **Sonst wie `voll`:** alle MCP-Server, Phasenmodell. Tests: `claude-bridge/test/release.test.ts`.
