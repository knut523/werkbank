# Plan 165 — Delegieren, Phasen-Lead und Gegenprüfung (Modellwahl v2, Stufe 3+4)

Stand: Plan nach Council (15.10.2026). Auftrag Knut 15.10.: „nutze melious so wie wir es besprochen haben … insbesondere auf dem Workspace“.
Befund dazu: Ersatzkette, „Leser/Schreiber zuerst Melious“ und `challenge` sind live, greifen aber kaum — alle Stränge laufen als
Bauer/Voll, und Claude hat Kontingent. Grundlage: Konzept v2 der smarten Modellwahl mit Council-Urteil Runde 2 und Knuts
Entscheidung danach („Push, PR, Council sollten nicht per Default auf Opus warten … keine Limitations hier einbauen“).

## Ziel
Ein Strang-Lead gibt große, abgegrenzte Teilaufgaben an Worker ab, die zuerst über Melious laufen; die Brücke prüft deren Arbeit
deterministisch nach. Der Lead wechselt an Phasengrenzen das Modell (Opus entscheidet, Sonnet baut) über eine Übergabedatei.
Pass C und der Advocatus im Council holen standardmäßig die GLM-5.3-Gegenprüfung. Jeder Zug und jede Delegation ist gemessen und
in der Melious-Kachel zu sehen.

## Entscheidungen (aus Konzept und Urteil, gelten)
- **Kein Warten auf Opus, keine Obergrenzen** für Leads (Knut nach Runde 2). Ist Opus weg, läuft der Schritt auf dem nächsten
  Glied der Ersatzkette (Opus → Sonnet → GLM 5.3); das Protokoll vermerkt das Modell. Einzige Obergrenzen: höchstens 3 Worker je
  Strang (Konzept) und der Worker-Deckel auf Claude (C7) — beide schützen die Leads, nicht umgekehrt.
- C2 nur als Einstufung: Übergaben, deren Ziel Migration, Abrechnung oder Kundendaten nennt, bevorzugen Opus in jeder Phase —
  ohne Sperre, mit Protokolleintrag.
- C4/C5 wie von Knut geändert: Priorität Hauptchat vor Strängen bleibt wie gebaut (der Hauptchat geht nie freiwillig auf Melious),
  kein Anhalten von Eingriffen; Ersatz-Lead arbeitet weiter, mit C6-Prüfungen und Prüfer mindestens der Autor-Klasse.
- Strang ohne Phasenangabe = Verhalten wie heute (kein Modellwechsel). Der Phasen-Lead greift erst ab dem ersten `phase_wechseln`.

## Council zum Plan (15.10.2026) — GO mit Bedingungen, eingearbeitet
Stimmen: Fachprüfer (Code gelesen) → GO mit Bedingungen; Advocatus Diaboli → GO mit Bedingungen. Die GLM-5.3-Gegenprüfung brach
zweimal nach 30 s ab (Werkzeug-Zeitlimit; Fix in diesem Paket, eigener Commit) — der Advocatus lief deshalb auf Sonnet.
Änderungen am Plan (gelten vor den Schnitten oben):
1. **Phasenwechsel im selben Zug** (statt Zustellung über „weiter“): nach dem Versuch, in dem `phase_wechseln` gültig war, startet die
   Brücke sofort einen neuen Versuch ohne Fortsetzen, mit dem Modell der Phase. Kontext = Strang-Auftrag (erste Nachricht, in
   orch.json gemerkt) + Übergabe, kein Chatverlauf. Keine Änderung am Auto-Fortsetzen, keine Doppelzustellung.
2. **C1 messbar:** jeder Abschnitt der Übergabe mindestens 20 Zeichen (Annahmen/Widersprüche dürfen „keine“ sein), Pfad nur im
   Arbeitsordner (realpath). Stichprobe gilt als bestanden, wenn die erste Antwort der Folgesitzung keine Rückfrage und keine
   Marke „braucht Antwort“ enthält und mindestens ein Werkzeugaufruf eine Datei aus `## Stand` liest.
3. **Worker leben höchstens so lange wie der Lead-Zug:** `delegieren` geht nur in einem laufenden Strang-Zug (dessen Zugang und
   Konten nutzt der Worker); am Zugende werden offene Worker abgebrochen („abgebrochen“). Beim Start der Brücke: `git worktree
   prune`. Worker zählen nicht in Parallelgrenze/Rückfragen, laufen mit Strang-Regeln (keine Rückfragen) und erscheinen nicht in
   `/sessions` und im Strang-Zustand. Global höchstens `BRIDGE_MAX_WORKERS` (Vorgabe 6, Arbeitsspeicher ≈ 420 MB je Worker).
