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
| P1 | `planeAuftrag(chat, art, {ziel, diffStat, diffAuszug, prText, fallstricke, nachbarn})` → glm-5.3, `response_format` JSON, 16 000 Tokens (GLM denkt zuerst). `checkAuftrag` prüft Felder, 3–8 Fragen, eindeutige Kennungen, Schwere hoch/mittel/niedrig und höchstens 2 500 Zeichen. Ist der Auftrag ungültig oder leer, ist das ein Fehler (Kalibrierung #345: der Auftrag kam leer und der Worker prüfte ohne ihn). Diff-Ausschnitt bis 12 000 Zeichen, Nachbar-Repos als Name + lokaler Klon | `web/server/melious.ts`, `web/server/planer.ts` |
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
4. Die Pipeline in `planerReview` läuft ohne Datenbank, damit das Evaluations-Skript dieselbe nutzen kann: Fallstricke →
   planeAuftrag → jcode (`read,bash,agentgrep`, nur lesen) → parseBericht → pruefeZitate → planerPruefung → urteilAbleiten.
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

## Rückweg
Schalter `schatten` aus. Der Schattenweg schreibt nur `pr_reviews.schatten`, `planer_fallstricke`, `zug_log` und `schatten.md`.
Den bestehenden Review-Weg ändert er nicht.
