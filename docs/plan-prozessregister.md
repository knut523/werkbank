# Plan: Prozessregister — jeder Prozess sichtbar, kein Waise, Wächter greift selbst ein (Werkbank 2.1)

Stand 08.11.2026 · Auftrag Knut: „u should always see active strands and there should be an auto check in after time
or a monitor … we should not have orphaned strands … build quick and with high quality … but structural fixes“ ·
Track: Bug/Struktur (plan-to-pr Phase B) · ergänzt `plan-tempo-leck.md` (P1–P8), ersetzt dort nichts.

## Problem (Nutzersicht)

Heute lief ein Testprozess **4 h 10 min** als Waise (PID 1), hielt zwei Ports und blockierte einen Bau-Strang 10 min.
Ein gedeckelter Bauer lief nach seinem Deckel weiter. Niemand hat es gesehen: weder Werkbank noch Leitstand zeigen,
welche Prozesse zu einem Strang laufen, seit wann, bis wann, und wann sie zuletzt etwas getan haben.

## Strukturregel

**Ein Prozess, den die Werkbank nicht benennen kann, darf nicht existieren.** Jeder Kindprozess (Strang, Bauer,
Gegenprüfer, Prüf-/Testlauf, opencode-Server, Claude-CLI) startet über **einen** Starter, der ihn in eigener
Prozessgruppe startet und in ein Register schreibt (Besitzer, PID + Startzeit, Frist, letzte Aktivität). Aufräumen,
Wächter und Anzeige lesen **nur** aus diesem Register. Ein Gate-Check hält die Regel dauerhaft.

## Ursachen (belegt im Code, 08.11.)

| # | Ursache | Beleg |
|---|---|---|
| U1 | Es gibt kein Prozessregister; kein Strang kennt PID/PGID seiner Prozesse. | Audit: `lives`/`delegs`/`orch.json` ohne pid; nur `oc2server.ts` und `testlink.ts` führen PID-Dateien |
| U2 | jcode und `opencode run` bekommen nur SIGTERM auf den Hauptprozess, keine Gruppe, kein KILL → Enkel (bash-Tools, `node --test`) überleben. | `sessions.ts:2465-2471`, `:2589-2594` |
| U3 | `erzwinge` (Nachlauf-Zwangsende) gibt Konto frei und nimmt den Strang aus `lives`, beendet den CLI-Prozess **nicht** („der hängende Strom darf liegen bleiben“). | `sessions.ts:2018-2030` |
| U4 | Alle detached Gruppen (`run`, `pruefLauf`, reviewexec, gegenpruefung, testlink `ausfuehren`) haben nur Timer; bei Abbruch, Bridge-/Web-Neustart oder Absturz überleben sie (eigene PGID entkommt der `setsid`-Gruppe des Dienstes). | `delegation.ts:214-227`, `bauerrennen.ts:139-151`, `reviewexec.ts:53`, `gegenpruefung.ts:75`, `testlink.ts:209` |
| U5 | Stop/Restart tötet nur die PID, nicht die Gruppe; bei SIGKILL/Absturz laufen keine exit-Hooks. Web-Shutdown beendet kein Kind. | `werkbank.sh:171-176`, `server.ts:578-582`, `web/server/main.ts:5083` |
| U6 | Beim Start räumt niemand Prozesse eines früheren Laufs ab. | `sessions.ts:283-293` (nur orch.json + worktree prune) |
| U7 | „Abbruch unbestätigt“ wartet unbegrenzt, ohne harten Kill. `roadmapauto.ts:232` hat gar kein Timeout. Review-oc2-Server nutzen tmp-PID-Ordner, nach Absturz unauffindbar. | `bauerstrang.ts:105-111`, `roadmapauto.ts:232`, `sessions.ts:2882` |
| U8 | Kein Wächter prüft laufende Prozesse gegen Frist/Aktivität; Anzeige kennt weder Laufzeit noch Frist noch Prozesse. | Audit Abschn. 3–4; Leitstand-Seite aufgelöst (`Leitstand.tsx:1-4`), Arbeit zeigt nur Status/ETA/Zuletzt |

Wiederverwendbar (kein Neubau): `testlink.ts:159-172` `procStart`/`lebt`/`beenden` (PID + Startzeit, Gruppe TERM→KILL, nie fremde PIDs);
`reapIdle`-Takt 60 s (`sessions.ts:513`); `/internal/orch-state` als Feed; SDK-Option `spawnClaudeCodeProcess` (sdk.d.ts) für die CLI.

## Mini-Specs (alt → richtig)

