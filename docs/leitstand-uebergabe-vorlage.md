# Leitstand — Übergabe (Vorlage)

Die Hauptsitzung füllt diese Vorlage und startet damit den Leitstand:
`scripts/orch leitstand start --handover <datei>` (Plan 132, `docs/plan-leitstand.md`). Der Inhalt wird als erste Nachricht
nach der festen Leitstand-Vorgabe in den Chat gelegt (höchstens 40 000 Zeichen). Keine Geheimnisse, keine Tokens, keine
Kundendaten — nur Verweise darauf, wo etwas steht.

---

## Stand (TT.MM.JJJJ, HH:MM)
- Woran wir gerade arbeiten (ein bis drei Sätze):
- Was zuletzt entschieden wurde (mit Quelle):

## Offene Stränge
| ID | Titel | Status | Arbeitsordner | nächster Schritt |
|---|---|---|---|---|
| … | … | läuft / wartet / fertig | `~/work/knut/…` | … |

## Offene Rückfragen an Knut
- `q-…` — Titel — seit … — Empfehlung: …

## Register (erst dort lesen, dann im Code prüfen)
- Roadmap: `/vault/olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap/0-Overview/0-roadmap-produkt-olaf.md`
- PR-Stand: `/vault/olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap/0-Overview/pr-stand-produkt-olaf.md`
- Bau-Stand je Thema: `/vault/olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap/<Thema>/0-<thema>-uebersicht.md`
- Offene Fragen: `/vault/olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap/0-Overview/offene-fragen-roadmap-produkt-olaf.md`
- Pläne der Werkbank: `~/work/knut/<worktree>/docs/plan-*.md`

## Regeln (aus `~/.claude/CLAUDE.md`, gekürzt)
- Erst nachsehen, dann herleiten: Register vor Code; gegen den echten HEAD prüfen, nicht gegen den lokalen Klon.
- Schmal lesen, breit ablegen; große Zwischenergebnisse in eine Datei, nur die Auswertung in den Chat.
- Subagenten nur für Fan-out-Lesen; Schreibendes bleibt hier.
- Keine Jira-Tasks ohne ausdrücklichen Auftrag. **Nie mergen. Pushen nur auf ausdrückliches Ok.**
- Hochgeladene Dateien immer einsortieren (`~/work/dokumente/<team>/<vorgang>/JJJJ-MM-TT_<art>_<slug>.<ext>`).
- Gedächtnis: compartment (`memory_search` vor dem Antworten, `memory_store` für neue Fakten).

## Was als Nächstes ansteht
1. …
2. …
