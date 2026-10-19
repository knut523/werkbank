---
status: Plan 16.10.2026 (Paket 209), Council R1 HOLD 0,80 → R2 PASS-WITH-CONCERNS 0,82; Auflagen K1–K21 bindend
quelle: Knut 16.10.2026 („check mal mit Council, aber ansonsten klingt der Plan gut, bau mal alles … brauch halt einen echten CoS“); Recherche Paket 207 und 208; Entscheidungen E1–E4 von Knut; Präzisierung E4 (Vexa) und „auf aktueller Basis bauen, OLAF-Jira klein und abgegrenzt“ (Knut, 16.10.2026)
---

# Plan: Chief of Staff (CoS) für Knut im OLAF Workspace

## Problem (aus Knuts Sicht)

Knut führt rund zehn Themen (Produkt OLAF, Flex, Partner, Rogue-Vertrag, Workspace …) mit Christoph, martenc, den Devs und
Partnern. Morgens liegen vier Berichte an drei Orten: Daily-Check und Drift (06:30), Dienste (06:50), Jira-Debrief (07:00) und
Vault-Sync (07:30). Dazu kommen die Übersicht mit Strängen und Rückfragen und die Meeting-Notizen. Darauf fehlen ihm drei Antworten:

- „Was muss ich heute entscheiden, und was empfiehlst du?“
- „Wer schuldet wem was, und was ist überfällig?“
- „Was hat sich über Nacht geändert?“

Was in Meetings zugesagt wird, steht nirgends nachverfolgbar. Ein Agenten-Board verwaltet die Agenten, ein CoS verwaltet
dagegen Knut: Zusagen, Entscheidungen, Themen, Nachfassen, und gemeldet wird nur, was Knut braucht.

## Lösung (aus Knuts Sicht)

1. **Morgenlage um 06:55.** Oben auf der Übersicht steht eine Karte, dazu kommt eine Vault-Seite neben dem Debrief. Kurz und deutsch, mit fünf Blöcken:
   - ① **Entscheide heute**: je Punkt eine Empfehlung und die Knöpfe Ja / Nein / Anders. Die Antwort geht dorthin, wo sie hingehört: an den Strang, in den Bericht oder ins Register.
   - ② **Blockiert**, und von wem.
   - ③ **Über Nacht geändert**: PRs, Reviews, Jira (beide Seiten), Stränge, neue Meeting-Notizen.
   - ④ **Wer schuldet was**, getrennt nach Knut, Team und Partnern, Überfälliges zuerst.
   - ⑤ **Themen**: eine Zeile je Thema mit Stand, nächstem Schritt und bei wem der Ball liegt.

   Die vier Berichte bleiben, die Morgenlage verlinkt sie und zieht je eine Zahl heraus.
2. **Zusagen-Register** und **Themen-Register** als Vault-Dateien. Menschen lesen und bearbeiten sie in Obsidian, die Werkbank liest und schreibt sie, aber nur nach Knuts Ja.
3. **Einwurf.** In der Übersicht steht ein Knopf „Einwurf“, im Hauptchat genügt einfaches Einfügen. Text, Datei oder weitergeleitete Mail, auch das Transkript eines beliebigen Recorders, werden so verarbeitet:
   - Es entsteht eine Meeting-Notiz, wörtlich und aufbereitet, wie die vom 16.10.
   - Dazu kommen Kandidaten in vier Klassen: Zusage (wer, was, bis wann), Entscheidung, Aktion und Roadmap-Idee.
   - Knut bestätigt im Chat, erst dann wird geschrieben.
