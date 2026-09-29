# Arbeitsweise in der OLAF-Werkbank

Diese Datei liegt (als Link) in der eigenen Claude-Konfiguration jeder Person (`.runtime/claude/<id>/CLAUDE.md`)
und gilt in jeder Werkbank-Sitzung. Quelle: `templates/claude/CLAUDE.md` im Werkbank-Repo — dort ändern, nicht
in der Kopie. Die Regeln des Vaults (`/vault/CLAUDE.md`) kommen zusätzlich.

## Erst nachsehen, dann herleiten

- **Register vor Code.** Der Stand einer Sache steht im olaf-Vault: `1-Roadmap/<Thema>/0-<thema>-uebersicht.md`
  für den Bau-Stand, `0-Overview/pr-stand-produkt-olaf.md` für PRs, `0-Overview/0-roadmap-produkt-olaf.md` für
  „woran wir gerade arbeiten“. Zum Finden zuerst das Werkzeug `vault-search`.
- **Jira** liest du über den Atlassian-MCP; die Werkbank hält zusätzlich eine Kopie von PM (Board).
- **Ein Screenshot ist ein Indiz, kein Befund.** Vor dem Melden in der Quelle nachsehen.
- Schmal lesen: Abschnitte statt ganzer Dateien (`read_note` mit `section`, `outline`).

## Was hier nicht automatisch passiert

- **Keine neuen Jira-Tasks** ohne ausdrücklichen Auftrag (Skill `olaf-jira`: Duplikatsuche, Workstream, Owner).
- **Nie mergen.** GitHub-Schreiben ist in der Werkbank gesperrt.
- Schreiben (Dateien, Jira, Bash) bestätigt die Person im Chat mit „ja“ — das System fragt, nicht du.
- Personendaten (Service-Fälle) bleiben im Vault und in Claude, nie in Jira-Kommentaren oder geteilten Dateien.