- **Start** Alt: jede Stelle spawnt selbst. Richtig: `starte(cmd, args, { besitzer, art, fristMs, cwd, env })` startet immer in eigener Gruppe, trägt ein, schreibt Aktivität bei jeder Ausgabe, trägt beim Ende aus. Register liegt im Speicher und atomar (tmp + rename) in `<STATE_DIR>/prozesse.json`.
- **Ende** Alt: SIGTERM auf eine PID. Richtig: `beenden(id | besitzer)` → Gruppe TERM, nach Frist KILL; nur wenn PID **und** Startzeit passen.
- **Neustart** Alt: Waisen überleben. Richtig: beim Start liest der Dienst `prozesse.json` des Vorlaufs und beendet jede noch lebende eigene Gruppe; Stop-Skript tötet die Gruppe.
- **Wächter** Alt: niemand schaut. Richtig: Takt 60 s; Frist überschritten → Check-in (Status im Strang + Anzeige „überfällig“); + Gnadenfrist → `beenden`; keine Aktivität > Leerlaufgrenze → Check-in „still seit … min“.
- **Sicht** Alt: Status/ETA. Richtig: pro Strang Prozesse mit Art, Laufzeit, letzte Aktivität, Frist, Zustand (läuft · Check-in · überfällig · beendet).

## Punkte (je ≤ 3 Dateien, 1 neue Schnittstelle)

| Punkt | Inhalt | Dateien | Routing |
|---|---|---|---|
| R1 | `prozesse.ts`: `starte`/`beenden`/`liste`/`aktivitaet`, Register + `prozesse.json`; `procStart`/`lebt`/`beenden` aus testlink hierher, testlink importiert | `claude-bridge/src/prozesse.ts` (neu), `web/server/testlink.ts`, `claude-bridge/test/prozesse.test.ts` (neu) | Sonnet (Kern, alle bauen darauf) |
| R2 | Start-Aufräumen: Bridge beendet beim Start alle lebenden Einträge des Vorlaufs | `sessions.ts` (Startblock), `prozesse.ts` (`vorlaufAufraeumen`), Test | Flash-Paar |
| R3 | Shutdown: SIGTERM/SIGINT → nach Drain alle eigenen Gruppen beenden; Stop-Skript tötet `-pgid` | `server.ts`, `scripts/werkbank.sh`, Test | Flash-Paar |
| R4 | jcode + `opencode run` über `starte` (Gruppe, TERM→KILL, Abbruch → `beenden`) | `sessions.ts`, Test | Flash-Paar |
| R5 | `run()` + `pruefLauf` über `starte`; Abbruchsignal → `beenden` | `delegation.ts`, `bauerrennen.ts`, Test | Flash-Paar |
| R6 | Claude-CLI über `spawnClaudeCodeProcess` → `starte`; `erzwinge` beendet die Gruppe | `sessions.ts`, Test | Sonnet (Strangkern) |
| R7 | oc2-Server (Haupt- und Review-Server) über Register statt tmp-PID-Ordner | `oc2server.ts`, `sessions.ts`, Test | Sonnet (3 Stellen, Server-Lebenszyklus) |
| R8 | Web: reviewexec, gegenpruefung über `starte`; Web-Shutdown + Start-Aufräumen | `reviewexec.ts`, `gegenpruefung.ts`, `main.ts` | Flash-Paar |
| R9 | Web: testlink `ausfuehren`/`dauerprozess`, `roadmapauto` (+ Timeout) über `starte` | `testlink.ts`, `roadmapauto.ts`, Test | Flash-Paar |
| R10 | Wächter: Takt 60 s, Frist → Check-in → Gnadenfrist → `beenden`; Leerlauf → Check-in; „Abbruch unbestätigt“ bekommt harten Kill nach Gnadenfrist | `claude-bridge/src/waechter.ts` (neu), `sessions.ts` (Takt), Test | Sonnet |
| R11 | Feed: `/internal/prozesse` + `processes[]` je Strang in `/internal/orch-state` | `server.ts`, `sessions.ts` (`orchStateOf`), Test | Flash-Paar |
| R12 | Anzeige in Arbeit: Prozesse je Strang (Art, Laufzeit, Zuletzt aktiv, Frist, Zustand). **Erst Mock-up im echten Layout, Knut sieht es, dann Bau** | `web/server/zustand.ts`, `web/app/…/Arbeit.tsx`, Test | Flash-Paar nach Mock-up-Freigabe |
| R13 | Gate-Regel: neuer `spawn(`/`exec(`/`fork(` außerhalb `prozesse.ts` → `abnahme.sh` rot (Liste erlaubter Sync-Aufrufe mit Timeout) | `scripts/abnahme.sh`, Test | Flash-Paar |
| R14 | Außen-Wächter: `web-waechter` prüft auch die Bridge (`/health`), startet bei Tod neu → R2 räumt ab | `scripts/web-waechter`, Test | Flash-Paar |

Reihenfolge: R1 → (R2, R3, R4, R5, R8, R9, R11, R13 parallel) → R6, R7, R10 → R12 (nach Mock-up) → R14.
Bau-Strecke: `plan-tempo-leck.md` P1–P6z (freie Ports) laufen parallel, berühren andere Dateien.
Die Strang-Prüfschleife (Bauer → Gegenprüfer → Mutation) zieht wie dort geplant ins Produkt; danach laufen Bau, Wächter und Messung über denselben Weg, das Mess-Gerüst entfällt.

