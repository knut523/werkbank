# Plan 162 — Melious AI als Test-Konto im Kontowechsel

Stand: gebaut-lokal, offizieller Einbau (14.10.2026). Auftrag Knut 14.10.: Melious (EU, Open-Weight-Modelle, Anthropic-kompatible API) testweise in den
automatischen Kontowechsel der Werkbank; Zusatz am selben Tag: vorsichtig, Verbrauch messen, Deckel, Standard aus.

## Ziel
Ein Melious-Schlüssel (`sk-mel-…`) lässt sich wie die Claude-Konten im Modell-Menü hinterlegen. Er wird **nur** benutzt, wenn Knut es
ausdrücklich einschaltet, und dann sichtbar, gezählt und gedeckelt.

## Entscheidungen (Auftrag, gelten)
- Kontoart „Melious“ neben den Claude-Konten; Basis-URL fest `https://api.melious.ai` (ohne `/v1`), optional ein Modellname,
  sonst gehen die Claude-Namen durch (Melious bildet opus/sonnet/haiku ab).
- **Standard aus.** Global „Melious erlauben“ (aus) und je Chat `/melious an` (aus). Neue Stränge bekommen ihn nie automatisch.
- „Als letzten Ausweg, wenn alle Claude-Konten erschöpft sind“ ist eine **eigene** Einstellung (aus) — sonst liefe ein neuer Strang
  doch automatisch auf Melious, sobald die Claude-Kontingente leer sind.
- Keine Lastverteilung auf Melious (nicht in `orderForTurn`).
- Verbrauch: je Melious-Zug Input/Output/Cache-Read (und Cache-Write) aus `result.usage`, je Tag und Monat (Europe/Berlin) in der
  Werkbank (`werkbank.melious_usage`), ohne Schlüssel. Deckel Tag/Monat in Tokens (Summe aller vier), Vorgabe 200 000 / 2 000 000,
  je Person einstellbar, Vorgabe per Env `MELIOUS_TAG_LIMIT` / `MELIOUS_MONAT_LIMIT` (PRO-Plan = nur andere Zahlen).
- 80 % → Hinweis an den Hauptchat (Ereignis wie die Freigabe-Hinweise), 100 % → Melious bis Tages-/Monatsende gesperrt,
  deutsche Meldung im Chat; ein laufender Melious-Zug wird beim Überschreiten des Rests abgebrochen (Schätzung aus den
  `assistant`-usages, gezählt wird danach die tatsächliche Summe).
- Melious hat laut Doku **keine** Verbrauchs-/Kontostand-Schnittstelle (nur `X-RateLimit-*`-Header und `billing_cost` im
  Antwortkörper, die Claude Code nicht weiterreicht) → nur eigene Zählung.

## Offizieller Einbau (Knut 14.10.: „ok passt … lass es uns in den Workspace so offiziell einbauen“)
Melious wird regulärer Bestandteil, nicht nur Test-Konto. Bindend aus der Modellwahl v2 (Betriebsregeln 1, 3, 4): kein
Modellwechsel mitten im Strang, Hauptstrang-Modell als Parameter der Brücke je Strang, Anzeige des **tatsächlich** gelaufenen
Modells, Melious nur mit Datenregel. Die smarte Auswahl selbst (Risikostufe aus Auftrag/Plan) baut Paket 163; hier wird sie
**vorbereitet**: Schnittstelle, Speicherung, Anwendung in der Brücke.

Schnitte (zusätzlich zu S1 = Commit 9d8eb74):
- **S2 Modell je Strang/Rolle.** `orch start` und `/internal/orchestrate` nehmen `modell` (`claude:opus|sonnet|haiku` oder
  `melious:<id>`) und `risiko` (`niedrig|mittel|hoch`) an; die Brücke merkt beides je Strang (orch.json) und wendet es auf jeden
  Zug an (Melious-Modell = wie `/melious an <id>`, Claude-Modell = Modell der Anfrage). Überlauf auf Melious (letzter Ausweg)
  nur für Chats und Stränge mit Risiko „niedrig“, mit dem Überlauf-Modell aus der Einrichtung; „hoch“ wartet immer.
  Einrichtung: Rollen-Tabelle Melious (Standardmodell, Überlauf, Berichte/Texte, Massenarbeit) — Vorgaben nach dem
  Blindvergleich. Teilagenten laufen beim Anbieter des Hauptzugs (ein Claude-Code-Prozess, eine Basis-URL).
