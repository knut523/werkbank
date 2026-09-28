# OLAF-Werkbank — Plan

Stand 28.09.2026 · Owner Knut · lokal auf der VM (`~/work/werkbank`, Arbeits-Worktree `~/work/werkbank-dev`), kein Remote.

## Ziel

Eine Oberfläche für das ganze Team — **so hübsch und funktional wie LibreChat** — in der man
**mit Claude Code chattet wie in dieser Sitzung** (unsere Skills, der Obsidian-Vault im Dateisystem,
Jira), ohne API-Schlüssel: **jede Person meldet sich mit ihrem eigenen Claude an.** Dazu das
**beste Aufgabenboard** (Jira gespiegelt, Agent auf Karte ansetzen) und der **beste PR-Reviewer**
(forge).

## Entscheidungen (Knut, 28.09.2026)

| # | Frage | Entscheidung |
|---|---|---|
| 1 | Betrieb | eigener **Team-Workspace** im Coder (Pilot vorher hier) |
| 2 | Modelle | **nur Claude** — über Claude Code, **kein API-Schlüssel** |
| 3 | Login | **jede Person mit eigenem Claude** |
| 4 | Schreibrechte | **Vault und Jira voll schreiben**, jeweils mit Bestätigung im Chat |
| 5 | Board | **eigene Seite in der Werkbank** |
| 6 | Code | **erstmal hier auf der VM** |
| 7 | Oberfläche | egal welche Basis — Hauptsache so hübsch und funktional wie LibreChat |

## Architektur

```
Browser ─► LibreChat (UI, Logins, Chats, Suche, Artefakte)            :3080
             │ custom endpoint "Claude Code", apiKey: user_provided
             ▼
          claude-bridge (OpenAI-kompatibel, streamt)                 :3090
             │ je Nutzer: CLAUDE_CODE_OAUTH_TOKEN (aus `claude setup-token`)
             ▼
          Claude Agent SDK  ── Skills (~/.claude/skills), CLAUDE.md
                            ── Vault /vault (Dateisystem, lesen+schreiben mit Bestätigung)
                            ── Jira (Atlassian-MCP, je Nutzer eigener Token)
                            ── forge (MCP-Werkzeug: PR-Review als Entwurf)
Board-Seite (Jira-Spiegel)  ──► „Agent auf Karte" startet eine Bridge-Sitzung mit Ticket-Kontext
forge (abgesichert)          ──► Review-Engine, Ergebnisse als Entwurf, posten nur per Klick
```

Bausteine und woher die Ideen kommen:

- **LibreChat** — Oberfläche, Mehrbenutzer, Chat-Verlauf, Suche (Meilisearch), Agenten-Vorlagen.
  Läuft nativ (Node 22, MongoDB- und Meilisearch-Binärdateien ohne Docker).
- **claude-bridge** (neu, klein) — OpenAI-kompatibler Endpunkt, der je Anfrage eine Claude-Code-Sitzung
  über das Agent SDK fährt; Sitzung pro Chat fortsetzen (resume), Werkzeugaufrufe als lesbare
  Zwischenzeilen streamen, Bestätigungen für Schreibzugriffe als Rückfrage im Chat.
  Idee aus forge `claude_shim.py`, CloudCLI (Sitzungsverwaltung), coder/agentapi (Status).
- **Board** (neu) — Spalten = PM-Status, Karten = Tickets, Bahnen = Workstreams; Zwei-Wege-Sync mit
  Jira; „Agent ansetzen" (Idee aus kandev/Vibe Kanban): Ergebnis und Log hängen an der Karte,
  Kommentar zurück nach Jira nach Bestätigung.
- **forge** — nach Absicherung (Sandbox, API-Anmeldung, Entwurf-Bindung, ehrliche Ergebnisse) als
  Werkzeug im Chat („reviewe PR #171") und am Board.

## Phasen

1. **Pilot Chat** (hier): LibreChat + claude-bridge, Knut meldet sich mit eigenem Claude an, Vault
   und Jira erreichbar. Link zum Klicken.
2. **forge absichern + als Werkzeug**; erster echter Test: olaf-admin #171 (SMS-OTP), Vergleich mit
   plan-to-pr-Review.
3. **Board** mit Jira-Spiegel und „Agent auf Karte".
4. **Team-Workspace**, Logins für das Team, Einführung, DSGVO-Abschnitt.

### Erweiterung 28.09.2026 (Knut: „one click setup … skills, structure, jira copy, planning and review, sharing“)

Umgesetzt im Pilot (Details, Stand und offene Entscheidungen in [`README.md`](README.md)):
`scripts/werkbank.sh up` als Ein-Klick-Einrichtung; Web-App auf :3070 mit **Einrichtung** (eigenes
Claude, eigenes Jira), **Wissen** (Vault nur lesend, Suche, Backlinks, Roadmap), **Board** (Jira-Kopie PM,
Schreiben mit Bestätigung, Agent ansetzen nur lesend → Kommentarentwurf — Phase 3 vorgezogen),
**Sprint** (Ziel, S1–S4, Antwortzeilen, Sprint-Sync mit Freigabe, neuer Zyklus), **Skills** (aus dem Vault,
Vorlagen im Chat), **Dateien & Teilen** (Team-Dateien, Chats nur team-intern teilen, Anhänge erreichen die Sitzung).

## Leitplanken

- Keine Zugangsdaten im Repo oder im Log; Tokens je Nutzer verschlüsselt gespeichert.
- Bestätigung vor jedem Schreiben in Vault/Jira/GitHub; nie mergen; GitHub-Schreiben nur mit Go.
- Personendaten (Service-Fälle im Vault) bleiben in Claude — kein zweiter Anbieter für Vault-Inhalte.
- Jede Person nutzt ihr eigenes Claude-Abo; kein geteilter Login.

## Offen

- Coder-Login für den Team-Workspace (Knut: `coder login`), Vorlage/Name des Workspaces.
- Plane-Einträge in Vaultwarden: wird Plane genutzt? Dann als Board-Alternative prüfen.
