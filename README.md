# OLAF-Werkbank

Chat-Oberfläche fürs Team (LibreChat), hinter der **Claude Code** arbeitet — mit unseren Skills,
dem Obsidian-Vault und Jira, **unter dem eigenen Claude-Konto jeder Person, ohne API-Schlüssel**.
Plan und Entscheidungen: [`PLAN.md`](PLAN.md). Dieser Stand ist **Phase 1 „Pilot Chat“**.

```
Browser ─► LibreChat :3080 ── Endpunkt „Claude Code“ (Schlüssel = eigener Claude-Token)
                │
                ▼
           claude-bridge :3090 (OpenAI-kompatibel, streamt)
                │  CLAUDE_CODE_OAUTH_TOKEN je Anfrage
                ▼
           Claude Agent SDK ── Skills (~/.claude/skills), CLAUDE.md, Vault /vault, Jira-MCP
```

## Dienste und Ports

Alles läuft nativ (kein Docker) und lauscht nur auf `127.0.0.1`.

| Dienst | Port | Woher |
|---|---|---|
| LibreChat | 3080 | `danny-avila/LibreChat` **v0.8.7**, gebaut unter `.runtime/librechat` |
| claude-bridge | 3090 | `claude-bridge/` (dieses Repo), `@anthropic-ai/claude-agent-sdk` 0.3.284 |
| MongoDB | 27017 | Binärdatei 8.0.20 unter `.runtime/bin` |
| Meilisearch | 7700 | Binärdatei v1.35.1 unter `.runtime/bin` (Suche im Chat-Verlauf) |

Link für den Browser (Coder-Vorschau, nur mit Coder-Anmeldung erreichbar):
**https://3080--main--dev--knut.ws.konekto.energy**

`.runtime/` (Binärdateien, Daten, Logs, PIDs, LibreChat-Checkout) und `.env.local` (Geheimnisse)
sind nicht im Repo.

## Starten, stoppen, prüfen

```bash
scripts/setup.sh     # einmalig: Binärdateien, LibreChat klonen+bauen, .env.local erzeugen, Brücke installieren
scripts/start.sh     # alle vier Dienste im Hintergrund starten (überspringt, was schon läuft)
scripts/status.sh    # läuft alles? LibreChat-HTTP-Code und Brücken-Health
scripts/stop.sh      # alles stoppen (gezielt über .runtime/pids/*.pid)
```

- Logs: `.runtime/logs/{mongodb,meilisearch,claude-bridge,librechat}.log`
- `setup.sh` ist schwer (npm ci + Frontend-Build, einige Minuten) — nicht parallel zu anderen Builds.
- Nach Änderungen an `librechat/librechat.yaml` oder `librechat/.env` LibreChat neu starten
  (`scripts/stop.sh && scripts/start.sh`), die Konfiguration wird nur beim Start gelesen.
- **Mock-Modus:** `scripts/stop.sh && BRIDGE_MOCK=1 scripts/start.sh` — die Brücke ruft Claude nicht
  auf, sondern spielt Statuszeile, Echo und (bei „schreib …“) eine Schreib-Rückfrage vor.
- Tests der Brücke (starten eine eigene Instanz im Mock-Modus auf Port 3098):
  `cd claude-bridge && npm test`

## Anmelden und Claude verbinden

1. Link oben öffnen, **Registrieren** — nur Adressen `@maxenergy.at` / `@konekto.energy`, keine
   Social-Logins, keine Mail-Bestätigung. Das **erste** Konto wird LibreChat-Admin.
2. Im Terminal (lokal oder in der VM, mit dem eigenen Claude-Abo angemeldet):
   ```bash
   claude setup-token
   ```
   Das erzeugt einen langlebigen Token (`sk-ant-oat…`).
3. In der Werkbank oben links das Modell-Menü öffnen, bei **„Claude Code“** auf das **Zahnrad**
   klicken, Token einfügen, **Ablauf auf „nie“** stellen (Vorgabe sind 12 Stunden), Absenden.
4. Modell **„Claude Code (OLAF)“** (oder „…, schnell“ = Sonnet) wählen und losschreiben.