- **S3 Datenregel bis AVV.** Einstellung „AVV mit Melious liegt vor“ (aus). Solange aus, laufen Melious-Züge ohne die
  Atlassian- und forge-review-Werkzeuge, mit einem festen Satz im Systemtext (keine Kundendaten, keine Schlüssel, keine Logs mit
  Personenbezug, keine Push-Vorbereitung). `git push` ist gesperrt, und `/melious an` zeigt die Regel. Schlüssel gehen auch nach
  dem AVV nie an Melious (die Sitzungsumgebung bleibt geschrubbt).
- **S4 Tatsächliches Modell.** Offiziell immer mit festem Modellnamen (Vorgabe aus der Einrichtung; ohne Namen zeigt die
  Statuszeile „Abbildung von <Claude-Name>, tatsächliches Modell nicht gemeldet“). Das Modell steht in der Statuszeile, im Zustand
  des Strangs (Kopf auf der Hauptchat-Seite) und im Verbrauch (je Tag und Modell).
- **S5 Blindvergleich.** Der Orchestrator fährt ihn (8 Aufgaben × Haiku/Sonnet/GLM 5.3 Flash/GLM 5.3/DeepSeek V4.1 Flash) und
  liefert das Ergebnis als Datei. Danach: Vorgaben der Rollen-Tabelle, Bericht mit fairer Einordnung nach Klassen.

Entscheidungen dazu (Bericht, „- Knut:“): Vorgabe-Modelle je Rolle nach dem Vergleich; ob Stränge ohne Risikostufe als
„mittel“ gelten (kein Überlauf).

Nachgezogen beim Bau:
- Vorgabe-Modell `glm-5.3-flash` (Blindvergleich: gleichauf mit Haiku, GLM 5.3 deutlich langsamer), per `MELIOUS_MODELL`.
- **Kein Auto-Modus-Klassifikator über Melious:** Claude Code meldet über das Gateway, dass die neue Klassifikator-Version nicht
  unterstützt wird; er liefe sonst über das Open-Weight-Modell. Melious-Züge laufen im normalen Modus (Rückfrage im Chat, im
  Strang abgelehnt). Eine Lockerung (Datei-Änderungen ohne Rückfrage) ist eine Entscheidung für Knut.
- Datenregel sperrt zusätzlich die Jira-Werkzeuge des Werkbank-MCP (`jira_update*`, `hygiene_*`); der Hauptchat nimmt kein
  `modell`/`risiko` an (Review 2).
- Fehlerart „Guthaben leer“ (echter Test: 403 `permission_error` „Insufficient credits“) bis Monatswechsel, zurücksetzbar.

- **S6 Rollen-Profile** (Messung Paket 163: Grundlast 24–34 k Eingabe-Tokens je Zug). `orch start --profil voll|bauer|leser`,
  je Strang beim Start fest (stabiler Cache-Präfix), Vorgabe `voll` = wie bisher:
  - `bauer`: voller Claude-Code-Systemprompt, nur die MCP-Server vault-search und werkbank.
  - `leser`: nur Read (Grep/Glob gibt es in der aktuellen CLI nicht mehr), vault-search und werkbank; keine Skills, keine
    CLAUDE.md, keine Teilagenten, ohne dynamische Systemprompt-Abschnitte. Über Melious zusätzlich `--bare` mit eigenem
    kurzem Systemprompt; bei Claude nicht (überspringt OAuth).
  - Geprüft mit echtem Claude Code gegen den Stub: 8,2 KB statt 89 KB je Anfrage. Der PreToolUse-Wächter der Brücke läuft
    auch unter `--bare` (Lesen in fremden Arbeitsordnern abgelehnt).
  - Lesende Bash-Befehle bleiben „Rückfrage“ (keine neue Ausnahme), darum ist Code-Suche Sache des Profils `bauer`.
- Korrektur zur Token-Aussage: Melious meldet alle Eingaben als Cache-Treffer; der Mehrverbrauch kommt von mehr Zügen, nicht
  von fehlendem Caching.

## Zusatz 2 (Knut 14.10.: PRO-Plan mit GLM 5.3, GLM 5.3 Flash, DeepSeek V4.1 Flash, DeepSeek V4 Flash)
- Modell je Chat statt nur der opus/sonnet/haiku-Abbildung: `/melious an <modell>`, `/melious modell <name|standard>`,
  `/melious modelle` (Liste live über `GET /v1/models`, ohne Tokens). Reihenfolge: Chat-Modell → Modell aus der Einrichtung →
  Claude-Namen. Mit festem Modell zeigen auch Teilagenten und das Hilfsmodell darauf (`ANTHROPIC_DEFAULT_*_MODEL`,
  `ANTHROPIC_SMALL_FAST_MODEL`); zurück auf Claude gelten wieder die Werte des Brücken-Prozesses.