4. **Vexa automatisch.** Neue Notizen des Notetakers (`status: draft`, Abschnitte `## Decisions` und `## Action Items`) erscheinen in der Morgenlage, z. B. „Meeting X: 3 Zusagen, 1 Entscheidung, übernehmen? Ja / Nein / Anders“. Ja trägt die Zusagen ein und setzt den Triage-Status nach dem Vault-Protokoll. Vexa selbst wird nicht verändert.
5. **Nachfassen** (Scheibe 2). Für überfällige Zusagen anderer gibt es fertige Entwürfe als GitHub-Kommentar, Jira-Kommentar oder Mailtext. Gesendet wird nur nach Knuts Ja, Mails nie: Knut kopiert sie selbst. Vor bekannten Terminen kommt eine Vorbereitung mit offenen Zusagen mit den Teilnehmern, der letzten Notiz der Serie und dem Hinweis „Notetaker einladen: notetaker@konekto.energy“.
6. **Steuerung der Stränge** (Scheibe 3):
   - eine Inbox für alle Rückfragen mit „wartet seit“ und „blockiert“
   - ein Budget je Strang: bei 80 % eine Meldung, bei 100 % eine Pause mit Rückfrage
   - ein Lebenszeichen, das hängende Stränge sichtbar macht und sonst schweigt
   - Tagesabschluss um 17:30 und Wochendurchsicht freitags

## Bedarfe → Scheiben (aus Paket 208)

| Bedarf | Scheibe |
|---|---|
| B1 Gesamtbild (Themen, Zusagen) | 1 (Register, Morgenlage ④⑤) |
| B2 Tag vorbereiten | 1 (Morgenlage ①–③) |
| B3 Eingang → Aktion → Nachfassen | 1 (Einwurf, Vexa-Triage), 2 (Nachfass-Entwürfe, Vorbereitung) |
| B4 Delegieren und überwachen | 3 (Inbox, Budget, Lebenszeichen), ETA/Tiefe kommen aus 17b |
| B5 Knuts Sprache und Werkzeuge | alle Scheiben; ohne M365 (E1) |
| B6 EU/DSGVO, Budget | 3 (Budget); keine neuen Anbieter, Meeting-Inhalte bleiben bei Claude/Vault |

## Was es schon gibt (wird wiederverwendet, nicht neu gebaut)

- **Rückfragen** `orchestrator_questions` (Empfehlung, Optionen, `createdAt` = wartet seit), Antwort über
  `POST /api/orchestrator/questions/:id/answer`, Wecken des Hauptchats über `leitstand_events`.
- **Bericht-Entscheidungen** (`offeneEntscheidungen`, `uebersicht.ts`) mit Antwortweg aus Plan 184.
- **Vault schreiben** nach dem Muster der Web-App: `vaultPath`, Vorschau ohne `confirm`, Hash-Konfliktschutz (409),
  `writeAtomic`, `vaultDry()`. Der Vault committet serverseitig selbst; die Web-App ruft nie git auf.
- **Daten in Mongo**: `jira_issues` (PM-Kopie, `updated`), `github_prs` (offene PRs aller WirStrom1-Repos, „wer ist dran“),
  `orchestrator_runs` (Status-Takt), `zug_log` (Tokens je Zug und Unterhaltung), `delegationen`, `melious_usage`.
- **Takte** in `backgroundJobs()` (`main.ts`), Not-Aus `WERKBANK_NO_JOBS`; Feature-Freigaben `features.ts`.
- **Chat mit Auftrag starten** (`startChatAgent`/`agent_start`) und Bestätigungen im Chat (Klasse `confirm` in
  `claude-bridge/src/tools.ts`).
- **Deckel und Fortsetzen** (`autoStopped` + Rückfrage „Fortsetzen/Anhalten“) — das Budget hängt sich hier an.
- **ETA/Tiefe und OLAF-Jira lesen** baut Strang 17b (`feat/eta-tiefe`, Paket 205) — **nicht doppelt**.

## Schnitte

Jeder Schnitt ist für sich vorführbar und hat eigene Tests. Die Reihenfolge innerhalb einer Scheibe folgt dem Wert für Knut.

### Scheibe 1 — MVP

**S1.1 Register lesen und schreiben** (`web/server/cosregister.ts`)
- Ablage `olaf/1-Projects/chief-of-staff/zusagen-register.md` (mit Abschnitt `## Personen`: Name · Seite · auch: Aliasse — K11) und `…/themen-register.md` (Env `COS_DIR`, relativ zum Vault).
  Frontmatter nach Schema, `type: reference`, `area: operations`.
