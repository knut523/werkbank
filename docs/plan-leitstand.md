# Plan 132 — Leitstand-Chat auf der Brücke

**Status:** Entwurf 11.10.2026, vor Council. **branch:** feat/leitstand (Basis feat/orch-auto-weiter). Lokal, nicht ausgerollt.
> Knut, 11.10.2026 („ok go“): Der Orchestrator — heute eine Claude-Code-CLI-Sitzung im Terminal/IDE — wird ein Werkbank-Chat auf
> der claude-bridge. Grund: zwei Claude-Konten; die Brücke verteilt/failovert schon auf beide, Remote Control ginge nur mit einem.

## 1. Befund (belegt, nicht angenommen)

### 1.1 Was es schon gibt (wird wiederverwendet)
- **Strang-Anmeldung über den internen Kanal**: `registerOrchestration` (`claude-bridge/src/sessions.ts:281`) — die Web-App wählt die
  Unterhaltungs-ID, meldet sie mit Arbeitsordner an, dann entsteht der Chat (`startOrch`, `web/server/orchestrator.ts:220`). Vertrauen
  kommt aus dem Server, nicht aus dem Chat-Inhalt. Genau das braucht der Leitstand auch.
- **Nachricht in einen Chat legen** (`deliver`, `orchestrator.ts:318`, Elternnachricht = letzte gespeicherte) und **Takt über alle
  Stränge** (`autoWeiterTick`, `orchestrator.ts:337`, 20 s, Sperre im Prozess, atomarer Anspruch in Mongo).
- **Orchestrator-API**: `/internal/orchestrator/(start|list|show|send|review)` und `/questions/(ask|list|get|withdraw)`
  (`web/server/main.ts:2043`, `:2061`), CLI `scripts/orch`.
- **Werkbank-MCP** (`web/mcp/werkbank-tools.ts`), von der Brücke je Sitzung mit `WERKBANK_USER_ID`/`WERKBANK_CONV_ID` gestartet
  (`claude-bridge/src/server.ts:35` `mcpServersFor`).
- **Konten**: Lastverteilung/Failover je Zug (`claude-bridge/src/accounts.ts`, `sessions.ts:812–888`).
- **Auto-Fortsetzen** (`feat/orch-auto-weiter`), **Rückfragen-UI** (Heute → „Wartet auf dich“), **Admin-Freigabe** (`web/server/features.ts`).
- **Limits** (`sessions.ts:87–100`): 40 Schritte (`BRIDGE_MAX_TURNS`, Stränge `ORCH_MAX_TURNS`), 900 s je Zug, Idle-Reap 15 min für
  Sitzungen mit offener Rückfrage.

### 1.2 Vorfragen — Ergebnis der Proben (11.10.2026, SDK 0.3.284 der Live-Instanz, Einmal-Prompt wie die Brücke, Modell haiku)
Probe-Skripte: `/tmp/leitstand-probe/probe.mjs`, `compact.mjs` (Protokolle daneben, im Bericht zitiert).

1. **Hintergrundjobs.**
   - `Bash` mit `run_in_background`: Zugergebnis nach 6,0 s, bei 11,2 s `task_notification status: stopped` — **der Job wird mit dem
     Zugende getötet** (Datei `bg-done` nie entstanden) und **weckt die Sitzung nicht**. Deckt sich mit `sdk.d.ts:1789` („one-shot run …
     hold-back tasks are still killed when the held result is released“).
   - `Monitor`: das Gegenteil — **die Abfrage bleibt offen**, jedes Ereignis weckt das Modell und erzeugt ein weiteres `result` im selben
     `query()` (Ergebnisse bei 9,9 / 17,7 / 25,5 / 34,5 s), erst danach endet die Abfrage. In der Brücke heißt das: der Zug (und die
     HTTP-Antwort, die LibreChat offen hält) läuft weiter, bis der Monitor endet oder das Zeitlimit greift; Knuts nächste Nachricht
     bekommt so lange „arbeitet noch“.
   - **Folge:** Der Leitstand darf sich nicht selbst wecken (kein Hintergrund-Bash, kein Monitor-Warten). Das Wecken übernimmt der
     Werkbank-Server mit einer Nachricht (Schnitt 2). `Monitor` wird im Leitstand abgeschaltet.
