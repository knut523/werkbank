# Plan: Tempo-Leck in Bau-Strängen und Gate (Werkbank 2.1)

Stand 08.11.2026 · Auftrag Knut: „best solution? use plan to pr no patches“ · Track: Bug (plan-to-pr Phase B)

## Problem (Nutzersicht)

Ein Bau-Punkt mit ≈ 5 min echter Arbeit stand heute > 60 min in der Schleife. Ein Testlauf des Bauers hing
41 min. Das Gate brauchte einen Ausschluss (`leitstand.test.ts`), weil es „in Worktrees hängt“.
Gleichzeitig laufende Stränge (Bauer, Gegenprüfer, Gate) blockieren sich gegenseitig oder prüfen das Falsche.

## Ursachen (belegt, nicht vermutet)

| # | Ursache | Beleg |
|---|---|---|
| U1 | 23 Tests (17 Bridge, 6 Web) binden feste Ports oder Env-Fallbacks (`|| 3193`) (`PORT = 3497`, `OC2_PORT = 47871` …). Zwei parallele Läufe: der zweite findet den Port belegt, sein `/health` trifft die **Brücke des anderen Laufs** → hängt oder prüft fremden Zustand. | Repro: `oc2-strang-bruecke.test.ts` zugleich in zwei Worktrees → einer grün 15 s, der andere rc=124 nach 120 s, 3/3 rot. Einzeln: grün 15 s. Web `leitstand.test.ts` fällt auf 3173/3193 zurück — dort laufen hier der Test-Admin und die **Live-Brücke 2.0**: der Test prüfte gegen eine fremde, laufende Instanz. Betroffen Bridge: melious-budget, accounts, auto, bridge, abbrechen-schlange, ensemble-bruecke, delegation, guard-strang-waechter, leitstand, melsub, melious, melious-stub, oc2-strang-bruecke, opencode2-bruecke, release, orchestrator-agents, worker-jcode. Web: leitstand, api, orchestrator, cosics-route, r31-route, jira-mock (Helfer). |
| U2 | `shellPruefung` (`bauerrennen.ts`) nutzt `exec(…, { timeout })`: beim Timeout stirbt nur `/bin/sh`, `node --test` und seine Testprozesse laufen weiter und halten Ports/CPU. Deckel 15 min. | Code `bauerrennen.ts:127`; Node-Doku: `timeout` sendet das Signal nur an den direkten Kindprozess. |
| U3 | `mitDeckel` gibt nach Deckel ein Ergebnis zurück, bricht den Bauer aber **nicht** ab („läuft im Hintergrund aus“). Er belegt weiter einen OC2-Platz, verbraucht Melious-Budget und schreibt in seinen Unter-Worktree. | Code `bauerrennen.ts:105–111`, `bauerstrang.ts:61–68` (`o.zug` ohne Abbruchsignal). |

**Kausalkette des 41-min-Hängers (Council-Bed. 4).** Prozess `node --test test/abbrechen-schlange.test.ts … oc2-strang-bruecke.test.ts`, Start 18:30, cwd `sp-uebergabe-letzte-b`, gestartet vom Bauer über jcodes Detach (`bash -lc $JCODE_RELOAD_DETACH_COMMAND`, Elternprozess PID 1). Zur selben Zeit liefen in Nachbar-Worktrees Gegenprüfer- und Gate-Läufe derselben Dateien. Hängend: `oc2-strang-bruecke.test.ts` → U1 (Port 3497 belegt, `/health` antwortet die fremde Brücke, der Test wartet auf Ereignisse, die dort nie kommen). Ohne `--test-timeout` im Bauer-Befehl kein Ende; der Detach entzog ihn dem Deckel des Gerüsts (U2-Klasse, hier im Gerüst). Einzeln und nach Beenden der Nachbarn: grün in 15 s. Vierte Kandidatin des Councils (Semaphor-Warteschlange × `maxMs` 600 s in `bestofnPruefe`) war an diesem Ereignis **nicht** beteiligt — das Gerüst nutzt den Produkt-Semaphor nicht; sie wird in der Gesamtabnahme gemessen (Wartezeit je Prüfung im Ledger) und wird ein eigener Punkt, falls > 10 % der Wanduhr.

Nicht im Produkt, nur im Mess-Gerüst (`schleife.sh`, jcode/mel-sub): fehlendes Fertig-Signal → Leerlauf bis Deckel.
Das Produkt hat das Signal bereits (`laeufer.ts`: OC2-Sitzung „ruhig“ → fertig; Timeout → `interrupt`).
**Keine weiteren Flicken am Gerüst**; die Strang-Prüfschleife zieht als eigener Punkt ins Produkt (`bauerstrang.ts`, Council-Bedingung aus `council-strangpruefung-0811.md`), danach läuft jede Messung über den echten Weg.

