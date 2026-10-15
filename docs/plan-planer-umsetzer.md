# Plan 183: Planer–Umsetzer im Schattenbetrieb (Pilot, Council 180)

Stand: Plan am 15.10.2026. Auftrag von Knut am 15.10.: „Frontier-Modell GLM oder Opus plant und steuert und Quick-Modell setzt um … und
reported — wie implementieren wir diese bewiesene Logik wirklich?“
Grundlage: Council 180 (Urteil unten wörtlich), Kalibrierung 178 (jcode + glm-5.3-flash allein empfahl bei olaf-admin #343 ein
approve statt des Blockers; mit Prüfauftrag von glm-5.3 hat es den Blocker gefunden) und das Muster-Skript `review_any.py` aus diesem Lauf.

## Ziel
Für jeden Auto-Review des PR-Tickers läuft (eingeschaltet oder auf Knopfdruck) **daneben** ein zweiter, billiger Review-Weg:
glm-5.3 plant einen strukturierten Prüfauftrag, jcode mit glm-5.3-flash arbeitet ihn ab, die Werkbank prüft jedes Zitat
deterministisch, und glm-5.3 sieht sich nur die belegten Antworten noch einmal an. Das Ergebnis steht in der Review-Ansicht neben
dem bestehenden Review; Abweichungen sind markiert. **Es wird nie gepostet.** Je Stufe wird gemessen. Ein Skript vergleicht die
Wege später auf dem Evaluationsset (P6) — erst danach kann das Muster Standard werden.

## Council-Urteil 180 (bindend, wörtlich)
VERDICT: GO als Pilot im Schattenbetrieb, Standard erst nach Evaluationsset (Konfidenz 0,75)