- **Zeilenformat statt breiter Tabelle** (Vault-Regel: keine Tabellen über ~5 Spalten):
  - Zusage: `- **Z-007** · Christoph Bitzner → Knut · Belieferungsstatus in den Report · bis 2026-10-23 · Thema: Cockpit · Quelle: [[2026-09-18-olaf-review-learning-venture-ubergreifend]]`
  - Abschnitte `## Offen`, `## Erledigt`, `## Verworfen`. Der Status ergibt sich aus dem Abschnitt, Notizen hängen als ` · Notiz: …` an.
  - Thema: `- **Flex** · Stand: … · Nächster Schritt: … · Ball bei: Knut · geändert 2026-10-16`
- Ein toleranter Parser. Zeilen, die er nicht lesen kann, gehen nie verloren: Sie bleiben beim Schreiben unverändert und erscheinen als „nicht lesbar“ in der Morgenlage.
- Seite je Person: zuerst `## Personen` im Register (Name/Alias → Knut/Team/Partner), sonst Knut-Namen → **Knut**, Name unter `Intern/2-Areas/People/` → **Team**, sonst **Seite?** (K11). Kein Name → `Wer: offen`, nie aus den Teilnehmern geraten (K12).
- Schreiben (anlegen, erledigt, verworfen, Datum, Notiz; Thema setzen) nur mit Vorschau → `confirm` → Hash-Prüfung.
  Fehlt die Datei, legt das erste bestätigte Schreiben sie mit Kopf an. Die neue Datei braucht einen Link aus dem Olaf-MOC, das setzt der
  Vault-Sync oder Knut (die Werkbank schreibt keine MOCs).
- Routen `GET /api/cos/register`, `POST /api/cos/zusage`, `POST /api/cos/thema` (nur Admin, CSRF).
- **MCP-Werkzeuge** (Werkbank-MCP): `zusagen` (lesen) und `zusage_eintragen` / `zusage_aendern` / `thema_setzen` (Klasse `confirm`, also nach „ja“ im Chat). Im Strang sind sie gesperrt, weil der Strang keine Rückfragen kennt.

**S1.2 Morgenlage** (`web/server/cos.ts`, reine Funktionen + Sammler)
- `lage(u, jetzt)` liefert `{entscheide, blockiert, nacht, schulden, themen, meetings, berichte, stand}`, jeweils mit einer Obergrenze
  (Entscheide 7, Nacht 10 je Quelle, Schulden 5 je Seite). Was darüber hinausgeht, steht als „… und N weitere →“ mit Link da.
- ① **Entscheide**: offene Strang-Rückfragen, offene Bericht-Entscheidungen und Meeting-Triage-Vorschläge. Sortiert wird zuerst danach, ob ein Strang darauf
  wartet, dann nach dem Alter. Jeder Punkt hat Empfehlung und Ja / Nein / Anders und antwortet über den vorhandenen Weg.
  Offene Roadmap-Fragen (`fragen.ts`) erscheinen nur als Zahl mit Link nach Planen.
- ② **Blockiert**: Stränge mit `blockiert` oder „Braucht Knut“, `g0Blocked`, Jira-Tickets im Blockiert-Status.
- ③ **Über Nacht** seit Stichzeit, d. h. dem letzten Tagesabschluss, sonst dem Vortag 18:00 Wiener Zeit:
  - PRs: neu, aktualisiert, weg (gemergt/geschlossen) aus dem Vergleich mit dem Schnappschuss des Vortags in `meta._id='cos_snapshot'`
  - Jira PM: `updated > Stichzeit`, also neu, Status geändert, erledigt
  - Stränge: fertig, blockiert, neu
  - neue Meeting-Notizen
  - je eine Zeile aus Daily-Check, Dienste, Debrief und Vault-Sync-Protokoll (falls schon da, sonst „kommt um 07:00“)
- ④ **Wer schuldet was**:
  - Register-Zusagen (offen)
  - abgeleitet und nicht ins Register geschrieben: PRs, bei denen Knut dran ist (`github_prs`, „wer ist dran“); PRs anderer mit angefragten Änderungen; überfällige Jira-Tickets je Zuständigem; offene Rückfragen an Knut (Zahl)