- Modellvergleich (zehn Werkbank-Aufgaben, blind bewertet) läuft über die Brücke der isolierten Instanz, sobald der Schlüssel
  eingetragen ist; Werkzeug außerhalb des Repos (Review-Paket).

## Review-Korrekturen (unabhängiger Durchgang, 14.10.)
- Deckel gilt je Person über alle laufenden Melious-Züge (nicht je Chat).
- Verbrauch: Maximum aus größtem Ergebnis und Summe der Einzelantworten (lieber zu viel als zu wenig zählen).
- Deckel-Abbruch = Ausgang `rate_limit` (ein Strang setzt sich danach nicht selbst fort), nicht `limit`.
- Kontotest mit dem Modell aus der Einrichtung.
- Offen (im echten Test prüfen): Wechsel Melious ↔ Claude mitten im Zug setzt die Sitzung fort — ob das mit Melious-Antworten im
  Verlauf trägt, zeigt erst der echte Zug.

## Schnitte
1. Brücke `accounts.ts`: `Account.kind/model/rest/fallback`, `planQueue()` (Claude-Reihenfolge wie heute, Melious vorne bei
   Chat-Schalter, hinten bei „letzter Ausweg“, nie bei `rest<=0`), `accountEnv()` (Melious: `ANTHROPIC_BASE_URL`,
   `ANTHROPIC_API_KEY`, `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`, ohne `CLAUDE_CODE_OAUTH_TOKEN`; Claude: wie heute),
   Chat-Schalter im Zustand `melious-chats.json`, Zähler für `/health`.
2. Brücke `sessions.ts`: Env/Modell je Versuch über `accountEnv`, Statuszeile „über Melious (Open-Weight-Modell, Ergebnisse
   prüfen)“, Melious-Fehler (rate_limit, billing_error, authentication_failed, 401/402/429 im Text) → erschöpft wie Claude,
   Verbrauch je Versuch an die Werkbank (`/internal/melious-usage`), Deckel-Abbruch, Befehl `/melious an|aus|status`.
3. Werkbank: Speicherung wie die Claude-Konten (AES-GCM in `werkbank.creds.melious`), Einrichtung (Schlüssel, Schalter, Grenzen,
   Test, Verbrauch), `/internal/claude-accounts` liefert Melious mit `rest`, `/internal/melious-usage` zählt und warnt,
   `/api/melious/usage` für die Kachel „Melious heute / Monat“ auf der Hauptchat-Seite.
4. Tests: Kontowahl und Env (rein), Brücke im Mock-Modus (Schalter, letzter Ausweg, Deckel, Fehler → Wechsel, kein Schlüssel im
   Log), echte Brücke + echtes Claude Code gegen einen lokalen Melious-Stub (`/v1/messages`), Werkbank-Zählung/Deckel.

## DoD
- Ohne Einschalten ändert sich nichts (bestehende Tests grün, Melious nie in der Warteschlange).
- Melious-Zug: Env wie oben, Statuszeile sichtbar, Verbrauch gezählt, `/health` zählt Züge ohne Schlüssel.
- 80 %/100 % wie oben; gesperrt = nicht in der Warteschlange, Meldung auf Deutsch.
- Schlüssel nie im Log, nie im Browser (nur ••••+4), nie im Repo.

## Rückweg
Global-Schalter aus (oder Schlüssel entfernen) → Melious ist aus jeder Warteschlange verschwunden; Code-Rückweg: Commit zurücknehmen,
`werkbank.creds.melious` und `werkbank.melious_usage` können bleiben (werden ignoriert).

## Council (kurz)
- Skeptiker: „letzter Ausweg“ automatisch = Melious für alles, was nachts läuft (Auto-Weiter der Stränge) → eigene Einstellung, aus.
- Sicherheit: Schlüssel geht nur an die Basis-URL; `ANTHROPIC_API_KEY` wird vor jedem Claude-Versuch wieder entfernt; Sitzungs-Env
  bleibt geschrubbt; MCP-Server (forge-review) behalten den Claude-Token.
- Betrieb: Fortsetzen einer Claude-Sitzung auf Melious (und zurück) teilt den Verlauf; Thinking-Signaturen könnten Melious stören →
  im echten Test prüfen, sonst bei Melious ohne Fortsetzen neu mit Verlauf.
- Bedingung: Deckel wirkt in der Brücke **und** in der Werkbank (Werkbank liefert `rest`, Brücke bricht ab).