| # | Bedingung | Quelle |
|---|---|---|
| P1 | **Strukturierter Auftrag** (JSON, ≤ 2 500 Zeichen): ziel, kontext inkl. Nachbar-Repos, 3–8 Prüffragen {id, frage, wo_suchen, schwere_falls_ja}, grenzen, fertig_wenn; Planer = glm-5.3 über direkte API, sieht **echte Diff-Ausschnitte**, nicht nur die Statistik | Spezialist, Advocatus 3 |
| P2 | **Fallstrick-Liste**: jeder bestätigte Befund aus Reviews (z. B. Zählpunkt 31/33 Zeichen über App-Grenze) wird als Fallstrick gesammelt und jedem passenden Auftrag mitgegeben | Advocatus 2 |
| P3 | **Pflichtantwort je Prüffrage** mit Status befund/kein_befund/unklar + Beleg datei:zeile + Zitat; Schweigen ≠ kein Befund; deterministische Zitatprüfung durch die Brücke | Spezialist |
| P4 | **Prüfregel Review:** Planer prüft jeden Befund hoch/mittel und jedes kein_befund zu Hoch-Fragen am Zitat; unklar blockiert approve; Widerspruch → strittig an Opus/Knut; im Pilot nie automatisch posten | Spezialist, Proponent |
| P5 | **Nicht für:** Geld/Tarif, Auth, Migrationen, Push/Merge, Council-Finalizer, Produktentscheidungen, Aufgaben < ~5k Tokens | Spezialist |
| P6 | **Evaluationsset vor Standard:** 25 PRs (≥ 8 mit echtem Blocker, inkl. #343) + 10 Recherche, drei Arme (Flash ohne / mit Auftrag / Opus), je 2 Läufe; Freigabe bei 0 Falsch-Approve im Blocker-Set, Recall ≥ 90 % der Opus-Hoch-Befunde, Energie ≤ 15 % des Opus-Wegs | alle |
| P7 | **Messung je Stufe** (Plan/Worker/Prüfung: Energie, Aufrufe, Cache, Urteil) im Zug-Protokoll; zweiter Worker-Weg (OpenCode oder Claude) als Ausfallpfad benannt | Advocatus 4+5 |

Hinweis aus dem Urteil: Eine harte Energie-Obergrenze je Strang hat Knut am 15.10. ausdrücklich abgelehnt („keine Grenze,
monitoren“). Gemessen wird trotzdem je Stufe.

## Plan-Challenge (glm-5.3, 15.10., ≈ 143 Energie) — eingearbeitet
Übernommen, weil im Plan nachgeprüft:
1. **P6 ist mit diesem Plan nicht erfüllt.** Der Pilot ist ausdrücklich **explorativ**. Der Schalter bleibt aus, bis Knut ihn
   setzt. Standard wird das Muster erst nach dem vollen Evaluationsset. Das Skript meldet die Energie des Opus-Arms nur als
   Schätzung und kennzeichnet sie so. Die Erkennungsmuster für den Recall gehören zum Regressionssatz; jeder Treffer steht mit
   seiner Fundstelle im Ergebnis, damit ein Mensch ihn gegenlesen kann.
2. **Diff-Ausschnitt deterministisch:** Die Diff-Statistik geht vollständig mit. Dazu kommen die Hunks je Datei in
   Git-Reihenfolge, je Datei höchstens 3 000 Zeichen, zusammen höchstens 12 000 Zeichen. Lock-Dateien und generierte Dateien
   fallen weg. Was gekürzt ist, wird ausdrücklich genannt.
3. **Nachbar-Repos:** Gelesen wird die Standard-Ref `origin/HEAD`, sonst origin/develop, origin/dev, origin/main. Das Alter des
   letzten Fetch steht im Kontext. Findet sich ein Zitat aus einem Nachbar-Repo nicht, heißt das „Zitat nicht gefunden“ →
   strittig (sperrt approve, wird aber nicht als unklar gewertet).
4. **Fallstricke:** höchstens 5, zuerst die des Repos, dann die per Stichwort, je höchstens 300 Zeichen. Ist der Auftrag
   ungültig (auch zu lang), gibt es **einen** zweiten Versuch mit der Fehlermeldung; erst danach ist es ein Fehler.
5. **P5 auch am Inhalt:** Neben den Pfaden wird auch der Diff-Text durchsucht (`ALTER TABLE`, `CREATE TABLE`, `migrate`,
   Login/Token/Session-Muster). Lock-Dateien zählen nicht zur Mindestgröße.
6. **Rennen und Aufräumen:** Ein Lauf wird nur aus `wartet` geclaimt, mit Kennung. Das Ergebnis wird nur geschrieben, wenn der
   Claim noch gilt; einen auf `fehler` gesetzten Lauf überschreibt es nicht. Der Schatten-Worktree wird im `finally` entfernt.
   Der Lauf prüft genau den Kopf des Reviews, und das Ergebnis trägt diesen Kopf.
7. **Blinde Flecken sichtbar:** Die Ansicht sagt, was nicht nachgeprüft wurde: kein_befund zu Mittel-/Niedrig-Fragen und
   Befunde „niedrig“.
Nicht übernommen: Retention/Graceful Shutdown (`zug_log` hat schon 30 Tage TTL; ein Lauf bricht nach 20 min jcode-Zeitlimit von
selbst ab); Alarm für „ausgefallen“ (im Pilot reicht der Chip im Ticker; ein Alarm gehört zum Standard-Betrieb).

## Wie die Bedingungen umgesetzt werden
| # | Umsetzung | Ort |
|---|---|---|
| P1 | `planeAuftrag(chat, art, {ziel, diffStat, diffAuszug, prText, fallstricke, nachbarn})` → glm-5.3, Antwort NUR als JSON (aus dem Text gelesen, ohne `response_format`, weil Melious das nicht für jedes Modell zusagt), 16 000 Tokens (GLM denkt zuerst). `checkAuftrag` prüft Felder, 3–8 Fragen, eindeutige Kennungen, Schwere hoch/mittel/niedrig und höchstens 2 500 Zeichen. Ist der Auftrag ungültig oder leer, ist das ein Fehler (Kalibrierung #345: der Auftrag kam leer und der Worker prüfte ohne ihn). Diff-Ausschnitt bis 12 000 Zeichen, Nachbar-Repos als Name + lokaler Klon | `web/server/planer.ts` (ohne Datenbank, damit das Evaluations-Skript ihn nutzen kann); Aufruf über `meliousChat` in `web/server/melious.ts` |
| P2 | Mongo-Sammlung `planer_fallstricke` {text, repos[], stichworte[]}; Startwert: Zählpunkt Tarif-App 31 Zeichen ohne AT, Admin/Durable 33 mit AT. Ein Fallstrick passt, wenn das Repo dazu gehört oder ein Stichwort im Diff steht. Neue Fallstricke legt Knut in der Schatten-Ansicht an, mit dem Knopf „als Fallstrick merken“ an einem bestätigten Befund | `web/server/planer.ts`, `web/server/main.ts`, `web/src/prticker.tsx` |
| P3 | Der Worker liefert als letzten Block JSON `{empfehlung, antworten[{id, status, beleg, zitat}], befunde[{titel, schwere, beleg, zitat, szenario, fix}]}`. Fehlt die Antwort zu einer Frage, gilt sie als `unklar` („keine Antwort“). `pruefeZitate` sucht das Zitat (ohne Leerraum-Unterschiede) in Datei:Zeile ± 3, im PR-Worktree oder in einem Nachbar-Repo (Datei auf der Platte, sonst `git show origin/develop|dev|main:pfad`) | `web/server/planer.ts` |
| P4 | Danach sieht glm-5.3 nur die Antworten, die geprüft werden müssen (Befund hoch/mittel, kein_befund zu Hoch-Fragen), mit dem Ergebnis der Zitatprüfung, und urteilt je Antwort: bestaetigt, verworfen oder strittig. `urteilAbleiten` ist deterministisch: Ein bestätigter Befund „hoch“ ergibt request-changes, „mittel“ ergibt comment. `unklar`, ein fehlendes Zitat oder ein strittiges Urteil sperren approve und kommen in die Liste „strittig“ für Opus/Knut. Weicht die Empfehlung vom bestehenden Review ab, wird das markiert. Der Schattenweg hat keine Posten-Funktion | `web/server/planer.ts`, `web/server/schatten.ts` |
| P5 | `p5Grund(dateien, diff)`: Migrationen, Auth, Geld/Tarif/Abrechnung (an Pfaden) und Diffs unter 1 500 Zeichen werden übersprungen, mit Grund. Wer messen will, setzt `WERKBANK_SCHATTEN_P5=messen`: Der Lauf geht dann trotzdem, trägt aber den Vermerk „P5“. Push/Merge, Finalizer und Produktentscheidungen kommen im Review-Pfad nicht vor | `web/server/schatten.ts` |
| P6 | `scripts/planer-eval.ts` + `docs/planer-eval/regression.json` (#343/#335/#345 mit den Opus-Urteilen aus Paket 170 und Erkennungsmustern für die Opus-Befunde „hoch“). Drei Arme: `flash-ohne`, `flash-mit`, `opus` (das Opus-Urteil liegt als Referenz vor und wird nicht neu gerechnet), je `--laeufe 2`. Ausgabe: Falsch-Approve, Recall, Energie im Verhältnis zur Opus-Schätzung | `scripts/`, `docs/planer-eval/` |
| P7 | `stufen[]` je Schattenlauf {stufe plan/worker/pruefung, modell, energie, aufrufe, input, cache, output, ms, urteil}, außerdem je Stufe ein Eintrag in `zug_log` (`art: worker`, Phase `schatten-*`, neue Felder aufrufe, cache, urteil) und die Buchung in `melious_usage`. Ausfallpfad: Geht jcode oder Melious nicht, endet der Lauf als `ausgefallen`, mit dem Vermerk „Ausfallpfad: Claude-Worker über delegieren (rolle leser)“. Im Schattenbetrieb wird er nicht automatisch gestartet, damit kein Claude-Kontingent verbraucht wird | `web/server/schatten.ts`, `web/server/messung.ts` |

## Ablauf
1. `reviewTick` startet wie bisher den Review-Strang. Ist der neue Ticker-Schalter **„Schatten-Review“** an (Vorgabe: aus), steht
   `schatten.status = wartet` am Review. In der Review-Ansicht setzt der Knopf „Schatten-Review starten“ dasselbe.
2. `schattenTick` (im selben Minutentakt) holt höchstens einen wartenden Lauf. Der Lauf läuft im Hintergrund weiter, der Takt
   wartet nicht. Ein Lauf, der nach 45 Minuten noch auf `läuft` steht, wird zu `fehler`.
3. Ein eigener Worktree `…-schatten` wird angelegt, damit sich der Lauf nicht mit dem Review-Strang ins Gehege kommt. Die
   Basis-Ref wird geholt (`baseRefName` aus GraphQL), der Diff wird erzeugt, dann kommt die P5-Prüfung.
4. Die Pipeline in `planerReview` läuft ohne Datenbank, damit das Evaluations-Skript dieselbe nutzen kann: Symlink-Prüfung des
   PR-Stands (führt ein Symlink hinaus, startet nichts) → Fallstricke → planeAuftrag → jcode → Lese-Gurt → parseBericht →
   pruefeZitate → planerPruefung → urteilAbleiten.
   Der Worker (jcode, glm-5.3-flash) läuft **ohne Shell** (`read,agentgrep`), in einem eigenen Wegwerf-HOME mit nur dem
   Melious-Profil (keine MCP-Server, kein Gedächtnis, keine Anmeldedateien, `--no-update`, keine Telemetrie) und in einem neutralen
   tmp-Ordner als Arbeitsordner. Dort liegt der Diff als Datei; den PR-Stand liest er über den absoluten Pfad. Der **Lese-Gurt**
   prüft danach alle read-/agentgrep-Pfade aus der Sitzungsdatei gegen PR-Stand, tmp und Nachbar-Repos. Ein Pfad außerhalb, ein `..`,
   ein fremdes Werkzeug, eine fehlende Sitzung oder eine Sitzung ohne Lese-Aufruf heißt: Das Ergebnis wird verworfen (fail-closed).
5. Das Ergebnis geht an `pr_reviews.schatten` und als `schatten.md` ins Review-Paket. In der Review-Ansicht steht der Abschnitt
   „Schatten-Review (Pilot)“ unter dem bestehenden Review, im Ticker ein Chip.

## Schnitte (je Schnitt Tests)
1. planeAuftrag + checkAuftrag (P1)
2. Fallstricke (P2)
3. Bericht-Schema, Zitatprüfung, Prüfregel (P3/P4)
4. Schattenpfad im Ticker + Ansicht (P4/P5)
5. Messung (P7)
6. Evaluations-Skript (P6), Test mit einem PR (#343)

## Einstellungen
| Name | Wo | Wert | Wer |
|---|---|---|---|
| Ticker-Schalter `schatten` | Mongo `meta` (Ticker-Einstellungen) | aus | Knut in der Ticker-Kachel |
| `WERKBANK_SCHATTEN_P5` | `.env.local` | leer (P5 überspringt); `messen` = trotzdem laufen, mit Vermerk | Knut, nur für Messungen |
| `WERKBANK_NACHBAR_REPOS` | `.env.local` | Vorgabe: Ordner unter `~/work`, die so heißen wie das Repo (olaf-admin, olaf-tariff-app, olaf-durable-func, olaf-calc-api) | bei Bedarf |
| `WERKBANK_JCODE_BIN` | `.env.local` | Vorgabe `~/.local/bin/jcode` | — |
Keine Infra-Änderung (die Werkbank läuft lokal, nichts in Bicep).

## Nicht in diesem Plan
- Brücke/`delegieren` mit Pflicht-Auftrag (Spezialist, Baustein 1/3/4): Das kommt erst nach dem Evaluationsset, wenn das Muster
  Standard werden soll.
- Automatisch posten, die Rückfrage an deepseek bei Widerspruch und die Abbruchregel (Überstimmung > 30 %): erst nach dem Pilot.
- Das volle Evaluationsset (25 PRs + 10 Recherche): Es läuft erst, wenn Knut es freigibt.

## Review (Phase 4) — was die Pässe fanden und wie es geändert wurde
Pass B lief als Claude-Prüfer (fünf Blickwinkel), Pass C als Gegenprüfung mit glm-5.3. Es gab sechs Runden; nach jedem Fix liefen
alle Pässe erneut auf dem neuen Stand.
- **Runde 1 (FAIL):** Ein kein_befund zu einer Hoch-Frage, das der Planer verwarf, ergab approve (der #343-Fall). Die Zitatprüfung
  ließ sich trivial erfüllen (beliebig großer Bereich, Zitat aus 4 Zeichen). Ein Symlink konnte aus der Wurzel herausführen. Der
  Eval-Recall wurde über den Auftragstext verzerrt. Es fehlte ein SIGKILL. Git-Läufe im gemeinsamen Klon kamen sich in die Quere.
  Der Schalter hielt die Warteschlange nicht an. Die P5-Muster waren zu eng. → Alles behoben, je mit Regressionstest R1–R11.
- **Runde 2 (FAIL):** Umgebungsvariablen sind keine Sperre. Eine Shell unter Knuts Nutzer erreicht die Vaultwarden-Sitzung (und
  über `bw` und `curl` GitHub) und die gemeinsame Klon-Konfiguration (Codeausführung beim nächsten Fetch des Servers). → Der
  Schatten-Worker läuft **ohne Shell** (`read,agentgrep`) und bekommt den Diff als Datei. Kindprozesse werden über die
  Prozessgruppe beendet. Ein Zitat braucht ein zusammenhängendes Stück von mindestens 12 Zeichen. Fragen-Kennungen `B<n>` sind
  verboten (sie kollidierten mit den Befunden).
- **Runde 3 (FAIL):** jcode lädt MCP-Server aus Knuts `~/.claude.json` (atlassian, compartment) und **projektlokal aus dem
  Arbeitsordner** (`.mcp.json` im PR-Worktree → ein PR hätte einen Befehl starten können). Belegt mit `jcode mcp list`. → Eigenes
  Wegwerf-HOME/JCODE_HOME, `JCODE_DISABLE_CLAUDE_MCP=1`, neutraler Arbeitsordner, und ein Wächter lehnt Arbeitsordner mit
  `.mcp.json`/`.jcode`/`.claude` ab. In Eltern-Ordnern sucht jcode nicht (geprüft).
- **Runde 4 (PASS-WITH-CONCERNS):** `read` liest beliebige absolute Pfade (Abfluss an Melious/Mongo). → Lese-Gurt über die
  Sitzungsdatei, `--no-update`, keine Telemetrie, Kill der Prozessgruppe auch bei `error`, Aufräumen bei frühem Fehler, Ctrl-C im
  Eval-Skript.
- **Runde 5 (Gurt umgehbar):** Symlink + `..` und `**`-Globs durch Symlinks; fail-open bei fehlender Sitzung. → `..` ist immer ein
  Verstoß, fremde Werkzeuge auch, fehlende oder leere Sitzung heißt verwerfen; Symlinks nach außen im PR-Stand verhindern den Lauf;
  die Prüfung läuft, bevor tmp gelöscht wird; der Eval-Arm hat denselben Gurt.
- **Runde 6 (Bestätigung):** Befunde aus Runde 5 sind geschlossen. Restrisiken: siehe unten.

### Restrisiken bis zur Sandbox (D2)
- `read` kann vor dem Gurt alles lesen, was Knuts Nutzer lesen darf. Was der Worker liest, sieht Melious (Dritter), auch wenn das
  Ergebnis danach verworfen wird.
- Globs in Nachbar-Repos (Knuts eigene Klone, nicht PR-Inhalt) folgen dort vorhandenen Symlinks; die Nachbarn werden nicht gescannt.
- **Derselbe Befund gilt für den Brücken-Worker aus Release 16b** (`BRIDGE_WORKER_JCODE=on`, mit bash/write/edit). Das wurde dem
  Hauptchat als Risiko gemeldet; die Entscheidung liegt bei Knut (D2).

## Entscheidungen offen (Knut)
- D1 Schalter „Schatten-Review“ einschalten — Empfehlung: erst nach den Testläufen mit dem Skript, vorher einzelne PRs von Hand.
- D2 Sandbox für Worker mit Shell (bubblewrap, braucht sudo) — betrifft auch den Brücken-Worker 16b. Empfehlung: installieren;
  bis dahin Schatten-Worker ohne Shell und `BRIDGE_WORKER_JCODE` aus.
- D3 P5 im Schattenbetrieb: überspringen (Vorgabe) oder messen — Empfehlung: Vorgabe; `messen` nur für das Evaluationsset.
- D4 Die drei echten Testläufe (#343, je Arm einmal) startet Knut selbst, mit dem Melious-Schlüssel aus Vaultwarden (Befehl im Bericht).
- D5 Fallstrick-Liste in Mongo statt im Vault — Empfehlung: Mongo für den Pilot, Export in den Vault, wenn das Muster Standard wird.

## Rückweg
Schalter `schatten` aus. Der Schattenweg schreibt nur `pr_reviews.schatten`, `planer_fallstricke`, `zug_log` und `schatten.md`.
Den bestehenden Review-Weg ändert er nicht.