- ⑤ **Themen**: Zeilen aus dem Themen-Register, je Thema ergänzt um die Zahl offener Zusagen, Stränge und Entscheidungen. Zugeordnet wird über den gleichen Namen wie `themaOf`.
- **Job** in `backgroundJobs()`: Prüfung jede Minute. Um ≥ 06:55 Wiener Zeit schreibt er einmal am Tag
  `olaf/1-Projects/daily-debrief/JJJJ-MM-TT-olaf-morgenlage.md`, **höchstens 25 Zeilen** (K10), Links zu den vier Berichten; um 07:40 einmal nachgezogen, wenn Debrief/Vault-Sync seitdem da sind und die Datei unverändert ist (K1).
  Ist der Server um 06:55 aus, holt der erste Takt danach den Lauf nach. Not-Aus: `COS_MORGENLAGE=off`.
  Generierte Berichtsdatei ohne Rückfrage, wie der Debrief. Die Register schreibt der Job nie.
- **Übersicht**: Die Karte „Morgenlage“ steht ganz oben (nur Admin, Feature `cos`), wird live berechnet und lässt sich zuklappen.
  Dafür kommt kein neuer Menüpunkt dazu (Plan 187).

**S1.3 Meeting-Triage aus Vexa** (`web/server/cosmeeting.ts`)
- Liest `<team>/Meetings/*.md` (Env `COS_MEETING_TEAMS`, Vorgabe `olaf` (K4)), nur mit `status: draft`, mit `meeting-date` innerhalb der letzten 14 Tage
  und ohne `## Triage`-Abschnitt. Ältere Entwürfe erscheinen nur als Zahl. Das sind heute 111, die werden nicht alle vorgeschlagen.
- Vexa-Format (`sources: ["Vexa meeting_id …"]`): `## Action Items` mit `- [ ] **Name:** …` wird zum Zusage-Kandidaten; das Datum steht im
  Text, z. B. „bis 23.10.“ oder „bis Freitag“, relativ zum Meeting-Datum. `## Decisions` liefert die Entscheidungen.
- Andere Notizen (Knuts Format) enthalten keine maschinenlesbaren Abschnitte. Für sie gibt es nur „im Chat triagieren“, das ist der Einwurf mit dieser Notiz.
- **Ja**: Vorschau aller Zeilen → bestätigen → Zusagen ins Register, Abschnitt `## Triage (Werkbank, TT.MM.)` mit den Z-Kennungen
  an die Notiz, `status: archived` nach Vault-Protokoll, aber **nur ohne Entscheidungen**. Mit Entscheidungen
  bleibt `draft`, und der Punkt bietet „ADR im Chat entwerfen“ an, denn Entscheidungen werden im Vault zu ADRs.
- **Nein**: blendet den Vorschlag aus (Mongo `cos_triage`), der Vault bleibt unverändert. **Anders** startet den Einwurf-Chat mit der Notiz.

**S1.4 Einwurf**
- Übersicht: Knopf „Einwurf“ → Textfeld oder Datei (Text, Markdown, VTT/SRT; Teams-Transkript als Text) → `POST /api/cos/einwurf` →
  `startChatAgent`-Weg: ein neuer Chat „Einwurf · TT.MM. · Titel“ mit der Anleitung `templates/cos/einwurf.md`. Der Text liegt als Datei im Chat-Ordner.
- Die Anleitung (auch für den Hauptchat, als Abschnitt im Leitstand-Systemtext und als Skill-Vorlage):
  1. Meeting-Notiz nach dem Vorbild vom 16.10. schreiben (wörtlich + Aufbereitung, `status: draft`), Schreiben im Vault nach „ja“.
  2. Kandidaten in vier Klassen aufschreiben, je mit Wer / Was / Bis / Quelle.
  3. Nach Knuts Ja `zusage_eintragen` aufrufen. Jira nur, wenn Knut es ausdrücklich sagt; Roadmap über den Roadmap-Skill.
- Keine eigene LLM-Anbindung im Server, alles läuft über den normalen Chat und seine Bestätigungen.

### Scheibe 2 — Nachfassen und Vorbereiten (ohne M365)

