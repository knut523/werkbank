# Plan Release 32 „Übersicht klar“

Stand 03.11.2026 · Auftrag Knut (UX-Test 422: zehn Befunde) + Nachträge vom selben Tag: **A** Antworten mit eigenem Text zuverlässig,
**B** „Fang hier an“, **C** Aufräumen, **D** ehrliche Zahl, **Nachtrag 2** „Was ist das?“ an jeder Karte. Basis `release/werkbank-2026-11-02c`
(= Live R31b). Nichts davon braucht einen neuen Schalter, damit es nach Live wirkt; ein Not-Aus ist `WERKBANK_FRAGEN_AUFRAEUMEN=0`.

## Ziel

Knut öffnet die Übersicht und sieht: eine Zahl, höchstens fünf Dinge zum Anfangen, jede mit Empfehlung und einem Klick oder eigenem Text
zum Antworten — und kann an jeder Karte den Hauptchat fragen, was das ist. Dieselbe Zahl steht in Übersicht, Entscheidungsseite, Leiste und
Morgenlage, und jede Zahl führt auf eine Liste mit genau so vielen Einträgen.

## Bausteine (Dateien)

| Befund / Nachtrag | was | wo |
|---|---|---|
| 1, D — eine Zahl | `brauchtSumme()` (Fang + Heute + Offen + Sonstiges = `inboxZahl`), Text „22 offen = 5 Fang hier an + 14 Fragen + 3 Sonstiges“; Pille öffnet die Entscheidungsseite; Roadmap-Spalte heißt „Offene Fragen in Specs“ | `server/entscheidungsseite.ts`, `server/main.ts`, `src/pages/Uebersicht.tsx`, `src/pages/Roadmap.tsx` |
| 3 — Klartext, passende Knöpfe | `klartext()` (kein Markdown), vollständige Frage, `frageForm()` → `janein` / `wahl` / `frei`, Empfehlung aus „Empfehlung: …“, „Keine Empfehlung — du entscheidest“ | `server/klartext.ts`, `server/entscheidungsseite.ts`, `server/inbox.ts`, `src/pages/Entscheidungen.tsx` |
| 2 — Handy | Platzhalter für Fang hier an, Morgenlage und Kontingentzeile; Entscheidungen vor dem Hauptchat-Kasten | `src/pages/FangHierAn.tsx`, `src/pages/Morgenlage.tsx`, `src/kontingent.tsx`, `src/styles.css` |
| 5 — Strang-Karten | `blockiertSatz()` (Warum + Was du tun sollst aus „Braucht dich“), kein doppelter Titel, Modelltext statt „unbekannt“ | `server/uebersicht.ts`, `src/pages/Uebersicht.tsx` |
| 6 — Heute fertig | `fertigHeute()` (eine Quelle für Lage und Übersicht), Block „Heute fertig“ mit Ergebnis-Satz + Link, Tagesabschluss mit Listen, „Fertig“ in der Leiste offen bei ≤ 3 | `server/lage.ts`, `src/pages/Morgenlage.tsx`, `librechat/overlay/…/HauptchatSection.tsx` |
| 7 — Mein Tag | Karte „Mein Tag“ (Vorschlag) in der Übersicht, Reiter „Mein Tag“ unter Planen | `src/pages/TagesKarte.tsx`, `src/App.tsx` |
| 8 — PR-Lage | `prKopf()`: Reiter zählt offene PRs, Kopfzeile „n offen · n Konflikt · n warten auf dich“ klickbar, Stand älter als 24 h rot | `src/buckets.ts`, `src/pages/Roadmap.tsx` |
| 9, 10 — Kürzel, Zahlen | Titel ohne „olaf — Spec:“, eine Spec nur einmal, Tooltips für `#6`, `❓`, Zusagen-Kennung; „59 Meldungen“ als Link; Bericht-Name am Handy | `src/buckets.ts`, `src/pages/Roadmap.tsx`, `src/pages/Uebersicht.tsx`, Overlay |
| 4 — „wichtig“ | nur mit Grund (hält einen Unter-Chat an), sonst „offen“; Einstufung selbst (Sortierung, nie automatisch annehmen) bleibt | `server/entscheidungsseite.ts` |
| A — Freitext | Text im Feld = Antwort („Anders“), Enter sendet, Bestätigung „an den Strang „X“ geschickt“ (`ziel`), Wortlaut bis 4000 Zeichen (vorher 600/1000), Notiz zu Ja/Nein geht mit, Optionsknopf = echte Option, Freitext auf Deckel-/Budget-Fragen geht an den Strang | `server/main.ts`, `server/orchestrator.ts`, `server/leitstand.ts`, `server/fragenpaket.ts`, `src/pages/*` |
| B — Fang hier an | `fangHierAn()` (blockiert > Frist > Kund:innen > Geld/Recht > wartet lange; ≤ 5), `FangKarte` mit „✓ Wie empfohlen“, Optionsknöpfen, Textfeld; Rest nach Thema zugeklappt mit „alle n wie empfohlen“ je Thema | `server/entscheidungsseite.ts`, `src/pages/FangHierAn.tsx`, `src/pages/Entscheidungen.tsx` |
| C — Aufräumen | `schliessGrund()`/`fragenAufraeumen()` schließen Fragen erledigter/abgelegter/nie gestarteter Stränge mit Grund (Takt alle 10 min, Log-Zeile); alte Deckel-Fragen (> 7 Tage, Strang läuft nicht mehr) = EIN Sammel-Eintrag mit Knopf | `server/fragenaufraeumen.ts`, `server/inbox.ts`, `server/main.ts` |
| 2 — Was ist das? | `nachfrageText()` + `POST/GET /api/nachfrage`: der Hauptchat bekommt Frage, Strang, letzten Stand, Optionen, Empfehlung und antwortet in Klartext (lesend, „So entscheiden: …“); Antwort steht an der Karte; Entscheiden bleibt der Klick an der Karte | `server/nachfrage.ts`, `server/main.ts`, `src/nachfrage.tsx` |