4. **Unter-Worktree:** `<repo>.deleg/<id>` neben dem Repository; `node_modules` verlinkt und in `info/exclude` eingetragen (kein
   falsches „nicht committet“). Schreiben über den Link verhindert der Wächter (realpath, nur der eigene Ordner). Schreiber nur in
   Git-Ordnern.
5. **Prüfbefehle (C6) sicherer:** `.werkbank/pruefungen.json` aus dem **Integrationszweig** (erste vorhandene Referenz aus
   `BRIDGE_PRUEF_REF`, Vorgabe `origin/dev, origin/develop, origin/main, dev, main`), nicht aus dem Strang; Befehl als Argument-Liste
   ohne Shell; Umgebung ohne Geheimnisse plus Git ohne Zugangsdaten; Zeitlimit beendet die ganze Prozessgruppe. Restrisiko (offen
   im Bericht): Tests führen vom Worker geschriebenen Code aus, ohne Sandbox (auf der VM gibt es weder bwrap noch unprivilegierte
   Namespaces) — gleichwertig mit `npm test` im Worker selbst.
6. **Heikle Pfade:** Ein Diff, der `.werkbank/`, `.claude/`, `.github/`, `.husky/`, `.gitattributes`, `.gitmodules` oder `package.json`
   berührt, hebt das Risiko auf „hoch“ (eigener Prüfer) und steht als Abweichung im Ergebnis.
7. **Reparaturrunde:** fehlt der Abschluss-Block, fordert die Brücke ihn einmal in derselben Worker-Sitzung nach; erst danach
   „fehlgeschlagen“.
8. **C6 für Ersatz-Leads:** lief ein Zug der Phase auf einem Glied der Ersatzkette, führt die Brücke beim nächsten `phase_wechseln`
   die Prüfbefehle auf dem Strang-Stand aus; rote Prüfungen gehen in die Übergabe der Folgesitzung. Fehlt ein Prüfer der
   Autor-Klasse, steht im Ergebnis „ungeprüft (kein Prüfer ≥ Autor)“ — `challenge` gilt nicht als Ersatz, wenn der Autor GLM 5.3 ist.
9. **C7 auch für Melious:** Worker auf Melious nur, solange der Melious-Rest über `BRIDGE_WORKER_MELIOUS_RESERVE` (Vorgabe 16 000
   Energie = zwei Takte) liegt — der Rest gehört dem letzten Glied der Lead-Ersatzkette.
10. **Messung des Nutzens:** Kachel zeigt je Modell und Rolle Delegationen, Fehlschlag- und Verwerfquote sowie Worker-Tokens gegen
    Lead-Tokens im selben Strang. Eine automatische Zurückstellung schwacher Modelle (Advocatus: ab 40 % Verwerfquote) ist eine
    Entscheidung für Knut, nicht gebaut.
11. **C8 Kompaktierung:** Worker bekommen `CLAUDE_CODE_AUTO_COMPACT_WINDOW=120000` und `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=70`, Strang-
    Leads `…PCT_OVERRIDE=80` (Variablen des CLI; im Stub-Test belegt, dass sie gesetzt sind — die Wirkung beim CLI ist nicht getestet).
12. `challenge` schickt die Kennung der Unterhaltung mit (Zählung „Gegenprüfung n×“ an der Review-Karte).

## Schnitte

### S1 Werkzeuge für Strang-Leads (Werkbank-MCP, nur in Strängen)
- `delegieren(rolle, aufgabe, risiko?, pruefe?)` — `rolle` = `leser | schreiber | bauer | pruefer`. Startet den Worker und
  antwortet sofort mit der Kennung (`d-xxxxxx`), damit bis zu drei parallel laufen. `pruefe` = Kennung einer Bauer-/Schreiber-
  Delegation, die ein Prüfer begutachten soll.
- `delegation_stand(ids?, warten_s?)` — wartet höchstens `warten_s` (Vorgabe 240, höchstens 240) auf die genannten (Vorgabe: alle
  offenen) und liefert je Delegation: Status, Modell/Konto, Abschluss-Block, Brücken-Prüfungen mit Ausgabe, Abweichungen, Diff-Stat,
  Übernahme-Befehl, Prüfpflicht.