**S2.1 Nachfass-Entwürfe**: Überfällige Zusagen anderer bekommen einen Textentwurf aus einer Vorlage, deutsch und kurz, mit Bezug und Datum. Welcher Weg sich anbietet, hängt an der Quelle:
- PR → GitHub-Kommentar
- `PM-…` → Jira-Kommentar
- sonst Mailtext

In der Morgenlage stehen dazu die Knöpfe „Kopieren“ und „Senden …“. Senden zeigt erst eine Vorschau, dann schickt `confirm` über die vorhandenen Wege (`addComment`, `githubwrite`).
Danach bekommt die Zusage die Notiz „nachgefasst TT.MM.“. Mails werden nie gesendet. In Tests laufen nur Mocks.

**S2.2 Vorbereitung vor Terminen**: Termine kommen aus Vault-Notizen mit `meeting-date` ≥ heute und aus dem Abschnitt `## Termine`
im Zusagen-Register (Eintrag per Einwurf: „Termin Fr 23.10. 10:00 Rogue: Vertrag · mit: …“). Später kommt die Kalender-ICS aus Paket 174 dazu, die heute noch nicht gebaut ist.
Die Karte je Termin heute/morgen zeigt:
- Teilnehmer
- offene Zusagen in beide Richtungen
- die letzte Notiz der Serie mit offenen Rückfragen
- den Hinweis „Notetaker einladen: notetaker@konekto.energy“

Sobald es einen Kalender gibt, kommt „Termine heute ohne Notetaker“ dazu.

**S2.3 OLAF-Jira (max-energy) in der Morgenlage**: eine eigene Datei `web/server/cos-olafjira.ts` (lesend, Pilot-Token, eigene JQL
`project = OLAF AND updated >= <Stichzeit>`, 10 min Cache). Sie hängt nicht an `jira.ts`/`config.ts`, so geht der Rebase auf 17b glatt.
Nach dem Release von 17b ist das die **Nachzieh-Stelle**: dann `OLAF_DEV_SITE`/`siteFor` aus `config.ts` statt der festen cloudId
und Links über `browseUrl`. Not-Aus: `COS_OLAF_JIRA=off`.

### Scheibe 3 — Delegation mit Steuerung

**S3.1 Freigabe-Inbox**: Die Liste „Entscheide“ aus S1.2 bekommt eine Vollansicht, alle statt 7, mit „wartet seit“ und „blockiert: Strang X“.
Sie ersetzt den Block „Rückfragen an dich“ auf der Übersicht, damit es nur **eine** Liste gibt. Bericht-Entscheidungen
verlinken auf die Schublade ihrer Karte.

**S3.2 Budget je Strang**:
- Verbrauch = Summe aus `zug_log` je Unterhaltung (Strang und seine Worker) plus Melious-Energie aus `delegationen`.
- Budget am Strang: `orch start --budget <Tokens>`, sonst `ORCH_BUDGET_TOKENS`. Nach dem Rebase auf 17b kommt die Vorgabe aus der Tiefe.
- Bei ≥ 80 % kommt einmal eine Meldung (Leitstand-Ereignis, Zeile auf der Karte).
- Bei ≥ 100 % gilt `autoStopped` mit `cause: 'budget'`, dazu die Rückfrage „Budget erreicht: weiter mit +50 % / anhalten“ (Weg wie beim Deckel).
- `ponytail:` Der laufende Zug endet noch, denn die Grenze von 40 Schritten / 15 min bleibt. Einen harten Abbruch mitten im Zug gibt es erst bei Bedarf.

**S3.3 Lebenszeichen**:
- Der Status-Takt ermittelt deterministisch:
  - läuft, aber seit `ORCH_HAENGT_MIN` (20) Minuten ohne Aktivität: „hängt?“
  - weder fertig noch läuft, ohne Stand seit 2 h: „still“
- Gemeldet wird einmal je Zustand und Strang, sonst nicht. „Nichts zu melden“ ist der Normalfall und kostet nichts.
- Ein billiges Modell kommt nur dann dazu, wenn der Council es fordert (siehe D-Fragen).

