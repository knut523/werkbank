# Plan 165 — Delegieren, Phasen-Lead und Gegenprüfung (Modellwahl v2, Stufe 3+4)

Stand: Plan (15.10.2026). Auftrag Knut 15.10.: „nutze melious so wie wir es besprochen haben … insbesondere auf dem Workspace“.
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
