# Arbeitsweise im OLAF Workspace

Diese Datei liegt (als Link) in der eigenen Claude-Konfiguration jeder Person (`.runtime/claude/<id>/CLAUDE.md`)
und gilt in jeder Sitzung des OLAF Workspace (früher „OLAF-Werkbank“). Quelle: `templates/claude/CLAUDE.md` im Werkbank-Repo — dort ändern, nicht
in der Kopie. Die Regeln des Vaults (`/vault/CLAUDE.md`) kommen zusätzlich.

## Erst nachsehen, dann herleiten

- **Register vor Code.** Der Stand einer Sache steht im olaf-Vault: `1-Roadmap/<Thema>/0-<thema>-uebersicht.md`
  für den Bau-Stand, `0-Overview/pr-stand-produkt-olaf.md` für PRs, `0-Overview/0-roadmap-produkt-olaf.md` für
  „woran wir gerade arbeiten“. Zum Finden zuerst das Werkzeug `vault-search`.
- **Jira** liest du über den Atlassian-MCP; der OLAF Workspace hält zusätzlich eine Kopie von PM (Board).
- **Ein Screenshot ist ein Indiz, kein Befund.** Vor dem Melden in der Quelle nachsehen.
- Schmal lesen: Abschnitte statt ganzer Dateien (`read_note` mit `section`, `outline`).

## Vor dem Bau: schon gebaut? (plan-to-pr Phase 2.5b, Erprobung)

Bevor du für eine Spec einen Branch anlegst oder Code schreibst, und noch einmal vor einem PR (plan-to-pr Phase 5
Schritt 3): **`scripts/vorbau-check <spec-slug> --plan <plandatei>`** im Werkbank-Repo (Repos: `--repos` oder
`WERKBANK_VORBAU_REPOS`). Er sucht auf dem Integrationszweig (`origin/HEAD`) und in allen offenen PRs nach Slug,
`spec:`, Plandatei und Branch — nur mit dem Lesetoken.

- `frei` / `fortsetzen` → bauen; die Belege gehören in deinen Bericht.
- `treffer` → **nicht bauen.** Belege (SHA, PR-Link) nennen und anhalten; Knut entscheidet im OLAF Workspace
  („trotzdem bauen“ · „auf Vorhandenem aufsetzen“ · „Spec nachziehen/abräumen“).
- `aus` (G0 auf dieser Instanz abgeschaltet, `WERKBANK_VORBAU_CHECK=off`) → wie `frei`.
- `stopp` (kein Lesetoken, Fetch oder PR-API scheitert) → ebenfalls nicht bauen, sondern melden. Nie mit dem
  Push-Token nachprüfen.

## Was hier nicht automatisch passiert

- **Keine neuen Jira-Tasks** ohne ausdrücklichen Auftrag (Skill `olaf-jira`: Duplikatsuche, Workstream, Owner).
- **Nie mergen.** GitHub-Schreiben ist im OLAF Workspace gesperrt.
- Schreiben (Dateien, Jira, Bash) bestätigt die Person im Chat mit „ja“ — das System fragt, nicht du.
- Personendaten (Service-Fälle) bleiben im Vault und in Claude, nie in Jira-Kommentaren oder geteilten Dateien.