**S3.4 Tagesabschluss (17:30) und Wochendurchsicht (Fr 15:00)**: generierte Vault-Seiten neben der Morgenlage und eine
Nachmittagskarte.
- Tagesabschluss:
  - heute entschieden
  - erledigte und neue Zusagen
  - morgen fällig
  - was über Nacht läuft
  - Er setzt die Stichzeit für „über Nacht“.
- Wochendurchsicht:
  - überfällige und seit 14 Tagen unveränderte Zusagen
  - nächste Woche fällig
  - Themen ohne Bewegung seit 7 Tagen
  - die 5 teuersten Stränge der Woche

Der bestehende Ticket-Tagesabschluss aus Plan Tagesabschluss bleibt und wird verlinkt.

## Einstellungen (alle mit Vorgabe, kein Pflicht-Env)

| Name | Vorgabe | Wirkung |
|---|---|---|
| `COS_MORGENLAGE` | an | `off` = kein Job, keine Karte |
| `COS_ZEIT_MORGEN` / `COS_ZEIT_ABEND` / `COS_ZEIT_WOCHE` | `06:55` / `17:30` / `Fr 15:00` | Wiener Zeit |
| `COS_DIR` | `olaf/1-Projects/chief-of-staff` | Ort der Register |
| `COS_MEETING_TEAMS` | `olaf` | Meeting-Ordner für die Triage |
| `COS_OLAF_JIRA` | an | `off` = zweite Seite aus |
| `ORCH_BUDGET_TOKENS` | `0` (aus) | Budget je Strang, wenn nicht beim Start gesetzt |
| `ORCH_HAENGT_MIN` | `20` | Lebenszeichen |

## Tests

- Reine Funktionen: Register-Parser (Runde: lesen → schreiben → identisch; unlesbare Zeilen bleiben), Seite je Person,
  Vexa-Parser (echte Struktur vom 18.09. als Fixture), Datumsauslegung („bis Freitag“), Lage-Sortierung und Obergrenzen,
  Stichzeit, PR-Schnappschuss-Diff, Budget-Schwellen, Lebenszeichen-Zustände, Nachfass-Vorlagen.
- API (Test-Mongo über `~/work/werkbank-dev/.runtime/bin/mongod`, nie Live-Mongo; Fixture-Vault): Vorschau schreibt nie,
  `confirm` schreibt, 409 bei Änderung, Nicht-Admin 403, Triage Ja/Nein/Anders, Job schreibt einmal am Tag und holt nach.
- Brücke: Einstufung der neuen MCP-Werkzeuge (`zusagen` read, die anderen confirm, im Strang gesperrt).
- Sichtprüfung: Screenshots der Übersicht mit Morgenlage (1440 und 390), leere Lage, Triage-Vorschau, Inbox, Budget-Zeile.

## Nicht in diesem Plan

M365 (E1), Push aufs Handy/Teams (E3), Vexa-Server und -Filer (E4), ETA/Tiefe (17b), echte Kalenderanbindung (Paket 174),
LLM-Aufrufe im Server, automatisches Anlegen von Jira-Tickets oder ADRs.

## Ausrollen

1. 17b (Paket 205) ins Release; danach den Rebase von `feat/chief-of-staff` auf den 17b-Release-Zweig (Hauptchat) und die Nachzieh-Stelle S2.3 ziehen.
2. Release-Zweig mit CoS; `release-live-cos-entwurf.sh` (Muster aus Paket 187) startet Knut selbst.
3. Ein Schritt nach dem Live-Gang: Olaf-MOC-Link auf die zwei Register (Vault-Sync oder Knut).

## Council-Auflagen (bindend, R1 HOLD 0,80 — Protokoll: Paket 209 `council.md`)

Jede Auflage hat einen Test oder eine Prüfung, die sie belegt. Bei Widerspruch zum Text oben gilt die Auflage.