## DoD (wörtlich, je Punkt prüfbar)

- **R1** Test: `starte` eines `sh -c 'sleep 600 & wait'` → Eintrag in `liste()` und `prozesse.json` mit pid, start, besitzer, fristAt; `beenden(besitzer)` → Kind und Enkel tot (ESRCH), Eintrag weg. Fremde PID (pid passt, Startzeit nicht) wird **nicht** getötet. Rot vor Bau (Modul fehlt), grün danach. testlink-Tests unverändert grün.
- **R2** Test: `prozesse.json` mit lebender eigener Gruppe (aus Hilfsprozess) + einem fremden Eintrag (falsche Startzeit) → nach Start-Aufräumen eigene Gruppe tot, fremder Prozess lebt. **Zusatz aus R1-Review:** nach Absturz kann der Leader tot, die Gruppe aber lebendig sein (kein `exit`-Handler lief) → Aufräumen sucht per `/proc/*/stat` alle Prozesse mit `pgid == eintrag.pid` und Startzeit ≥ `eintrag.start` und beendet sie; Test: Leader per SIGKILL weg, Enkel lebt → nach Aufräumen tot.
- **R3** Test: Bridge mit laufendem `starte`-Kind, SIGTERM an die Bridge → nach Ende kein Prozess der Gruppe lebt. `werkbank.sh stop` tötet `-pgid` (Skripttest).
- **R4** Test: Fake-jcode, der `sleep 600 &` startet und SIGTERM ignoriert → nach Timeout bzw. Abbruch Kind + Enkel tot binnen Frist + 6 s.
- **R5** Test: `run()` und `pruefLauf` mit AbortSignal: Abbruch → Gruppe tot; Timeout → Gruppe tot (P7-Tests weiter grün).
- **R6** Test: `erzwinge` auf einen Strang mit Fake-CLI (ignoriert TERM, hat Enkel) → nach Gnadenfrist Gruppe tot, Konto frei, Eintrag weg.
- **R7** Test: Review-oc2-Server nach simuliertem Bridge-Absturz (Register bleibt, Prozess lebt) → Start-Aufräumen beendet ihn; kein tmp-PID-Ordner mehr.
- **R8/R9** Test je Datei: Abbruch/Timeout/Shutdown → Gruppe tot; `roadmapauto` hat Timeout.
- **R10** Test mit Uhr-Injektion: Eintrag über Frist → Check-in-Ereignis genau einmal; + Gnadenfrist → `beenden` aufgerufen; Leerlauf > Grenze → Check-in „still seit“; „Abbruch unbestätigt“ → nach Gnadenfrist Gruppe tot, Worktree danach entfernt.
- **R11** Test: zwei laufende `starte`-Kinder eines Strangs → `/internal/orch-state` liefert `processes` mit art, laufzeitS, zuletztAktivS, fristAt, zustand.
- **R12** Mock-up im echten Layout von Knut gesehen; danach Test auf `zustandAus` + Screenshot-Abgleich.
- **R13** Test: Diff mit neuem `spawn(` außerhalb `prozesse.ts` → `abnahme.sh` ROT mit Dateiname; ohne → kein Befund.
- **R14** Test: Bridge-Health tot → Wächter-Skript ruft Neustart; lebend → nichts.
- **Alle** Rot-vorher belegt, tsc 0 (Bridge) / keine neuen Fehler (Web), Tests parallel zweimal grün.

## Abnahme gesamt

- `pgrep`-Probe nach vollem Testlauf + Bridge-Neustart: **0** Prozesse ohne Registereintrag mit Werkbank-cwd.
- Arbeit zeigt jeden laufenden Prozess je Strang; ein künstlich hängender Strang wird binnen Frist + 60 s als „überfällig“ angezeigt und nach Gnadenfrist beendet.
- Messung gegen `messpunkt-tempo-0811.md`: kein Bau-Punkt verliert Zeit an Waisen/Deckel-Überläufer (heute: ~13 min + 4 h Waise).

## Customer impact & process

Kein Endkunde betroffen (internes Werkzeug). Für das Team: Stränge sind sichtbar, hängen nicht unbemerkt, blockieren
sich nicht mehr gegenseitig; Bau wird schneller, weil keine Ports/Plätze/Budget an Waisen verloren gehen.
Prozess: Gate-Regel R13 macht „Prozess am Register vorbei“ dauerhaft unmöglich.

## Infra

Neue Datei `<STATE_DIR>/prozesse.json` je Dienst (Bridge, Web). Keine neuen Abhängigkeiten. Neue Env (mit Default):
`BRIDGE_WAECHTER_TAKT_S` (60), `BRIDGE_WAECHTER_GNADE_S` (60), `BRIDGE_WAECHTER_LEERLAUF_S` (600).

## Außerhalb

Sandbox-Nutzer `werkbank-agent` (eigener Punkt nach Release). Synchrone Kurzaufrufe mit Timeout (`execFileSync git` u. ä.) bleiben, stehen in der Erlaubtliste von R13.