| 4 — Routing | `routing.ts`: Klasse (kritisch / bauen / lesen) → Anbieter; kritisch immer Claude und bei Erschöpfung WARTEN; bauen Claude bevorzugt, Melious als Ersatz; lesen Melious bevorzugt, knapp → Claude Haiku; Hysterese (Spanne 10 %); Modell fest je Strang beim Start; „läuft auf X, weil …“ an der Karte, Meldung an den Hauptchat bei Ersatz/Warten/Übersteuern; `routing: claude\|melious` übersteuert je Strang (orch_start) | `server/routing.ts`, `server/orchestrator.ts`, `server/kontingent.ts`, `r32-routing` |
| 5 — Wahrheit | `wahrerLauf()`: „läuft“ nur mit Zug in der Brücke, sonst „Läuft nicht mehr: Grund“; Dokumente (PDF/PPTX/DOCX/XLSX/HTML) als Download-Links in Karte, Heute fertig, Lage; Übergabe (`- Übergeben an: …`) = eigener Zustand, keine „Braucht Knut“-Zeile; Seite „Heute erledigt“ (`#/erledigt`, `/api/erledigt?datum=`) | `server/strangwahrheit.ts`, `server/erledigt.ts`, `src/pages/HeuteErledigt.tsx`, `r32-wahrheit` |

## Schalter

Keine neuen Pflicht-Schalter. Vorgaben, damit es nach Live sofort wirkt:

| Schalter | Vorgabe | Wirkung |
|---|---|---|
| `WERKBANK_FRAGEN_AUFRAEUMEN` | an (nur `0` schaltet ab) | Takt schließt Fragen erledigter Stränge |
| `WERKBANK_ROUTING` | an (nur `aus` schaltet ab); `_LESEN` 5, `_BAUEN` 20, `_SPANNE` 10 | Routing nach Klassen statt reiner Prozent-Schwelle |
| `WERKBANK_BRAUCHT_DICH` | wie R31b (`an`) | „Was du tun sollst“ auf blockierten Karten nutzt dieselbe Einordnung |
| `WERKBANK_TAGESVORSCHLAG` | wie R31b | ohne ihn zeigt die Karte „Mein Tag“ nur „Tag planen“ |
| `WERKBANK_LAGE` | wie R31b | Lage-Seite (bekommt ebenfalls „Was ist das?“) |

## Tests

`web/test/r32-*.test.ts` (rein + Wegwerf-Mongo): Klartext/Form/Zahl/Fang/Ziel (`r32-entscheidungen`), Karten (`r32-karten`),
Heute fertig (`r32-fertig`), PR-Zahl und Roadmap-Kürzel (`r32-zahlen`), Aufräumen (`r32-aufraeumen`, `r32-aufraeumen-db`),
Nachfrage-Text (`r32-nachfrage`). E2E: `web/e2e/r32-uebersicht-shots.ts` (isolierte Instanz, Mock-LibreChat; vorher/nachher, 1440 + 390).