- `delegation_urteil(id, urteil, notiz?)` — `uebernommen | nachgebessert | verworfen`; protokolliert das Prüfurteil des Leads und
  räumt den Unter-Worktree ab (der Zweig bleibt).
- `phase_wechseln(phase, uebergabe)` — siehe S3.
Die Werkzeuge rufen die Brücke direkt (sie kennt Strang und Person aus der Umgebung des MCP-Servers, nie aus den Argumenten).
Worker haben diese Werkzeuge nicht (keine Verschachtelung), auch kein `hauptchat_melden`.

### S2 Worker in der Brücke
- Ein Worker ist eine eigene, verdeckte Unterhaltung der Art `worker` (orch.json, mit Eltern-Strang): strenge Strang-Regeln
  (keine Rückfragen, kein Push), festes Profil, zählt nicht gegen die Parallelgrenze der Chats. Er läuft über denselben Zugablauf
  wie jeder Chat (Konten, Melious-Energie-Deckel, Wächter, Verbrauch).
- **Rollen → Profil, Modell:**

| Rolle | Profil | zuerst | Rückfall Claude (C7) | Arbeitsordner |
|---|---|---|---|---|
| leser | leser (Read, lesende Bash) | Melious, verteilt über alle Abo-Modelle der Rolle | Haiku | Strang-Ordner (nur lesen) |
| schreiber | schreiber | Melious, verteilt (Rolle „schreiber“) | Sonnet | eigener Unter-Worktree bzw. eigener Ordner |
| bauer | bauer | Melious GLM 5.3 | Sonnet | eigener Unter-Worktree vom Strang-Kopf |
| pruefer | leser | Modell ≠ Autor, Klasse ≥ Autor (s. u.) | Sonnet | Unter-Worktree des Geprüften bzw. Strang-Ordner |

- Verteilung: Worker eines Strangs nehmen die freien Abo-Modelle ihrer Rolle reihum (nicht alle dasselbe erste Modell).
- **Unter-Worktree** (bauer, schreiber in Git-Ordnern): Zweig `werkbank/deleg-<id>` vom aktuellen `HEAD` des Strangs, Ordner neben
  dem Strang-Ordner; `node_modules` des Strangs werden verlinkt (Tests laufen ohne Neuinstallation). Der Worker committet; der Lead
  übernimmt nach Prüfung (`git cherry-pick <basis>..<kopf>` im Strang). Nie zwei Worker im selben Worktree.
- **Pflicht-Abschluss-Block** (maschinenlesbar, letzter `json`-Block der Antwort):
  `{"abschluss": {"ziel": true|false, "dateien": [...], "pruefungen": [{"befehl", "ausgabe"}], "annahmen": [...], "widersprueche": [...]}}`,
  Prüfer zusätzlich `"urteil": "ok"|"maengel"|"falsch"` und `"befunde": [...]`. Fehlt er oder ist er ungültig → Delegation
  **fehlgeschlagen**.
- **Abweichungen** (Eskalation sofort, nicht erst bei Fehlschlag): Ziel „nein“; gemeldete ≠ tatsächlich geänderte Dateien;
  nicht committete Änderungen; Brücken-Prüfung rot, obwohl der Worker grün meldet; Prüfer-Urteil nicht „ok“.
- **Prüfpflicht nach Risiko** (Risiko = höchstens so niedrig wie das des Strangs, Untergrenze erzwingt die Brücke):
  niedrig = Brücken-Prüfungen + Stichprobe (der größte Hunk steht im Ergebnis); mittel = dazu „Lead liest den Diff“ (Befehl im
  Ergebnis); hoch = dazu startet die Brücke selbst einen Prüfer anderen Modells, dessen Urteil zum Ergebnis gehört.
- **Prüfer-Klasse** (C6): Opus 3; Sonnet, GLM 5.3 = 2; Haiku und die Flash-Modelle = 1. Prüfer = erstes verfügbares Modell aus
  GLM 5.3 → Sonnet mit Klasse ≥ Autor und ≠ Autor. Gibt es keins (Autor Opus, oder Ressourcen weg): kein stiller Ersatz — das
  Ergebnis sagt „kein Prüfer der Autor-Klasse frei — Lead prüft selbst, Gegenprüfung mit `challenge`“.
