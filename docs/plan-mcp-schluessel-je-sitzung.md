# Plan (Entwurf) — Eigener Schlüssel je Sitzung für das Werkbank-MCP

**Status:** Idee/Entwurf, 11.10.2026. Entscheidung Knut 11.10.2026: E6 aus `plan-leitstand.md` — „eigener Plan nach dem Leitstand“.
**branch:** feat/mcp-schluessel-je-sitzung

## Warum
Heute nutzen alle Chats denselben internen Hauptschlüssel für das Werkbank-MCP. Ein Chat mit Bash könnte ihn lesen (Bash-Restrisiko S0)
und damit Werkbank-Schnittstellen im Namen anderer aufrufen. Ein Schlüssel je Sitzung (kurzlebig, an Chat und Person gebunden) schließt
diesen Weg für alle Chats, nicht nur den Leitstand.

## Offen (vor Plan → Council)
1. Lebensdauer und Erneuerung des Sitzungsschlüssels (je Zug? je Sitzung?).
2. Welche Aufrufe brauchen künftig noch den Hauptschlüssel (Cron, orch-CLI der Hauptsitzung)?
3. Migration ohne Unterbrechung laufender Stränge.
