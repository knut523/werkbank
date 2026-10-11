---
status: gebaut, nicht ausgerollt
quelle: review-pakete/71-werkbank-auto-multi/plan.md, Abschnitt 4 P3; Knut, 07.10.2026: „werkbank hat nur einen chat pro zeit … gehen auch mehrere?“ → „mach plan to pr und nimm die beste Option“
---

# Parallele Chats (P3-light)

## Ziel

Eine Person kann mehrere Werkbank-Chats gleichzeitig arbeiten lassen, ohne dass sich die Chats gegenseitig Dateien
überschreiben. Ergebnis: bis zu `BRIDGE_MAX_PARALLEL_CHATS` (Vorgabe 3) Züge je Person laufen nebeneinander; jeder
neue Chat arbeitet in seinem eigenen Ordner.

## Stand heute

- `lockFor` (`claude-bridge/src/sessions.ts`): je Person ein laufender Zug; Chats, die auf „ja“ warten, und
  lesende Board-Läufe (bis `BRIDGE_MAX_BOARD_RUNS`) zählen nicht. Zweiter Chat → „Bei dir läuft gerade schon eine
  Anfrage in einem anderen Chat“.
- Ein Arbeitsordner je Person: `scratchFor(userId)` = `.runtime/bridge/scratch/<person>`, als `cwd` jeder Sitzung.
  Anhänge liegen dort unter `anhaenge/<chat>/`, „Im Chat“-Dateien unter `dateien/`, weitergeführte Chats unter
  `geteilt/` (Werkbank-Web, `sharing.ts`), jeweils als relativer Pfad im Prompt.
- Claude Code legt den Verlauf einer Sitzung unter dem `cwd` ab (`projects/<cwd>`). Ein anderer `cwd` beim Fortsetzen
  findet die Sitzung nicht.

## Optionen

| | Was | Bewertung |
|---|---|---|
| A | Sperre je Person lockern, ein Ordner je Person | einfach, aber zwei Chats schreiben in dieselben Dateien |
| **B** | **Ordner je neuem Chat + Sperre je Chat mit Obergrenze** | **trennt die Arbeit; bestehende Chats bleiben fortsetzbar** |
| C | B + Sandbox/eigener Unix-Nutzer je Chat | sicherste Trennung, braucht sudo bzw. bwrap-Setup auf der VM — nicht in dieser Runde |

**Gewählt: B** (Knut: „nimm die beste Option“). Begründung: Der Auto-Modus gilt nur für Knuts Konto, alle Sitzungen
laufen ohnehin unter demselben VM-Nutzer; C trennt erst, wenn mehrere Personen Auto-Modus bekommen (dann R4-3).

## Schnitte

1. **Ordner je Chat.** `workDirFor(userId, convId)`: ein Chat, der schon eine Sitzung hat (`sessions.json`), bleibt im
   Personenordner (sonst ginge der Verlauf verloren); ein neuer Chat bekommt `scratch/<person>/chats/<chat>`. Die
   Zuordnung steht in `.runtime/bridge/cwd.json` und gilt für alle weiteren Züge des Chats. Auto-Modus-`workDir` =
   dieser Ordner.
2. **Sperre je Chat.** `lockFor` zählt laufende Züge (ohne Warten auf „ja“, ohne Board-Läufe) gegen
   `BRIDGE_MAX_PARALLEL_CHATS` (Vorgabe 3, `1` = altes Verhalten). Derselbe Chat zweimal bleibt gesperrt („arbeitet noch
   an der vorigen Nachricht“). Meldung beim Überlauf nennt die Zahl.
3. **Anhänge** landen im Ordner des Chats (`<chat-ordner>/anhaenge/…`), der relative Pfad im Prompt stimmt damit.
4. **Werkbank-Web:** „Im Chat“ und „Als Kopie weiterführen“ nennen die Datei mit **absolutem** Pfad (der Chat startet
   in einem neuen Ordner, der relative Pfad liefe ins Leere).
5. **README** (Abschnitt Orchestrator/Parallel) und Not-Aus: `BRIDGE_MAX_PARALLEL_CHATS=1 scripts/werkbank.sh restart`.

## Definition of Done

- [x] Zwei neue Chats derselben Person laufen gleichzeitig; ein vierter wird mit Hinweis abgewiesen (Vorgabe 3). — `auto.test.ts` „Parallele Chats …“ (drei langsame Chats, vierter abgewiesen, derselbe Chat gesperrt).
- [x] Jeder neue Chat hat seinen eigenen Ordner; zwei Chats, die dieselbe Datei anlegen, überschreiben sich nicht. — `parallel.test.ts`.
- [x] Ein bestehender Chat mit Sitzung setzt im alten Ordner fort (Verlauf bleibt). — `parallel.test.ts`.
- [x] Anhänge und „Im Chat“-Dateien sind im jeweiligen Chat lesbar. — `bridge.test.ts` Anhänge im Chat-Ordner; „Im Chat“/geteilte Chats mit absolutem Pfad.
- [x] `BRIDGE_MAX_PARALLEL_CHATS=1` stellt das alte Verhalten her. — `parallel.test.ts` und die E5-Sperre in `auto.test.ts` (OFF-Brücke mit 1).
- [x] Tests für `lockFor`, `workDirFor` und den Mock-Ablauf paralleler Chats; Brücke 57/57, Web 110/110 (eigene Mongo).
- [ ] README nachgezogen; Commit auf `feat/parallele-chats`; auf der Werkbank ausgerollt.

## Fertig heißt

Gebaut, getestet, auf der Werkbank ausgerollt, README nachgezogen, PR auf knut523/werkbank (Push durch Knut).

## Risiken

- Kontingent: drei parallele Züge verbrauchen das Claude-Kontingent schneller; der automatische Kontowechsel greift.
- Gleiche Dateien außerhalb der Chat-Ordner (Vault, Repos) können zwei Chats weiterhin gleichzeitig ändern — wie zwei
  Menschen. Das ist bewusst nicht gesperrt.
