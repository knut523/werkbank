# Plan: PR-Ticker-Review verbessern (Release 17c, Zusatz)

Stand 17.10.2026 · Owner Knut · Auftrag (Knut, 17.10.: „bau den Review-Fix“) plus Befund aus dem ersten erfolgreichen
@review-Lauf (olaf-admin#354).

## Ziel

Ein automatisches Review (`@review` oder Review-Anfrage) startet mit allem, was es braucht, prüft bei einem neuen Stand nur
die Änderung, ist so tief wie der PR groß ist, wird von einem zweiten Modell gegengeprüft und scheitert nicht still.

## Umsetzung (`web/server/prreview.ts`, `web/server/gegenpruefung.ts`)

| Punkt | Verhalten |
|---|---|
| Kontext vorab | Lesetoken: `kontext.md` (Beschreibung, Kommentare, Reviews, Inline-Threads offen/erledigt, alles als Daten markiert), `diff-stat.txt`/`diff.patch` gegen die merge-base mit `origin/<basis>`, verknüpfte Jira-Schlüssel und Pläne |
| Delta-Review | Fertiges Review mit älterem Kopf → nur `alter..neuer Kopf` über die Dateien des PRs (jetzt und beim alten Kopf), Tabelle „offene Punkte erledigt?“, voriger Kommentar im Paket; alter Kopf weg → volles Review |
| Tiefe/ETA | < 400 Zeilen quick, sonst regular, `@review deep` → deep (hebt auch einen wartenden Stand an); Lead bleibt Claude (`claude:opus`); Vorgabe-ETA nach Größe am Strang |
| Gegenprüfung | Nach dem Claude-Review einmal glm-5.3 (Prüfauftrag) + jcode/glm-5.3-flash (nur lesend, Shell-Wächter ohne Schlüssel/Umgebung) → `gegenpruefung.md`, Abgleich im Strang (nur bestätigte Befunde), dann posten. Ohne Schlüssel/bei Fehler ohne Gegenprüfung. `WERKBANK_REVIEW_GEGENPRUEFUNG=off` schaltet ab |
| Fehlerfall | Startfehler, Parallelgrenze, Abbruch, hängender Start → erneut einreihen nach 5/15/45/120 min (nicht gegen den Tagesdeckel), danach „fehler“; im Ticker „erneut ab HH:MM (Versuch n)“ und „Jetzt reviewen“ |
| GitHub-Text | `kommentar.md` und Fußnote auf Englisch (olaf-docs/AGENTS.md); `#N`, das es im Repo gibt (auch gemergt), blockt das Auto-Posten nicht |

Zustände: `wartet → startet → läuft → gegenprüfung → abgleich → fertig` (bzw. `wartet` erneut, `fehler`, `übersprungen`,
`deckel`). Jeder Übergang ist ein Compare-and-Set auf den gelesenen Zustand.

## Infra

Neu und optional: `WERKBANK_REVIEW_GEGENPRUEFUNG=off` (Vorgabe an), `WERKBANK_JCODE_BIN` (Vorgabe `~/.local/bin/jcode`).
Die Gegenprüfung nutzt den Melious-Schlüssel des Review-Besitzers aus der Werkbank (wie `challenge`).

## Tests

`web/test/prticker.test.ts` (Kontext/Delta/Tiefe, Gegenprüfung mit Abgleich, Einreihen mit Abstand, Verweis-Prüfung,
Zustands-Schutz), `claude-bridge/test/jcode-guard.test.ts` (Umgebung und `/proc` gesperrt).