## Mini-Specs

- **U1** Alt: Test bindet festen Port, parallele Läufe kollidieren. Richtig: jeder Test holt sich freie Ports vom Betriebssystem; beliebig viele Läufe parallel, jeder prüft nur seine eigene Brücke.
- **U2** Alt: Timeout tötet nur die Shell. Richtig: Prüfbefehl läuft in eigener Prozessgruppe; Timeout oder Ende tötet die ganze Gruppe; kein Prozess des Befehls überlebt.
- **U3** Alt: Deckel → Ergebnis „deckel“, Bauer läuft weiter. Richtig: Deckel → Bauer erhält Abbruch, OC2-Sitzung wird unterbrochen (`interrupt`), Platz und Budget frei.

## Punkte (je ≤ 3 Dateien, 1 neue Schnittstelle)

| Punkt | Inhalt | Dateien | Routing |
|---|---|---|---|
| P1 | Helfer `freiePorts(n)` (listen(0), Port lesen, schließen) + umstellen: oc2-strang-bruecke, leitstand | `test/port-hilfe.ts` (neu), 2 Tests | Flash-Paar |
| P2 | umstellen: accounts, auto, bridge | 3 Tests | Flash-Paar |
| P3 | umstellen: abbrechen-schlange, ensemble-bruecke, delegation | 3 Tests | Flash-Paar |
| P4 | umstellen: guard-strang-waechter, melsub, melious | 3 Tests | Flash-Paar |
| P5 | umstellen: melious-stub, opencode2-bruecke, release | 3 Tests | Flash-Paar |
| P6 | umstellen: orchestrator-agents, worker-jcode, melious-budget | 3 Tests | Flash-Paar |
| P6w | Web: Helfer nach `web/test/port-hilfe.ts` + leitstand, api | 3 Dateien | Flash-Paar |
| P6x | Web: orchestrator, cosics-route, r31-route (+ jira-mock, falls Port fest) | ≤ 3+1 Dateien | Flash-Paar |
| P6z | Gate-Prüfschritt: neue/geänderte Tests ohne feste Ports oder Port-Fallbacks (`PORT = 1234`, `\|\| 1234`); Testdeckel 240 s neu messen und auf gemessenen Einzellauf × 2 setzen | abnahme.sh | Flash-Paar |
| P7 | `shellPruefung` → `pruefLauf(cmd, args[], …)`: `spawn` **ohne Shell** mit Argumentliste, `detached: true`, Timeout/Ende → `process.kill(-pid, 'SIGKILL')`; `betroffeneTests` übergibt Dateinamen als Argumente (Pass C bridge #1: Shell-Injection über Dateinamen aus dem Bauer-Diff) | `bauerrennen.ts`, `bauerstrang.ts` + Test | Sonnet (Sicherheit, 2 Aufrufer) |
| P8 | Abbruch durchreichen: `Deps.bauen(…, { signal })`, `mitDeckel` bricht bei Deckel ab, `bauerstrang` reicht an `o.zug` → `laeufer` `abbruch` → `interrupt` | `bauerrennen.ts`, `bauerstrang.ts`, `sessions.ts` + Tests | Sonnet (dateiübergreifend, nicht sauber schneidbar) |

Reihenfolge: P1 zuerst (Helfer), P2–P7 parallel danach, P8 parallel zu allem.

## DoD (wörtlich, je Punkt prüfbar)

- **P1–P6x:** In den umgestellten Dateien steht **keine** feste Portnummer mehr — alle Namen, nicht nur `PORT` (`OC2_PORT`, `OFF_PORT`, `AUTO_PORT`, `BRIDGE_PORT` …): `grep -E "[A-Z_]*PORT\s*=\s*[0-9]{4,5}|\|\| ?[0-9]{4,5}\)"` leer (Council-Bed. 2). Jede umgestellte Datei läuft **zweimal gleichzeitig** aus zwei Worktrees grün, und zwar so schnell wie ein Einzellauf (± 50 %). Vorher-Beleg: derselbe Doppellauf war rot (rc=124).
- **P6z:** Ein Test mit `const PORT = 3999` lässt das Gate rot werden (Probe vorher rot/nachher grün). Web-`leitstand.test.ts` läuft im Gate mit, Einzellaufzeit gemessen und im Kommentar in `abnahme.sh` belegt (Council-Bed. 3: es gibt keinen Ausschluss in `abnahme.sh`; das Pflaster war der hochgesetzte Deckel mit Begründung „leitstand ~2 min“).
- **P7:** Eine Testdatei namens `x$(touch PWNED).test.ts` im Diff führt **nichts** aus (`PWNED` existiert danach nicht; vorher rot). `process.kill(-pid, …)` in try/catch (ESRCH/EPERM: Gruppe schon tot ist kein Fehler; Council-Bed. 5), eigener Test dafür. Test: ein Prüfbefehl, der einen Enkelprozess mit `sleep 600` startet, und ein Timeout von 2 s → nach Rückkehr existiert **kein** Prozess der Gruppe mehr (`kill -0` scheitert). Test war vor dem Fix rot.
- **P8:** Test: `rennen` mit Deckel 50 ms und einem Bauer, der nie fertig wird → nach Rückkehr wurde sein Signal abgebrochen, `zug` hat `interrupt` gesehen (Fake-OC2). Unter-Worktree wird erst entfernt, nachdem der Abbruch bestätigt ist; der Fake-Bauer schreibt nach dem Entfernen nicht mehr hinein (Council-Bed. 6). Bestehende `bauerrennen`/`bauerstrang`-Tests grün. Test war vor dem Fix rot.
- **Alle:** `tsc` Bridge 0 Fehler, Web nicht über 56 (Ausgangswert); `abnahme.sh` grün; Gegenprüfer-Schleife konvergiert.

## Abnahme gesamt (Messung gegen `messpunkt-tempo-0811.md`)

Volle Bridge-Testsuite zweimal gleichzeitig (zwei Worktrees) grün, ohne Ausschluss, Laufzeit ≤ 1,5 × Einzellauf.

## Customer impact & process

Kein Kundenbezug (internes Werkzeug). Prozess: Bau-Stränge laufen parallel ohne gegenseitige Störung; Gate-Ergebnisse sind wieder verlässlich (heute kann ein grüner Lauf die Brücke eines anderen Laufs geprüft haben); abgebrochene Bauer verbrauchen kein Budget mehr.

## Infra

Keine neue Einstellung. `BRIDGE_BAUER_DECKEL_S` existiert bereits.

## Außerhalb

- glm-5.3-Stufe im Retry (Council: streichen) — eigener Punkt.
- Strang-Prüfschleife ins Produkt — eigener Punkt nach diesem Plan.

## Pflaster-Inventur 08.11. (Knut: „wir patchen nicht, wir suchen dauerhafte Lösungen“)

Jedes Pflaster dieses Baus mit Ursache und dauerhafter Lösung. Ein Pflaster bleibt nur, bis sein Punkt gemergt ist; dann wird es entfernt.

| Pflaster | Eigentliche Ursache | Dauerhafte Lösung | Punkt |
|---|---|---|---|
| Testdeckel 240 s „weil leitstand ~2 min“ | feste Ports (U1), Laufzeit nie gemessen | freie Ports, Deckel aus Messung | P1, P6w, P6z |
| Frühstopp nach 90 s Ruhe in `schleife2.sh` | Gerüst ohne Fertig-Signal (Produkt hat es) | Strang-Prüfschleife ins Produkt (`bauerstrang.ts`, OC2-Ruhe-Signal) | eigener Punkt nach diesem Plan |
| Verwaiste Testprozesse von Hand getötet | Timeout tötet nur die Shell (U2) | Prozessgruppe + Gruppen-Kill | P7 |
| Gedeckelter Bauer läuft aus | kein Abbruchsignal (U3) | Signal bis `interrupt` | P8 |
| Geplant: „Basis-rote Tests als vorbestehend markieren“ | `bridge.test.ts` #19 (Skill-`readlink`) ist in Worktrees rot | **gestrichen** — Ursache des roten Tests finden und beheben | neu: P9 (Diagnose zuerst) |
| `tsc` Web: nur neue Zeilen zählen (56 Altfehler) | 56 echte Typfehler im Web | Altfehler abbauen, danach voller tsc-Lauf im Gate | neu: P10 (eigener Plan, nach Release) |
| Agenten können in Worktrees kein `tsc` laufen lassen | Worktree ohne installierte Abhängigkeiten | Worktree-Anlage installiert Abhängigkeiten (oder teilt `node_modules` verlinkt) | neu: P11 |
| Pass C in zwei Hälften geteilt | Prüfer bekommt den ganzen Diff auf einmal | Review-Kette schneidet Diffs nach Modulgrenzen fest ein (Teil des Ablaufs, kein Einzelfall) | neu: P12 |

## Council 08.11. (glm-5.3, zweites Modell)

VERDICT: HOLD (0,85 Ursachen / 0,5 Vollständigkeit 41 min). Bindende Bedingungen 1–6 eingearbeitet: 1 melious-budget ergänzt · 2 alle Port-Namen im DoD · 3 Ausschluss existiert nicht, P6z korrigiert · 4 Kausalkette oben · 5 kill in try/catch · 6 Worktree erst nach bestätigtem Abbruch entfernen.