- **K1 Takt:** Um 06:55 nur Live-Quellen (Mongo-Kopien, Stränge, Register, Vault-Notizen). Eine Berichtszeile erscheint nur, wenn der Bericht von heute da ist, Platzhalter wie „kommt um 07:00“ gibt es nicht. Um 07:40 wird die Seite einmal nachgezogen, aber nur, wenn ihr Hash dem eigenen letzten Schreiben gleicht. Die Karte auf der Übersicht ist immer live. Getestet wird mit fester Uhr.
- **K2 Zwei Schreiber:** Register-Schreiben antworten mit 409 „Vault-Sync läuft“, solange die Sperre des Vault-Syncs (`syncLocked`) aktiv ist. Der Hash wird unmittelbar vor `writeAtomic` erneut geprüft. Ein Test belegt beides.
- **K3 Schreibschutz:** Register-Schreiben ändern Zeilen gezielt. Sie fügen eine Zeile am Abschnittsende ein, ändern genau die Zeile mit der Kennung oder verschieben sie. Die Datei wird nie aus dem Parse neu erzeugt. Steht eine Kennung doppelt da, gibt es 409. Die Z-Kennung wird erst beim `confirm` vergeben (höchste + 1). Tests: Rundlauf byteweise gleich (CRLF, Leerzeichen am Zeilenende) und von Hand bearbeitete Fixtures (umbenannter Abschnitt, fremde Zeilen dazwischen), deren fremde Zeilen unverändert bleiben.
- **K4 Vexa-Triage:** Nur `COS_MEETING_TEAMS` (Vorgabe `olaf`). Ein „Ja“ zeigt in der Vorschau jede Änderung, auch „Status → archived“. `archived` gilt nur ohne Entscheidungen. Der Abschnitt `## Triage` nennt je Punkt das Ziel: Z-Kennung, PM-Schlüssel oder „bewusst kein Jira“. Dass Action Items ins Register statt nach Jira gehen, ist eine Abweichung vom Vault-Protokoll. Das ist Frage **D1** an Knut, bis zur Antwort gilt die Empfehlung.
- **K5 Datenschutz:** Kein neuer Anbieter, der Server schickt keine Meeting-Inhalte an Melious oder andere Anbieter. Die Einwurf-Anleitung verbietet Kundendaten und Zugangsdaten in Notizen. Rohtranskripte kommen nach `Meetings/raw/` wie bei Vexa. Die DSGVO-Prüfung eines Recorders bleibt bei Knut (E4).
- **K6 Nachfassen:** Der Entwurf enthält nur das Was der Zusage, die Frist und den Bezug, keine weiteren Notizinhalte. „Senden“ gibt es nur, wenn die Quelle der PR oder das Ticket selbst ist, sonst nur „Kopieren“. Steht `Wer: offen` da, entsteht kein Entwurf. Ein Test belegt, dass kein Notiztext im Entwurf landet.
- **K7 Budget:** Verbrauch = Eingabe ohne Cache-Lesen + Cache-Schreiben + Ausgabe. Trennt `zug_log` das nicht, wird die Trennung im selben Schnitt ergänzt (Brücke liefert die Felder schon in `usage`). Bei 80 % kommt eine Meldung, bei 100 % die Pause, wie Knut es vorgegeben hat. Die Vorgabe `ORCH_BUDGET_TOKENS` ist 0, also aus, bis Knut eine Zahl setzt (Frage D3). Ein Test belegt jeden Schwellenwert.
- **K8 Eine Quelle je Art:** ④ nutzt dieselben Funktionen wie „Wartet auf dich“ (`mineFor`, `github_prs`, Hygiene), keine zweite Ableitung. Eine beantwortete Frage verschwindet überall. Ein Test prüft Morgenlage und „Rückfragen an dich“ gemeinsam (P1).
- **K9 Themen:** Das Themen-Register wird beim ersten bestätigten Schreiben aus den Jira-Workstreams der PM-Kopie und den Strang-Themen vorbefüllt. ⑤ zeigt nur Themen, die sich seit der Stichzeit geändert haben oder bei denen der Ball bei Knut liegt, der Rest steht als Zahl da. Ein Test prüft, dass `themaOf` und die Registernamen zusammenpassen.
- **K10 Länge und Rauschen:** Die Vault-Seite hat bei voller Fixture-Last höchstens 25 Zeilen (Test). ③ zeigt nur Zustandswechsel: neu, gemergt/geschlossen, Status geändert, fertig/blockiert. Reine Aktualisierungen erscheinen nicht.
- **K11 Personen:** Der Abschnitt `## Personen` mit Aliassen ist vorbefüllt aus `Intern/2-Areas/People/` und mit Knut. Unbekannte Personen landen unter „Seite?“. Tests: „Knut Peters“, „martenc“, „Michael N.“.
- **K12 Kandidaten:** Ohne Namen gilt `Wer: offen`. Die Einwurf-Anleitung kennt fünf Klassen: Zusage, Entscheidung, Aktion, Roadmap-Idee und „Unterlage veraltet → Aktion“. Fixture-Tests mit der Vexa-Notiz vom 18.09. (5 von 6 ohne Namen).
- **K13 Entscheidungen erkennen:** Maßgeblich ist das Frontmatter `decisions:`, sonst der Abschnitt ohne Leerformeln („Keine formalen Entscheidungen“). Fixture 18.09. → 0.
- **K14 Rückstau:** Die Wochendurchsicht bietet an, ältere Entwürfe ohne Action Items sammelweise zu archivieren: eine Vorschau, ein Ja, nur `COS_MEETING_TEAMS`.
- **K15 Daten:** Fristen werden relativ zu `meeting-date` gelesen („bis Freitag“, „bis 23.10.“, „KW 44“, „nächste Woche“). Ist eine Frist unklar, steht „Frist unklar“ da, nichts wird geraten. Tests am Jahreswechsel und an der Zeitumstellung am 25.10.2026.
- **K16 Betriebsfälle:** Nachgeholt wird nur bis 11:00, danach zeigt nur die Übersicht die Lage. Es entsteht genau eine Datei pro Tag. Fehlt der Tagesabschluss, gilt als Stichzeit der Vortag 18:00. Beim ersten Lauf ohne Register zeigt die Lage „Register noch leer → Einwurf“ statt leerer Blöcke. Getestet wird mit fester Uhr.
- **K17 Werkzeuge im Strang:** Die schreibenden CoS-Werkzeuge sind im Strang `blocked`, außerhalb `confirm`, `zusagen` ist `read`. Ein Brückentest belegt das.