2. **resume bei langem Kontext.** `/compact` im fortgesetzten Einmal-Zug: `status: compacting` → `compact_boundary` (14 641 → 1 369 Tokens,
   18 s), **gleiche session_id**, nächster `resume` kennt den Inhalt („Leuchtturm-47“). Automatische Verdichtung ist derselbe Weg.
   Bisher hat keine Brücken-Sitzung verdichtet (0 `compact_boundary` in den Strang-Verläufen); die heutige CLI-Hauptsitzung schon 15× bei
   239 MB Verlauf. **Folge:** funktioniert ohne Umbau; die Verdichtung zählt aber gegen das Zeitlimit des Zuges und ist heute
   unsichtbar (die Brücke ignoriert `status`). → Statuszeile „🗜️ Kontext wird verdichtet …“ (alle Chats, eine Zeile Code) und
   Zeitlimit des Leitstands höher.
3. **RAM.** Gemessen (`ps`, 11.10. 20:40): Brücken-Zug = CLI 310 MB + vault-search 87 MB + werkbank-MCP 62 MB ≈ **460 MB, nur solange
   ein Zug läuft** (danach endet der Prozess; nur eine offene Rückfrage hält ihn). Mit compartment (148 MB) ≈ **610 MB im Zug, 0 dazwischen**.
   Heute: CLI-Hauptsitzung dauerhaft 454 MB + compartment 148 MB + bg-Helfer. Der Leitstand spart also RAM.
4. **MCP in Knuts Claude-Code-Konfiguration** (nur gelesen, ohne Werte): `~/.claude.json` → `compartment` (stdio,
   `~/.local/share/uv/tools/compartment/bin/compartment --vault ~/.compartment/memory.vault --caller claude-code serve`, `env: {}`);
   `atlassian` (http). PostHog kommt als **Plugin** `posthog@claude-plugins-official` (`~/.claude/settings.json`), dessen `.mcp.json`:
   `posthog` = http `https://mcp.posthog.com/mcp`, Header `x-posthog-mcp-consumer: plugin`, Anmeldung per OAuth. Die Brücke setzt
   `strictMcpConfig` (`claudehome.ts:90`) — beides ist im Chat heute nicht da. Knut läuft in der Brücke mit der geteilten Konfiguration
   (`BRIDGE_CLAUDE_CONFIG_SHARED`, `scripts/start.sh:51`), d. h. dieselbe `~/.claude`.

## 2. Ziel (Nutzersicht)
Knut hat einen Chat „Leitstand“ in LibreChat (auch am Handy), in dem der Orchestrator arbeitet: Stränge starten, ansehen, Nachrichten
schicken, prüfen, Rückfragen anlegen — als Werkzeuge, nicht per Bash. Meldet ein Strang „fertig“, braucht eine Antwort, hängt oder
beantwortet Knut eine Rückfrage, **erscheint das als Nachricht im Leitstand und weckt ihn**. Er läuft über beide Claude-Konten wie jeder Chat.

## 3. Schnitt

### S1 — Leitstand als eigener Chat-Typ (nur Admin)
- **Anlegen nur über den internen Kanal** (wie ein Strang, nie über eine LibreChat-Vorlage — eine `promptPrefix` kann jede Person
  setzen): `orch leitstand start --handover DATEI` → `/internal/orchestrator/leitstand/start` → Brücke `/internal/orchestrate` mit
  `kind: 'leitstand'` → Chat in Knuts Konto, Titel „Leitstand · TT.MM.“, Lesezeichen „Leitstand“.