LibreChat speichert den Token verschlüsselt (`CREDS_KEY`) und schickt ihn je Nachricht an die
Brücke; die Brücke gibt ihn nur als `CLAUDE_CODE_OAUTH_TOKEN` an die Claude-Code-Sitzung weiter,
loggt ihn nicht und speichert ihn nicht. API-Schlüssel (`sk-ant-api…`) werden abgelehnt.
Ohne gültigen Token antwortet die Brücke mit einem Hinweis statt auf einen anderen Login
auszuweichen (geprüft: der Token aus der Umgebung hat Vorrang vor dem gespeicherten Login).

**Pilot-Freigabe:** Solange die Sitzungen als VM-Nutzer laufen (siehe unten), nimmt die Brücke nur
Konten aus `BRIDGE_ALLOWED_EMAILS` an (Vorgabe in `scripts/start.sh`: Knut). Andere Konten
bekommen einen freundlichen Hinweis. Weitere Adressen: `BRIDGE_ALLOWED_EMAILS=a@…,b@… scripts/start.sh`
(nach `stop.sh`).

## Was im Chat passiert

- **Eine Claude-Code-Sitzung je Chat.** Die Brücke merkt sich Chat-ID → SDK-Sitzung
  (`.runtime/bridge/sessions.json`) und setzt bei der nächsten Nachricht fort (`resume`).
- **Statuszeilen statt JSON:** Werkzeugaufrufe erscheinen als kurze kursive Zeilen, z. B.
  „🔎 Suche im Vault: „Service View““, „📄 Datei gelesen: Vault: 1-Roadmap/…“, „🎫 Jira: getJiraIssue – PM-123“,
  „🧰 Skill: olaf-jira“. Die Antwort selbst kommt als normaler, gestreamter Text.
- **Schreiben nur nach „ja“.** Lesen, Suchen, Skills und Teilagenten laufen ohne Rückfrage. Vor
  jedem Schreiben/Ändern von Dateien, jedem Bash-Befehl und jedem schreibenden Jira-/MCP-Aufruf
  hält die Sitzung an und fragt: „**Soll ich die Datei … schreiben?** … Antworte mit ja oder nein.“
  Die nächste Nachricht im selben Chat ist die Antwort: „ja“ → ausführen, „nein“ → nicht,
  alles andere → nicht ausführen, Claude richtet sich nach dem Text. Offene Rückfragen verfallen
  nach 30 Minuten.
- **Gesperrt, auch mit „ja“:** `git push`, `git merge`, `gh pr merge|create|comment|review…`,
  schreibende `gh api`-/GitHub-API-Aufrufe, GitHub-MCP-Schreibwerkzeuge.
- Technisch: Die Sperre sitzt in einem `PreToolUse`-Hook der Brücke (greift auch, wenn
  `~/.claude/settings*.json` Werkzeuge freigibt); `canUseTool` ist zweite Sicherung.
- **Grenzen gegen Missbrauch:** höchstens ein laufender Zug je Nutzer, 15 Minuten je Zug,
  höchstens 40 Schritte (`BRIDGE_TURN_TIMEOUT_S`, `BRIDGE_MAX_TURNS`, `BRIDGE_CONFIRM_TIMEOUT_S`).
  Bricht LibreChat die Verbindung ab („Stopp“), stoppt die Brücke die Sitzung (über LibreChat nicht eigens getestet).
- **Titel** erzeugt die Brücke aus der ersten Nachricht, ohne Claude aufzurufen (Modell `olaf-titel`).

## Umgebung der Claude-Sitzungen (Pilot)

- Laufen als **VM-Nutzer `knut`** mit `settingSources: ['user', 'project']` und `skills: 'all'`:
  `~/.claude/CLAUDE.md`, alle Skills unter `~/.claude/skills`, Plugins, **Knuts Hooks**
  (u. a. Merge-Sperre, Gedächtnis-Hooks) und Knuts MCP-Server gelten wie im Terminal.
- Arbeitsverzeichnis je Nutzer: `.runtime/bridge/scratch/<nutzer-id>`; `/vault` ist als
  zusätzliches Verzeichnis freigegeben (dessen `CLAUDE.md` wird mitgeladen).
- **Jira:** kommt wie im Terminal aus der Nutzer-MCP-Konfiguration (`~/.claude.json`, Server
  `atlassian`, HTTP `https://mcp.atlassian.com/v1/mcp`, OAuth). Im Pilot ist das **Knuts
  Jira-Anmeldung** — deshalb die E-Mail-Freigabe. Geprüft: Server verbindet, 20 Jira-Werkzeuge.