- **K18 Kennungen parallel:** Alle Register-Schreiben laufen im Server nacheinander über eine Warteschlange je Datei. Die Kennung wird darin vergeben. Zwei gleichzeitig bestätigte Schreiben bekommen Z-n und Z-n+1. Ein Test belegt das.
- **K19 Stand sichtbar:** Die Vault-Seite trägt „Stand HH:MM, aktuell: Übersicht“ in der ersten Zeile, die Karte zeigt ihre eigene Uhrzeit.
- **K20 Eine Kopie des Rohtexts:** Was dauerhaft bleibt, liegt nur in `Meetings/raw/` (Vault). Die Datei im Chat-Ordner ist Arbeitskopie und fällt unter das bestehende Aufräumen des Scratch-Ordners. Einwurf-Texte landen nicht in Mongo, dort steht nur die Kennung des Chats.
- **K21 Sammelarchivierung (K14):** Die Vorschau führt jede Notiz einzeln mit Haken (alle vorausgewählt). Mongo merkt sich den alten Status je Datei, „Rückgängig“ ist 7 Tage lang möglich. Ein Test belegt das. Die Nachzieh-Stelle OLAF-Jira (S2.3) steht in der Push-Checkliste des Berichts. Nach dem Rebase auf 17b wird `siteFor`/`browseUrl` aus `config.ts` genutzt, die feste cloudId fällt weg.

Reihenfolge des Baus (Specialist): S1.1 Register + MCP → S1.4 Einwurf → S1.2 Morgenlage (①②④ zuerst, ③ zuletzt) → S1.3 Vexa → S2.2 Vorbereitung → S2.1 Nachfassen → S2.3 OLAF-Jira → S3.4 Tagesabschluss → S3.1 Inbox → S3.3 Lebenszeichen → S3.2 Budget.
Empfehlung an Knut nach dem Live-Gang: jede Scheibe fünf Werktage nutzen und dann nach Zahlen entscheiden, ob die nächste aufgeschaltet wird (eingetragene, erledigte und nachgefasste Zusagen).