- In Mongo ein Eintrag in `orchestrator_runs` mit `kind: 'leitstand'` (so greift Auto-Fortsetzen unverändert); `list`, die
  Ein-Ordner-Regel und „Heute“-Strangzeilen blenden ihn aus. **Höchstens ein aktiver Leitstand je Person**: ein neuer setzt den alten auf
  `reviewedAt` (beendet), sein Link steht im Ergebnis.
- Nur Admin: Brücke nimmt `kind: 'leitstand'` nur für E-Mails aus `LEITSTAND_EMAILS` an (Vorgabe = `BRIDGE_AUTO_EMAILS`); Web nur für
  Personen mit `role === 'ADMIN'`. In `features.ts` eine Funktion `leitstand`, die **nicht** über `WERKBANK_TEAM_FEATURES` freigebbar ist.
- Arbeitsordner: `WERKBANK_LEITSTAND_DIR` (Vorgabe `~/work/knut`), geprüft mit `orchDirProblem`.
- Grenzen in der Brücke: `LEITSTAND_MAX_TURNS` (200), `LEITSTAND_TURN_TIMEOUT_S` (3600); **kein Idle-Reap** (eine offene Rückfrage wartet
  bis `BRIDGE_CONFIRM_TIMEOUT_S`); **zählt nicht gegen `BRIDGE_MAX_PARALLEL_CHATS`** (sonst blockiert er die Stränge, die er startet), dafür
  höchstens ein laufender Leitstand-Zug je Person (folgt aus „ein Leitstand“ + „ein Zug je Unterhaltung“).
- `Monitor` im Leitstand gesperrt (`disallowedTools`), Systemtext sagt warum (Befund 1.2/1).
- Statuszeile bei `status: compacting` (alle Chats).
- „Heute“ (Admin): eine Zeile „🛰️ Leitstand: läuft / wartet / bereit · Link“.

### S2 — Strang-Ereignisse wecken den Leitstand
- Der vorhandene 20-s-Takt bekommt einen zweiten Durchgang `leitstandTick` (eigene Sperre, eigener Schalter `LEITSTAND_WAKE=off`).
- **Ereignisse** (je Strang der Person, Leitstand selbst ausgenommen), jeweils **einmal je Zustand**:
  `fertig` (Status done) · `braucht Antwort` (waiting ohne technische Ursache) · `blockiert/fehlgeschlagen` (failed ohne Ursache, die
  Auto-Fortsetzen behandelt) · `Deckel erreicht` (`autoStopped`) · `review_ready` · **Knut hat eine Rückfrage beantwortet**.
  Technische Zugenden, die Auto-Fortsetzen übernimmt (limit, timeout, lost, busy, rate_limit, interrupted), wecken nicht.
- **Einmaligkeit**: am Strang `leitSeen = <Ereignis-Schlüssel>` (Status + Zug-Kennung + Marke), an der Rückfrage `leitSeenAt`;
  gesetzt atomar beim Einreihen — Neustart und zwei Prozesse melden nichts doppelt.
- **Entprellen**: Ereignisse sammeln sich in `leitstand_events` (Mongo); zugestellt wird **eine** Nachricht mit allen offenen Ereignissen,
  frühestens `LEITSTAND_WAKE_DEBOUNCE_MS` (60 s) nach dem ersten, und nur, wenn der Leitstand **nicht läuft** und seine letzte Antwort
  gespeichert ist (gleiche Regel wie Auto-Fortsetzen, Bedingung 1 aus Plan auto-weiter). Läuft er, bleiben sie liegen bis zum nächsten Takt.
- **Keine Schleifen**: Deckel `LEITSTAND_WAKE_MAX_PER_H` (12) Weckungen je Stunde; darüber bleibt alles liegen und die nächste Nachricht
  sagt „n Ereignisse gesammelt, Weckdeckel erreicht“. Der Leitstand erzeugt selbst keine Ereignisse; eine Weck-Nachricht ist kein
  Ereignis. Ein Strang erzeugt dasselbe Ereignis nie zweimal.