- Modell „Claude Code (OLAF)“ = Standardmodell aus `~/.claude/settings.json`.

**Für den Team-Workspace (Phase 4) nötig:** je Person eigener Unix-Nutzer oder eigenes
`CLAUDE_CONFIG_DIR` (Skills/CLAUDE.md verlinkt, eigene Einstellungen ohne Knuts Hooks), eigener
Jira-Zugang je Person (Atlassian-OAuth je Konfigurationsverzeichnis einmalig per `/mcp` anmelden,
oder Atlassian-API-Token je Person verschlüsselt ablegen), Vault-Schreibrechte je Person klären,
dann `BRIDGE_ALLOWED_EMAILS` entfernen.

## Konfiguration im Repo

| Datei | Inhalt |
|---|---|
| `librechat/librechat.yaml` | Endpunkt „Claude Code“, Modell-Specs, Willkommenstext, Oberfläche, Registrierung |
| `librechat/.env` | LibreChat-Umgebung **ohne** Geheimnisse (Ports, Domains, Login-Schalter) |
| `.env.local` | `CREDS_KEY`, `CREDS_IV`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `MEILI_MASTER_KEY` — zufällig erzeugt, gitignored |
| `claude-bridge/src/server.ts` | HTTP: `/v1/models`, `/v1/chat/completions` (SSE), `/health`, Token-Prüfung, Freigabe |
| `claude-bridge/src/sessions.ts` | Sitzungen, Streaming, Rückfrage-Mechanik, Limits |
| `claude-bridge/src/tools.ts` | Einordnung lesen/bestätigen/gesperrt, Statuszeilen, Rückfragetexte |
| `claude-bridge/src/mock.ts` | Mock für `BRIDGE_MOCK=1` |

Die Brücke ist TypeScript und läuft direkt mit Node 22 (Type-Stripping), ohne Build-Schritt.

## Stand

**Erledigt und geprüft**
- LibreChat v0.8.7 nativ gebaut, liefert 200 auf 127.0.0.1:3080; Anmeldung über die Vorschau-URL
  konfiguriert (`DOMAIN_CLIENT/SERVER`, `TRUST_PROXY`).
- Brücke antwortet auf `/v1/models`; Streaming Ende-zu-Ende im Mock-Modus: per `npm test` (7 Tests)
  und im Browser durch LibreChat (Registrieren, Token über das Zahnrad, Chat, Fortsetzen derselben
  Sitzung, Rückfrage mit „ja“ und „nein“, Titel, Freigabe per E-Mail). Der Testnutzer ist wieder gelöscht.
- Echter Pfad bis zur Anmeldung geprüft, **ohne** echten Token: SDK startet, lädt 222 Skills und
  den Jira-MCP, nutzt den übergebenen Token (ein Schein-Token wird mit 401 abgelehnt und als
  deutscher Hinweis angezeigt, kein Ausweichen auf den gespeicherten Login).

**Offen**
- Echter Durchlauf mit Knuts eigenem Token (`claude setup-token`) — konnte hier bewusst nicht
  getestet werden.
- Team-Betrieb (siehe oben), eigene Werkbank-Optik, Board (Phase 3), forge (Phase 2).

## Bekannte Grenzen

- Die Brücke verarbeitet nur Text; **Dateianhänge** aus LibreChat werden ignoriert.
- **Bearbeiten/Neu generieren** älterer Nachrichten verzweigt in LibreChat, die Claude-Sitzung läuft
  aber linear weiter (sie kennt den verworfenen Zweig).
- Bei einem Neustart der Brücke gehen **offene Rückfragen** verloren; die Sitzung selbst lässt sich
  fortsetzen (die nächste Nachricht geht normal weiter).
- Bash-Befehle brauchen immer ein „ja“, auch rein lesende — Skills mit Skripten fragen daher öfter nach.
- Die Pilot-Sitzungen haben Knuts Rechte auf der VM (Dateien, Hooks, Gedächtnis, Jira).
- Die Coder-Vorschau ist nur für Knut (Coder-Anmeldung) erreichbar.
- LibreChat erlaubt bis zu 2 gleichzeitige Nachrichten je Nutzer, die Brücke nur einen laufenden
  Zug — der zweite bekommt einen Hinweis.
