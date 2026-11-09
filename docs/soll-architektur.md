# Werkbank 2 — Soll-Architektur (Spec, kein Neubau)

Stand 09.11.2026. Ist-Bild: `tmp/arch/ist-architektur.md` des Jobs (12 Gerüche, 10 Fakten). Rahmen: nur Spec, jeder Schritt
ein eigener PR mit Plan (DoD wörtlich), Tests, Rückweg; Live (`werkbank-2`) bleibt unangetastet bis zum Release.
Ziele: (a) der Review-Ablauf hängt nie still, (b) der Hauptchat liest opencode-/jcode-Läufe vollständig, (c) ein Statusmodell
je Gegenstand, (d) Takte und Fristen an einer Stelle sichtbar.

## Council (Proponent · Specialist · Advocatus Diaboli, 09.11.)

```
VERDICT: HOLD (confidence 0.70)
WHY: Richtung trägt (zentrale Übergänge, Lauf-Archiv, Fristen an einer Stelle), aber der Entwurf zählte die
     Schreibstellen zu knapp, ließ die Bridge-Ursachen der Hänger im „Nicht jetzt“ und hat einen heute roten
     Fristkonflikt nicht an den Anfang gestellt.
BINDING CONDITIONS:
  1. [must-fix] Fristen zuerst: fristen.ts + Invariantentest „Ensemble-HTTP (gegenpruefung.ts:138, 3 700 s)
     < GP_MAX_MS (prreview.ts:653, 45 min)“ — heute rot; grün machen, bevor S1 beginnt.
  2. [must-fix] Bridge-Verlust sichtbar: Review in `läuft`/`gegenprüfung`, dessen Strang die Bridge nicht
     kennt (Neustart, RAM weg), geht beim nächsten Tick auf `nochmal` mit Grund — nicht erst nach 6 h.
  3. [must-fix] Grep-Gate von S1 erfasst updateOne, updateMany und insertOne mit `status` in web/server
     inkl. main.ts (heute ~30 Stellen in prreview/prticker/prfix/main), nicht nur updateOne.
  4. [must-fix] Statuskatalog vollständig: auch `deckel` und `führt aus` (werden noch gelesen) — abbilden
     oder per Migration abschaffen; `pr_fixes` ausdrücklich außerhalb von S1.
  5. [verify]   Rückweg-Test für jeden Schalter: Records, die der neue Pfad schrieb, laufen im alten Pfad
     weiter und umgekehrt.
  6. [must-fix] S3-Abschaltkriterium messbar: Whitelist erwarteter Paare (alt→neu); „7 Tage, Zähler
     außerhalb der Whitelist = 0“.
NOTES: Stärkster Einwand (Diaboli): die Hänger entstehen im Bridge-Zulassungspfad und im flüchtigen
       Bridge-RAM, nicht in der Mongo-Statuszeile — eine FSM in Mongo meldet sie nur später. Darum stehen
       Bedingung 2 und S5 vor dem großen S1-Umbau.
```

## Schritte (überarbeitet nach dem Council)

### S0 Fristen an einer Stelle (klein, zuerst)
- `web/server/fristen.ts` und `claude-bridge/src/fristen.ts`: alle Zeitgrenzen als Konstanten, je per Env übersteuerbar —
  Review 6 h/1 h, `GP_MAX_MS`, Ensemble-HTTP, `BRIDGE_ENSEMBLE_TIMEOUT_S` × Läufe, `meliousPassC` 1 500 s, jcode-Strang 3 600 s,
  Wächter-Gnade 60 s, Prozessregister-`fristMs`, `POSTEN_MIN`, `WACHE_MIN`, Aufräumen 3,5 s.
- Invariantentests: Ensemble-HTTP < GP-Frist; 3 × Ensemble-Lauf + Puffer ≤ GP-Frist; Strangfrist < Review-Frist.
- Fix des roten Konflikts: Ensemble-HTTP-Timeout aus `GP_MAX_MS` ableiten (minus Puffer) statt fest 3 700 s.
- Kein Schalter (reine Konstanten); Werte bleiben gleich außer dem Konfliktfix.

### S5 „Wartet, weil …“ + Bridge-Verlust (Ziel a — die eigentlichen Hänger)
- Jede Zulassungsablehnung der Bridge (Budget, Schlange, Lock, Breaker) liefert `wartetWeil {grund, seit, bis?}`; Web legt es
  am Strang und am Review-Record ab, 2.0 zeigt es. Die Bridge liefert den Grund heute schon als Text.
- Bedingung 2: Strang unbekannt bei der Bridge → `nochmal` mit Grund „Bridge kennt den Strang nicht mehr (Neustart?)“.
- Persistenz von `orchMap`/`lives` bleibt danach (siehe „Nicht jetzt“) — die Erkennung reicht, um nicht still zu hängen.

### S1 Review-Übergänge zentral (Ziel a, auf `pr_reviews` beschränkt)
- `web/server/reviewstatus.ts`: Statustyp, Übergangstabelle (inkl. Rücksprünge `nachbessern→vorher`, `gegenprüfung→läuft`),
  Frist je Status aus `fristen.ts`.