- Form der Nachricht: `🛰️ Leitstand-Meldung (automatisch, n Ereignisse)` + je Ereignis eine Zeile (Strang-ID, Titel, Ereignis, Auszug
  „### Stand“ ≤ 400 Zeichen). Der Leitstand weiß aus seiner Vorgabe: Meldung lesen, handeln oder kurz quittieren, nicht warten.

### S3 — Orchestrator-Befehle als Werkzeuge
- Werkbank-MCP bekommt, **nur wenn die Brücke `WERKBANK_LEITSTAND=1` setzt** (Leitstand-Sitzung), die Werkzeuge
  `orch_start`, `orch_list`, `orch_show`, `orch_send`, `orch_review`, `orch_ask`, `orch_questions` (list/get/withdraw).
  Sie rufen die vorhandenen `/internal/orchestrator/*`-Routen mit `userId` aus der Umgebung (nie aus Argumenten).
- Klassen: alle `read` (ändern nur Werkbank-Zustand; `orch_start` legt einen Chat in Knuts eigenem Konto an — das ist der Zweck).
  **Außerhalb eines Leitstands sind sie `blocked`** (zweite Sicherung, falls die Umgebung falsch wäre). Stränge bekommen sie nie.
- `orch_send` aus dem Leitstand zählt als Handnachricht (wie `orch send` heute; setzt den Deckel des Strangs zurück) — siehe Entscheidung E3.

### S4 — Freigabe-Stufe des Leitstands (nur Knut/Admin)
Auto-Modus „voll“ wie Knuts Chats (Klassifikator), dazu fest im Wächter vor allen Klassen:
| Was | Leitstand |
|---|---|
| Dateien schreiben in `~/work/knut/**` (Worktrees) und im eigenen Scratch | ohne Rückfrage (Klassifikator) |
| Dateien im Vault (`/vault/**`, ohne `.git`) | ohne Rückfrage (Klassifikator) — E1 |
| Dateien sonst (andere Repos, `~/bin`, `~/work/werkbank-dev`, Home) | **Rückfrage** |
| Bash, der die Live-Instanz (`~/work/werkbank-dev`, `werkbank.sh`, `restart`), `crontab`, `~/bin`, `systemctl` berührt | **Rückfrage** |
| `git push`, `gh pr create/comment` … (GitHub schreiben) | **Rückfrage** (wie heute in Knuts Chats) |
| Jira/Confluence schreiben | **Rückfrage** (wie heute) |
| Merge, Force-Push, Push auf main/master/develop | **gesperrt** (wie heute) |
| `git` im Vault (`git -C /vault`, `cd /vault … git`, `/vault/.git`) | **gesperrt** |
| `.claude/`, `.env*`, Git-Hooks/-Konfiguration ändern | **Rückfrage** (Knut kann „ja“ sagen; Stränge: gesperrt) |
Bash-Restrisiko (S0): Muster sind keine Sandbox — `bash -c "$(echo …)"`, Skripte, die selbst pushen, umgehen sie. Zweite Schicht ist der
SDK-Klassifikator mit `AUTO_DENY`; eine dritte (Git ohne Zugangsdaten wie bei Strängen) gibt es im Leitstand bewusst nicht, weil Knut
nach „ja“ pushen können soll. Der Council bewertet das.

### S5 — Gedächtnis (compartment) und PostHog im Leitstand
- Leitstand-Sitzungen bekommen zusätzlich die MCP-Server aus `LEITSTAND_MCP_FILE` (Vorgabe `templates/leitstand/mcp.json`, im Repo, ohne
  Geheimnisse, `~` wird aufgelöst): `compartment` (stdio, wie oben) und `posthog` (http, wie im Plugin). `strictMcpConfig` bleibt an.
- Klassen: compartment `memory_search/get/…` lesen; `memory_store*` geht im Auto-Modus „voll“ an den Klassifikator; PostHog lesende
  Werkzeuge (`get*/list*/…`) frei, sonst Klassifikator. PostHog-OAuth: ob die Anmeldung des Plugins für den gleichnamigen Server gilt,
  zeigt erst der erste echte Zug (sonst einmal `authenticate` im Chat) → „Für Knut zur Nachprüfung“.

### S6 — Übergabe
- Vorlage `docs/leitstand-uebergabe-vorlage.md` (offene Stränge mit IDs, Register-Pfade, Regeln aus `~/.claude/CLAUDE.md`, Stand,
  nächste Schritte). Die Hauptsitzung füllt sie und startet mit `orch leitstand start --handover <datei>`.
- Erste Nachricht = feste Leitstand-Vorgabe (Rolle, Werkzeuge, Weck-Regel, keine Hintergrundjobs/Monitor, Rückfragen per `orch_ask`) +
  Inhalt der Übergabedatei (≤ 40 000 Zeichen).

## 4. Definition of Done (Prüfsätze)
1. `orch leitstand start --handover F` legt in Knuts Konto einen Chat „Leitstand · …“ mit Lesezeichen „Leitstand“ an; die erste Nachricht
   enthält Vorgabe und Übergabetext; ein zweiter Start beendet den ersten (Mock-Ende-zu-Ende).
2. Ein Konto außerhalb `LEITSTAND_EMAILS` bzw. ohne Admin-Rolle bekommt 403; `leitstand` ist über `WERKBANK_TEAM_FEATURES` nicht freigebbar (Test).
3. In einem Leitstand-Zug gilt `maxTurns = LEITSTAND_MAX_TURNS` und das Zeitlimit `LEITSTAND_TURN_TIMEOUT_S`; eine wartende Rückfrage im
   Leitstand wird vom Idle-Reap nicht beendet; ein Leitstand-Zug zählt nicht gegen `BRIDGE_MAX_PARALLEL_CHATS` (Tests).
4. `Monitor` steht im Leitstand in `disallowedTools`; in normalen Chats und Strängen nicht (Test).
5. `status: compacting` erzeugt in jedem Chat die Statuszeile „🗜️ Kontext wird verdichtet …“ (Test mit Mock).
6. Strang wird „fertig“ → spätestens Entprellzeit + 2 Takte danach steht genau **eine** Leitstand-Meldung im Leitstand-Chat, und die
   Brücke startet dafür einen Zug (Mock-Ende-zu-Ende).
7. Drei Ereignisse innerhalb der Entprellzeit → eine Nachricht mit drei Zeilen (Test).
8. Läuft der Leitstand gerade, wird nichts zugestellt; nach seinem Zugende (Antwort gespeichert) kommt die Meldung (Test).
9. Dasselbe Ereignis wird nie zweimal gemeldet — auch nicht nach Neustart der Web-App (Test).
10. Mehr als `LEITSTAND_WAKE_MAX_PER_H` Weckungen in einer Stunde finden nicht statt; danach eine Sammelmeldung (reine Logik).
11. Limit/Timeout eines Strangs (Auto-Fortsetzen) weckt den Leitstand nicht; Deckel erreicht weckt ihn (Test).
12. Knut beantwortet eine Rückfrage in der Werkbank → Leitstand-Meldung „Antwort auf q-… “ (Test).
13. Ohne aktiven Leitstand passiert nichts (keine Nachricht, keine Warteschlange, die später auf einmal kommt — Ereignisse älter als 6 h verfallen).
14. Werkbank-MCP: die `orch_*`-Werkzeuge gibt es nur mit `WERKBANK_LEITSTAND=1`; ein Aufruf liefert dasselbe wie die CLI (Mock-Ende-zu-Ende
    für start/list/send/ask); die Brücke klassifiziert sie außerhalb eines Leitstands als `blocked` (Test).
15. Wächter-Tabelle S4 hat je Zeile einen Test (Rückfrage / frei / gesperrt), inkl. `git -C /vault commit` gesperrt und Merge gesperrt.
16. Leitstand-Sitzungen bekommen `compartment` und `posthog` aus `LEITSTAND_MCP_FILE`; normale Chats und Stränge nicht (Test über `mcpServersFor`).
17. Normale Chats und Stränge verhalten sich unverändert: alle bisherigen Tests beider Pakete grün.
18. `docs/leitstand-uebergabe-vorlage.md` existiert; README-Abschnitt „Leitstand“; `scripts/orch` Hilfe nennt `leitstand start`.
19. „Heute“ (Admin) zeigt die Leitstand-Zeile; Screenshots: Heute mit Leitstand, Leitstand-Chat mit Meldung, Team-Konto ohne Zeile.
20. `claude-bridge npm test`, `web npm test`, `web npm run build` grün auf dem gemeldeten HEAD.

## 5. Einstellungen
| Name | App | Wert / Vorgabe | wer setzt |
|---|---|---|---|
| `LEITSTAND_EMAILS` | Brücke | Vorgabe = `BRIDGE_AUTO_EMAILS` | `scripts/start.sh` (Vorgabe), Knut |
| `LEITSTAND_MAX_TURNS` | Brücke | 200 | Vorgabe im Code |
| `LEITSTAND_TURN_TIMEOUT_S` | Brücke | 3600 | Vorgabe im Code |
| `LEITSTAND_MCP_FILE` | Brücke | `templates/leitstand/mcp.json` | Vorgabe im Code |
| `WERKBANK_LEITSTAND_DIR` | Web | `$HOME/work/knut` | Vorgabe im Code |
| `LEITSTAND_WAKE` | Web | an (`off` = aus) | Not-Aus von Hand |
| `LEITSTAND_WAKE_DEBOUNCE_MS` | Web | 60000 | Vorgabe im Code |
| `LEITSTAND_WAKE_MAX_PER_H` | Web | 12 | Vorgabe im Code |
Kein Infra-Repo: die Werkbank läuft selbst gehostet; Vorgaben stehen im Code bzw. `scripts/start.sh`. Keine neuen Geheimnisse.

## 6. Nicht in diesem Schnitt
- Start-Knopf „Leitstand neu“ in der Werkbank-Oberfläche (heute: Hauptsitzung bzw. CLI startet ihn mit Übergabe).
- Selbstwecken nach Uhrzeit (Cron/Erinnerungen im Leitstand) — nur Ereignisse aus Strängen und Rückfragen.
- Leitstand für andere Personen als Admins; mehrere Leitstände je Person.
- Ausrollen auf die Live-Instanz, Abschalten der CLI-Hauptsitzung, Wächterskript — Knut.
- Push-Benachrichtigung aufs Handy bei einer Meldung (LibreChat zeigt den Chat als ungelesen; mehr nicht).

## 7. Entscheidungen für Knut (mit Empfehlung; bis zur Antwort gilt die Empfehlung im Bau)
- **E1 Vault-Dateien im Leitstand**: ohne Rückfrage (wie heute in Knuts Chats, Registerpflege ist Orchestrator-Arbeit) oder mit Rückfrage.
  Empfehlung: ohne Rückfrage; Vault-**git** gesperrt.
- **E2 Leitstand zählt nicht gegen die Parallelgrenze** (sonst blockieren 4 laufende Stränge den Leitstand und umgekehrt). Empfehlung: ja.
- **E3 `orch_send` aus dem Leitstand setzt den Deckel des Strangs zurück** (wie heute die CLI der Hauptsitzung). Alternative: zählt als
  automatisch. Empfehlung: zurücksetzen wie heute, der Weckdeckel (12/h) begrenzt Schleifen.
- **E4 Weckdeckel 12/h, Entprellen 60 s.** Empfehlung: so starten, nach einer Woche nachschärfen.