- Höchstens 3 laufende Worker je Strang; der vierte Aufruf wird abgelehnt (mit Hinweis, `delegation_stand` abzuwarten).

### S3 Phasen-Lead (Variante A) mit Übergabedatei (C1)
- Phasen: `plan`, `council`, `pass-c`, `push` → **Opus**; `bau`, `recherche`, `review` (Pass A/B), `bericht` → **Sonnet**.
- `phase_wechseln(phase, uebergabe)`: `uebergabe` = Pfad einer Datei im Arbeitsordner. Die Brücke prüft das feste Schema (C1):
  Abschnitte `## Ziel`, `## Stand`, `## Annahmen`, `## Offene Widersprüche`, `## Prüfausgaben`, je nicht leer, zusammen höchstens
  8 000 Zeichen (C8). Ungültig → kein Wechsel, Fehlermeldung nennt, was fehlt. Gültig → Phase gemerkt; der Lead beendet seinen
  Zug, die Werkbank schickt (einmal je Wechsel) „weiter — Phase … beginnt“, und der nächste Zug startet als **neue Sitzung** mit
  dem Modell der Phase und nur der Übergabe als Kontext (kein Chatverlauf).
- Ein beim Start ausdrücklich gesetztes Strang-Modell gewinnt (wie bisher); C2-Einstufung (Ziel nennt Migration/Abrechnung/
  Kundendaten) → Opus auch in Arbeitsphasen, Protokolleintrag.
- Ersatzkette wie gebaut: in Opus-Phasen Opus → Sonnet → GLM 5.3, in Sonnet-Phasen Sonnet → GLM 5.3; kein Warten.

### S4 Gegenprüfung in plan-to-pr (Pass C, Council-Advocatus)
- Systemtext für Stränge und Hauptchat (wenn Melious eingerichtet): Pass C und der Advocatus im Council rufen **standardmäßig
  zusätzlich** `challenge` (`art=diff` bzw. `council`); Ergebnis wird selbst nachgeprüft und im Bericht genannt. Der Skill selbst
  bleibt unverändert (er ist modellneutral und wird von außen kopiert).
- Nachweis: `challenge`-Aufrufe werden je Unterhaltung gezählt; die Review-Karte („fertig“) zeigt „Gegenprüfung: n×“ oder
  „ohne Gegenprüfung“.

### S5 Deterministische Prüfungen durch die Brücke (C6)
- Prüfbefehle stehen im Repository in `.werkbank/pruefungen.json` (Name, Befehl, Unterordner, Zeitlimit) und werden aus dem
  **Basis-Commit** gelesen — ein Worker kann sie nicht für sich umschreiben. Ohne Datei: nur `git diff --check` und der Hinweis
  „keine Prüfungen eingerichtet“ (Prüfpflicht steigt auf „Lead liest den Diff“).
- Ausführung im Unter-Worktree, Umgebung ohne Geheimnisse (wie die Sitzung), Zeitlimit je Befehl (Vorgabe 600 s, höchstens 1 800 s),
  Ausgabe gekürzt auf die letzten 2 000 Zeichen. Das Ergebnis der Brücke zählt, nicht die Behauptung des Workers.

### S6 Gemeinsame Ressourcenrechnung (C7)
- Worker auf Claude nur Haiku/Sonnet, höchstens `BRIDGE_WORKER_CLAUDE_MAX` (Vorgabe 1) gleichzeitig je Person, und **gar nicht**,
  sobald eins der Claude-Konten als erschöpft vermerkt ist — dann nur Melious oder „Lead macht es selbst“ (sofort, kein Warten).
- Die Lage (Claude-Konten frei/erschöpft, laufende Lead- und Worker-Züge, Melious-Rest) steht in `delegation_stand` und in der
  Kachel.

### S7 Kontextkappung als Zahlen (C8)
| Wert | Zahl |
|---|---|
| Auftrag an einen Worker | höchstens 20 000 Zeichen |
| Ergebnis eines Workers an den Lead | höchstens 6 000 Zeichen (Rest im Protokoll) |
| Übergabedatei | höchstens 8 000 Zeichen |
| Worker-Schritte | leser 30 · schreiber 40 · bauer 80 · pruefer 30 |
| Kompaktierung Worker | Fenster 120 000 Tokens, ab 70 % |
| Kompaktierung Lead (Strang) | ab 80 % des Fensters |
| Profil je Rolle | wie Tabelle S2, verbindlich (nicht wählbar) |
| Neue Phase | nur Übergabe, kein Chatverlauf |
| Delegieren lohnt | wenn der Lead sonst > 20 000 Tokens lesen würde; bündeln |

### S8 Messung (Zug und Delegation) in der Melious-Kachel
- Je Zug von Hauptchat, Strang und Worker: Art, Phase, Konto, Modell (tatsächlich), Tokens ein/aus, Energie (Schätzung), Ausgang,
  Dauer → `werkbank.zug_log` (30 Tage).
- Je Delegation: Rolle, Risiko, Modell/Konto, Dauer, Tokens, Energie, Ergebnis (ok/fehlgeschlagen/Abweichung), Brücken-Prüfungen,
  Prüfer-Urteil, Prüfurteil des Leads → `werkbank.delegationen`.
- Kachel: letzte 24 h je Phase × Modell (Züge, Tokens, Energie), Anteil Melious, letzte Delegationen.

## Review (15.10.2026)
- Pass A (Standards + Spec): 7 Ermessensbefunde, 14 Spec-Befunde. Pass B (fünf Winkel): FAIL mit 14 Befunden, darunter zwei schwere
  (Prüfer-Hinweis ging verloren; ein Worker hätte die Referenz des Integrationszweigs umbiegen und so die Prüfbefehle bestimmen
  können). Pass C: `challenge` (GLM 5.3) brach live jedes Mal nach 30 s ab (Fix in diesem Paket) — stattdessen eigener feindseliger
  Durchgang und ein Gegner auf Sonnet. Fix-Runde 1 behebt alle Befunde ≥ 50 bis auf die unten genannten Abweichungen.
- Re-Review + Gegner (Pass C auf Sonnet): PASS-WITH-CONCERNS → Fix-Runde 2 (u. a. Integrations-Commit je Strang, Worker-Text als
  Zitat statt Brücken-Zeilen, Diff als Datei, Delegation „läuft“ bis ihr Prüfer fertig ist, Urteil räumt Zweig ab). Letzter
  Durchgang: PASS-WITH-CONCERNS (F1–F7) → Fix-Runde 3.
- Prüfbefehle lesen jetzt aus dem je Strang festgehaltenen Commit des Integrationszweigs (auch „keiner“ wird gemerkt); `git update-ref`,
  `symbolic-ref`, `replace` und erzwungene Zweig-Befehle sind in Strängen gesperrt; Prüfläufe bekommen ein leeres HOME.
- Abweichungen vom Plan: Die Lage (Melious-Rest, Claude-Konten) steht in `delegation_stand`, nicht zusätzlich in der Kachel (die
  zeigt den Melious-Stand wie bisher). Phasen-Modelle gelten nur für Stränge mit Profil voll/bauer; Leser-/Schreiber-Stränge bleiben
  bei „zuerst Melious“. Zurückgestellt (Ermessen): Ablauf aus sessions.ts in eine eigene Datei verschieben; gemeinsame Konstante für
  den Geheimnis-Filter auch in mcpcall.ts/init-timing.ts.

## Nicht in diesem Paket
GLM-5.3 als regulärer Ersatz-Lead über die Kette hinaus (Stufe 5), Entscheidungspunkt Woche 1 (C3), Checkpoint mitten in der Phase
(C5: die Sitzung setzt beim Kontowechsel wie gebaut fort).

## Definition of Done
- [ ] S1–S8 gebaut, Brücken- und Web-Tests grün (bis auf bekannte, nicht verwandte Fehler).
- [ ] Test mit Stub/Mock durch die echte Brücke: Leser-, Bauer- (mit Commit, Brücken-Prüfung, Abweichung) und Prüfer-Delegation,
      fehlender Abschluss-Block → fehlgeschlagen, vierter Worker abgelehnt, C7-Deckel.
- [ ] Phasenwechsel: ungültige Übergabe abgelehnt; gültige → neue Sitzung mit Phasen-Modell, ohne Verlauf; Stichprobe (C1) mit
      echtem Modell: Folgesitzung arbeitet ohne Rückfrage weiter.
- [ ] Kachel zeigt Züge und Delegationen (Bildschirmfoto, isolierte Instanz).
- [ ] Council zum Plan, Pass A/B/C (C mit `challenge`), Bericht + Folien, Release-Skript für Knut. Nichts live, nichts auf GitHub.