- API: `uebergang(id, von, nach, grund, extra?)` (atomarer Claim, Nebenfelder wie `gp`, `nb`, `retryAt`, `strand` im selben
  Update), `uebergangMehrere(filter, nach, grund)` für die Neustart-Sweeps, `anlegen(record, grund)` für Inserts und
  vorgängerlose Fälle (Dedupe-fertig, Handpost).
- `verlauf[]` je Record, gedeckelt auf 50 Einträge (`$slice`). Posten setzt `fertig` (E5 heute schon im Ticker gelöst).
- Umbau in Teil-PRs je Datei (prreview → prticker → prfix → main); das Grep-Gate (Bedingung 3) kommt mit dem letzten Teil-PR
  scharf, vorher als Zähler im Test, der nur sinken darf.
- Kein Env-Schalter: die neuen Felder sind additiv, der Umbau verhaltensgleich; Rückweg = Revert des Teil-PRs.

### S2 Lauf-Archiv + Lesewerkzeug (Ziel b, F4)
- Bestehendes Protokoll erweitern statt zweites Archiv: `sessions.ts:2970` schreibt heute nach `stateDir/ensemble/` nur
  Verifizierer + Schatten. Künftig **eine Datei je Unterlauf** (Prüfer, Verifizierer, Schatten, jcode, melious_sub,
  Bauer-Rennen): Prompt, Antwort, Tool-Aufrufe gekürzt, Modell, Läufer, Dauer, Nutzung, Exit — geschrieben **vor** dem
  Aufräumen, auch im Fehlerpfad (`finally`).
- Schwärzen vor dem Schreiben: Melious-, GitHub-, Jira-, generische Token-Muster.
- Aufbewahrung 30 Tage per Aufräum-Takt. Keine neue Mongo-Kopplung der Bridge.
- MCP: `laeufe_liste({paket|strang|pr})`, `lauf_lesen({id, ab, bis})` seitenweise über die Bridge-API; `orch_show` gleiches Paging.
  2.0: je Review „Läufe“ mit Klick aufs Transkript.
- Schalter `BRIDGE_LAUF_ARCHIV` (Standard an, `aus` = heute).

### S4 Takt-Register (Ziel d)
- `takt(name, ms, fn)` für die ~18 `setInterval` (main.ts, orchestrator.ts): letzte Ausführung, Dauer, Fehler, Überlappungen.
- Überlappung wird **gezählt und angezeigt**, nicht still übersprungen; Überspringen nur je Takt freigeschaltet, wo
  doppelte Läufe nachweislich schaden.
- 2.0-Seite „Takte“ (Name · Intervall · zuletzt · Dauer · Fehler · Überlappungen) zusammen mit den Werten aus `fristen.ts`.

### S3 Ein Statusmodell für Stränge (Ziel c, `orch_runs`)
- `Zustand` wird die Wahrheit, `OrchStatus` die abgeleitete Sicht. Abschaltkriterium nach Bedingung 6; die Schattenzählung
  zählt je Paar (Zähler) statt Ids per `$addToSet` zu sammeln.

### S6 Wissen in die Reviews (laufend)
- Repo-Regeln an Ensemble und Claude-Brief: gebaut (`87894bd`).
- Wissensbasis aus allen PR-Kommentaren → Regelvorschläge → Bestätigung durch Knut (`regeln-bestaetigt.jsonl`) → nur
  bestätigte Regeln gehen in Prompts.

## Reihenfolge
S0 → S5 (mit Bedingung 2) → S1 (Teil-PRs) → S2 → S4 → S3; S6 fortlaufend.

## Nicht jetzt
- `main.ts`/`sessions.ts` zerlegen: nur, wo ein Schritt die Stelle ohnehin anfasst.
- Bridge-RAM persistieren: nach S3, damit nicht zwei Modelle persistiert werden. Bis dahin macht S5 den Verlust sichtbar.
- Ereignisse statt Polling: erst wenn das Takt-Register einen Takt als zu langsam belegt.
- Alte Oberfläche `web/src` abschalten: eigener Release-Schritt nach Abnahme der 2.0.

## Entscheidungen für Knut

1. **Reihenfolge S0 → S5 → S1 statt S1 zuerst.** Empfehlung: ja. Der rote Fristkonflikt und der Bridge-Verlust sind die
   Hänger von heute, S1 macht sie nur sauberer sichtbar.
  - Knut:
2. **S1 ohne Env-Schalter, dafür Teil-PRs je Datei.** Empfehlung: ja. Ein Schalter verdoppelt den Pfad, der alte rottet
   ungetestet, und die neuen Felder sind additiv.
  - Knut:
3. **Lauf-Archiv als Dateien in der Bridge statt Mongo.** Empfehlung: Dateien. Es gibt das Protokoll schon, die Bridge hat
   keinen Mongo-Zugang, und Läufe, die beim Absturz der Web-App enden, bleiben trotzdem erhalten.
  - Knut:
4. **Wer baut das, wann.** Empfehlung: S0 + S5 als ein kleiner PR jetzt (wenig Token, größter Nutzen); der Rest nach
   Release 2.0 Schritt für Schritt.
  - Knut:
