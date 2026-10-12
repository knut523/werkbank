# Plan: Sprint Review, Planning und Summary — Prozess und Werkbank (Paket 143)

Auftrag Knut, 12.10.2026: „können wir dieses Sprint Review / Planning und Summary mal mit dem Council
durchdenken und auch auf die Werkbank bringen“. Teil 1 ist dieser Plan (Council bis PASS), Teil 2 der
Bau dessen, was der Council freigibt. Basis: `release/werkbank-2026-10-11d`, Branch
`feat/sprint-werkbank`.

Status: **v2 — Council Runde 2: PASS (0,78) mit Bedingungen P1–P5, eingearbeitet.** Verlauf in §6.

## 1. IST (12.10.2026, gelesen, nicht vermutet)

Quellen: Skill `olaf-sprint-planning` v1.6, `~/.claude/commands/sprint-sync.md`, die Notizen
`sprint-2026-09-14/`, `sprint-2026-09-28/`, `sprint-2026-10-12-review.md` (heute von Hand per Agent
geschrieben), `jira-review.sh`, `jira-sprint-carry.sh`, `jira-sync-plan.sh`, der Einmal-Generator
`build_review.py` vom 28.09., `web/src/pages/Sprint.tsx`, `web/server/{sprint,syncplan,features}.ts`,
`templates/sprint/*.md`.

| Teil | Was er leisten soll (Skill) | Was tatsächlich passiert |
|---|---|---|
| **Review** | Updates je Arbeitspaket, Soll-Ist S1–S4, Mitnahme; Arbeitsdokument mit Antwortzeilen | Am Termin-Morgen von einem Agenten **frei zusammengeschrieben** (28.09.: eigenes Python-Skript nur für diesen Zyklus; 12.10.: 593 Zeilen aus Jira, Kommentaren, Debriefs, Registern, GitHub). Die **Pakete sind aber stabil**: 23 Pakete am 28.09., davon 20 am 12.10. wieder (gleiche Domänen, fast gleiche Namen), dazu neue („Werkbank & lokale Stränge“, „Backlog ohne Bewegung“). |
| **Updates des Teams** | „Individuelles Review“ vor dem Termin | Kein Kanal. 28.09.: alle sieben Entscheidungs-Antwortzeilen des Vorzyklus leer. In der Runde wurde **freier Text unter die Pakete** geschrieben („OCR ist done, Verbesserungen von Robert noch einarbeiten“) — ohne Antwortzeile, erreicht also weder Sync noch Jira. Die Werkbank ist fürs Team **nur Chat und Einrichtung** (`WERKBANK_TEAM_FEATURES` leer, Release 11.10.). |
| **S1–S4** | Planning setzt ≤4 Ergebnisse (Tabelle), Review bewertet genau diese | 28.09.-Planning hat **keine** S-Tabelle. Der 12.10.-Review hat sich mit Teilzielen T1–T7 beholfen („keine S-Zeilen nachträglich gebaut“). Die Werkbank-Vorlage `review.md` trägt 🟡 **vorausgefüllt** — das liest der Parser als Bewertung. |
| **Planning** | Ziel, S1–S4, Umfang, Termine, bewusst nicht, Impediments, Zu entscheiden, Noch nicht in Jira | Inhaltlich da, Abschnittsfolge weicht ab (`## 1 Rückblick … ## 7`), Mitnahme von Hand übertragen. |
| **Summary** | „Die eine Seite“: Monatsziele, Ziel, Paket-Tabelle je Domäne, Blocker | Wiederholt Review (Paketstand) und Planning (Ziel, Monatsziele) — **dritte Kopie**. |
| **Write-back** | `/sprint-sync`: Plan → Freigabe → MCP → markieren → Mitnahme | Läuft im Chat. Die Werkbank hat Schritt 1–4 schon (Vorschlag, Freigabe-Dialog, Atlassian-MCP der Person, `jira-sync-mark.sh`). Schritt 5 (Mitnahme) nur im Chat; das Carry-Skript braucht `JIRA_API_TOKEN` und ist am 29.09. daran gescheitert. |
| **Werkbank-Sprint-Seite** | — | Eine lange Seite ohne Reihenfolge (Ziel, Zielbaum offen, Im Sprint, Kandidaten, S-Tabellen, Fragen, Sync, Pflegepunkte, Überfällig, Neuer Zyklus). Das erste Antwortfeld kommt nach drei großen Blöcken; drei verschiedene `primary`-Knöpfe. |

**Doppelarbeit heute:** (a) Paketstand in Review-Prosa *und* Summary-Tabelle; (b) Sprint-Ziel und
Monatsziele in allen drei Notizen; (c) Review-Gerüst (Pakete + Tickets) jeden Zyklus neu abgeleitet,
obwohl der Vorzyklus genau diese Struktur hat; (d) Mitnahme erzeugt und dann von Hand ins Planning
übertragen; (e) Ticketstand in Jira, im Vault-Text und in der Werkbank-Kopie.

## 2. SOLL — was jede Notiz leistet

| Notiz | Beantwortet genau eine Frage | Für wen | Wer schreibt |
|---|---|---|---|
| **Review** | *Was ist im letzten Zyklus passiert, gemessen an S1–S4?* | Runde (Knut moderiert); jede:r vorher | **Gerüst automatisch**, Prosa Mensch oder Agent im Chat, Updates in Antwortzeilen, Wertung in der Runde |
| **Planning** | *Was gilt für die nächsten zwei Wochen?* | Runde, danach Jira | Vorlage; Mitnahme kommt über „Kandidaten“ der Werkbank, nicht als zweite Liste |
| **Summary** | *Wo stehen wir, in 60 Sekunden?* | alle, auch Außenstehende | hängt an **E1** — die Werkbank baut nichts, was von E1 abhängt |

Grundsatz: **Jede Aussage hat genau einen Ort.** Paketstand → Review. Ziel/S1–S4 → Planning.
Ticketstand → Jira (Notizen verweisen per Anker, die Werkbank zeigt den Stand an).

Grundsatz 2 (Skill, „Was ein Review nicht behaupten darf“): **Alles Automatische ist Board-Stand.** Der
Entwurf sagt das in der Quellenlage wörtlich, bewertet nichts und formuliert nichts als Befund.

**Kanal-neutral:** Antworten zählen, egal wo sie geschrieben wurden (Obsidian, Werkbank, Chat-Agent) —
die Werkbank liest die Datei. Ob das Team die Sprint-Seite selbst bekommt, ist **E5**.

### Der Zyklus als fünf Schritte

1. **Review vorbereiten.** Erzeugt den Entwurf `sprint-<neu>-review.md` aus Vorlage + Daten, ohne Prosa:
   - **Soll-Ist:** S-Zeilen des Vorzyklus-Plannings **wörtlich**, Bewertung `…`, Beleg-Spalte leer.
     Hat der Vorzyklus keine S-Zeilen: **eine Zeile „Sprint-Ziel“** mit dem Ziel-Satz (`parseGoal`) und
     dem Satz „Vorzyklus ohne S1–S4 — bewertet wird der Ziel-Satz; S-Zeilen ab diesem Planning.“
     Gibt es weder S-Zeilen noch Ziel: Hinweis, keine Zeile. Vorlage ohne vorausgefülltes 🟡.
   - **Die Updates:** Pakete des Vorzyklus-Reviews (Domäne → `####` Paket), **nur die Ankerzeilen**
     neu aufgebaut aus der Jira-Kopie (`[PM-x](…) Titel · **Owner** · \`Status\` · fällig …`), ohne
     alte Antworten, ohne `✓`-Zeilen, ohne alte Fragen. Prosa je Paket: `…`.
     - Offene Tickets: Board-Stand mit Datum („fällig 15.10.“ / „Board: seit 03.10. über“).
     - Tickets, die **im Zyklus** Done wurden (`statusSince ≥ Zyklusbeginn`): eine Zeile
       „Board: Done seit TT.MM.“. Vorher erledigte fallen raus. Paket ohne offene Tickets → Satz
       „Board: alle Tickets Done — stimmt das fachlich?“ (Frage, kein Befund).
     - Je Paket und Owner offener Tickets **eine** leere Antwortzeile `- <Vorname>:` direkt unter
       seinem ersten offenen Ticket (Anker nötig, sonst sieht der Sync die Zeile nicht; Vorname,
       weil `splitSpeaker` höchstens zwei Wörter als Sprecher nimmt).
     - Kopfzeile des Callouts `N Tickets · Owner · M überfällig` abgeleitet.
   - **Auffälligkeiten:** offene Tickets, die im Zyklus angelegt wurden oder den Status gewechselt
     haben (`created`/`statusSince` ≥ Zyklusbeginn, nicht `updated`) und in keinem Paket stehen →
     „keinem Paket zugeordnet — in der Runde einsortieren“. Workstreams ausgenommen.
   - **Quellenlage:** feste Linkliste (Board, Daily Debriefs, `pr-stand-produkt-olaf`,
     `0-roadmap-produkt-olaf`) + Warnsatz „Board-Stand, nicht Arbeitsstand; noch nicht in der Runde
     korrigiert“.
   - **Liefert immer Vorschau + Download.** In den Vault nur nach Bestätigung, nur **neue** Dateien
     (`wx`, nie überschreiben). Gibt es den Ordner schon (wie heute `sprint-2026-10-12/` mit dem
     handgeschriebenen Review), werden **nur fehlende** Dateien ergänzt (Planning/Summary aus der
     Vorlage); ein vorhandener Review bleibt unangetastet, der Entwurf ist dann nur Download.
2. **Updates sammeln.** Paketansicht: Domäne → Paket, Kopfzeile *Tickets · Owner · überfällig*,
   Antwortzeilen darunter, Filter **„nur meine“** (Vorname = Sprecher oder Owner) und **„nur
   leere“**. Fortschritt „x von y Paketen mit mindestens einer Antwort“ — **je Paket, nie je Person**
   (Skill: keine Vergleiche zwischen Personen). Freier Text unter einem Paket ohne Antwortzeile
   wird als Hinweis gezeigt: „Text ohne Antwortzeile — geht nicht nach Jira“.
3. **S1–S4 bewerten.** Soll (Vorzyklus-Planning) neben Ist (Review), Bewertung als Symbol **und
   Wort** (✅ erreicht · 🟡 teilweise · ❌ nicht erreicht). Hinweise: „✅ ohne Beleg“, „🟡/❌ ohne Warum“.
   Gesetzt wird in der Notiz (Runde), nicht in der Werkbank.
4. **Write-back vorbereiten.** Der bestehende Sync-Plan, benannt als **Trockenlauf — noch nichts in
   Jira**. Ausführen nur über den bestehenden Freigabe-Dialog (unverändert). Kein neuer Schreibweg.
5. **Mitnahme → Planning.** Aktiv, sobald der Sync-Plan keine offenen Zeilen mehr hat (sonst Hinweis
   „erst Write-back“). Die Mitnahme wird **in der Werkbank aus der Jira-Kopie gerechnet** (wie
   `jira-sprint-carry.sh`: alle Anker-Tickets des Reviews ohne den Mitnahme-Abschnitt, offen, kein
   Workstream; gruppiert überfällig / mit Datum / ohne Datum; dazu die `→ mitnehmen`-Zeilen) —
   **im Gleichlauf mit dem Skript (P1):** alle `PM-`-Keys des Review-Texts (Anker *und* Prosa-Links)
   ohne den Mitnahme-Abschnitt; bei `→ mitnehmen` wird der Stempel `✓ … → Planning:` abgestreift; dazu
   die Hinweiszeile „Board: n offen, davon m in dieser Liste“. Mit Stand der Jira-Kopie (P5).
   Tickets, die nicht in der Kopie sind, bleiben mit „nicht in der Kopie“ stehen (P2) —
   **nur lesend**, Download als Markdown im Format des Abschnitts. Die Kopie wird vorher für genau
   diese Tickets nachgeladen (bestehender Abgleich), damit eben geschlossene herausfallen. Ins
   Planning kommt sie über die vorhandenen „Kandidaten“ + „in Sprint nehmen“. In die Notiz schreibt
   den Abschnitt weiterhin `/sprint-sync` im Chat (kein Abschnitt-Ersetzen aus der Werkbank).

**Aktueller Zyklus** = neuester nicht archivierter Ordner mit Datum ≤ heute (heute: der erste nicht
archivierte). So springen Board-Filter, Roadmap, „Heute“ und Chat-Kontext nicht schon um, wenn der
Review-Ordner zwei Tage vorher angelegt wird. **Die Sprint-Seite selbst** zeigt weiter den neuesten
Ordner (auch zukünftig) — dort wird der Review ja vorbereitet (P3).

**Schrittstatus nur aus den Dateien (P4)**, kein gespeicherter Zustand: 1 „Review fehlt / da“; 2 „x von
y Paketen mit Antwort“; 3 „n von m bewertet“; 4 „k offene Notizen“ (Sync-Plan-Zeilen aus dem Parser);
5 „bereit“ / „erst Write-back“. Vorgewählt ist der erste Schritt, der nicht fertig ist.

**Fehlerfälle:** kein Vorzyklus → Entwurf aus der Vorlage mit Hinweis; Jira-Kopie leer → 409 „erst
abgleichen“; Ticket fehlt in der Kopie → Zeile bleibt, markiert (P2).

**Seitenaufbau (UX):** Kopf (Datum, Ziel in einer Zeile, Zyklus-Wähler) → Schrittleiste 1–5 als `<ol>`
mit `aria-current="step"` und Status in Worten → **ein** „Jetzt dran“-Block mit genau einer
Primäraktion → darunter eingeklappt mit Anzahl: Sprintziele/Im Sprint/Kandidaten, Zielbaum,
Pflegepunkte, Überfällig/Ohne Datum, Fragen aus Planning/Summary, Neuer Zyklus. Nichts Vorhandenes
fällt weg. Deep-Link `#/sprint/<id>/2`. Antwortfeld: `textarea` 16 px, sichtbares Label „Antwort zu
<Paket/Ticket>“, am Handy einspaltig, Knopf volle Breite. Leerzustände („Alles beantwortet“, „keine
Kandidaten“). Konflikt-Fehler: „Notiz wurde geändert — neu laden, dein Text bleibt“.

Was **Mensch bleibt:** Prosa, jede Bewertung, Paketschnitt (neue/zusammengelegte Pakete), S1–S4
setzen, Write-back freigeben, Tickets anlegen, Mitnahme-Abschnitt schreiben (Chat), Archivieren.

## 3. Entscheidungen für Knut

**E1 — Summary ohne Paket-Tabelle?** Heute dritte Kopie des Paketstands. Folgen: Skill-Abschnitt
„Summary“ und „beide Sichten“ ändern; `Olaf-Sprint-MOC` zeigt weiter auf die Summary, die MOC-Icons
(Workstream-Sicht) bleiben. Optionen: (a) Summary = Kopf (Monatsziele, Ziel, S1–S4 mit Bewertung,
Blocker, Links); (b) Paket-Tabelle bleibt, später aus dem Review generiert; (c) wie heute.
*Empfehlung:* (a). In diesem Paket wird dafür nichts gebaut, nur der Skill-Patch vorbereitet (E4).
  - Knut:

**E2 — Pakete vom Vorzyklus übernehmen statt neu ableiten?** *Empfehlung:* ja; neue oder
zusammengelegte Pakete macht die Runde bzw. der Agent im Chat, verwaiste Tickets stehen in
Auffälligkeiten.
  - Knut:

**E3 — Zeitpunkt.** *Empfehlung:* Entwurf am Freitag vor dem Montags-Termin, Antworten bis Montag 09:00;
kein Reminder-Bau (Skill: Reminder gehören nach Jira).
  - Knut:

**E4 — Skill-Patch** (Werkbank als Weg für Schritt 1–5, Fallback ohne S-Zeilen, Vorlage ohne
vorausgefüllte Bewertung, Summary nach E1) unter `review-pakete/143-sprint-werkbank/patches/`.
*Empfehlung:* ja; Hauptsitzung spielt nach E1 ein.
  - Knut:

**E5 — Sprint-Seite fürs Team freischalten** (`WERKBANK_TEAM_FEATURES=…,sprint`)? Ohne das bleibt
Schritt 2 für das Team in Obsidian; die Werkbank zählt es trotzdem. *Empfehlung:* erst nach einem
Zyklus mit Knut allein; bis dahin Obsidian.
  - Knut:

**E6 — Wer schreibt die Prosa?** (a) weiter ein Agent im Chat, jetzt auf dem Gerüst; (b) jede:r selbst.
*Empfehlung:* (a) auf dem Gerüst — der Agent soll Pakete und Anker übernehmen statt neu zu erfinden.
  - Knut:

## 4. Nicht in diesem Paket

Tickets anlegen · Archivieren · LLM-Prosa in der Werkbank · Reminder · Änderungen an `jira-*.sh` ·
Summary-Generator (E1) · Schreiben des Mitnahme-Abschnitts aus der Werkbank · N1…Nn-Planning-Entwurf
(die Kandidaten decken das ab) · Antworten ohne Bestätigungsdialog.

## 5. DoD (Prüfsätze)

- D1 Für einen Vorzyklus **mit** S-Zeilen enthält der Entwurf genau diese Zeilen wörtlich und
  `parseOutcomes` liest keine Bewertung; für einen Vorzyklus **ohne** S-Zeilen (echte Notiz 28.09.)
  genau eine Zeile „Sprint-Ziel“ mit dem Ziel-Satz und den Hinweis (Test).
- D2 Jedes Paket des Vorzyklus-Reviews steht im Entwurf mit seinen noch relevanten Tickets; in
  `## Die Updates` steht jedes Ticket genau einmal; keine Zeile des Entwurfs ist eine alte Antwort,
  `✓`-Zeile oder alte Frage; Tickets ohne Paket (im Zyklus angelegt/Status gewechselt) stehen unter
  `## Auffälligkeiten` (Test mit Fixture **und** gegen den echten Review 28.09., wenn `/vault` da ist).
- D3 `syncPlanRows` auf dem frischen Entwurf liefert **null** Zeilen (nichts geht ungewollt nach Jira),
  die leeren Antwortzeilen werden von `parseQuestions` als Antwortfeld mit Anker erkannt (Test).
- D4 Ohne `confirm` wird nichts geschrieben; eine vorhandene Datei wird nie überschrieben; bei
  vorhandenem Ordner werden nur fehlende Dateien angelegt (Test, Datei-Inhalt danach unverändert).
- D5 Mitnahme: berechnet ohne Skript-Aufruf und ohne Jira-Schreibaufruf; enthält offene Anker-Tickets,
  nicht die Done-Tickets; `→ mitnehmen`-Zeilen kommen mit (Test gegen Jira-Mock: Zähler der
  Schreibaufrufe bleibt 0).
- D6 Im Diff gibt es keinen neuen Aufruf von `writeJira`, `addComment`, `transitionTo`, `setDueDate`,
  `mcpCall` (grep-Prüfung im Bericht).
- D7 Aktueller Zyklus = neuester mit Datum ≤ heute (Test mit zukünftigem Ordner).
- D8 Sprint-Seite: Schrittleiste mit `aria-current`, ein Primärknopf im „Jetzt dran“-Block, Filter
  „nur meine“ wirkt, Bewertung mit Wort (Screenshots desktop 1440 und Handy 390, e2e gegen Test-Server).
- D10 Mitnahme-Gleichlauf: Prosa-Links zählen mit, der eigene Mitnahme-Abschnitt nicht, gestempelte
  `→ mitnehmen`-Zeilen bleiben drin (Test, P1).
- D9 `node --test` der Web-App ohne neue Fehler gegenüber der Basis (Basis: 2 bekannte rote Tests in
  `api.test.ts:1220` und `orchestrator.test.ts:244`, nicht sprintbezogen), `vite build` grün.

## 6. Council-Verlauf

**Runde 1 (12.10., vier getrennte Stimmen: Proponent, Spezialist, Devil's Advocate, UX) — HOLD (0,6).**
Bindend: Fallback ohne S-Zeilen · keine alten Antworten/Fragen/✓ übernehmen · Antwortzeile mit Anker und
Vorname · „genau einmal“ nur in Die Updates · Warnsatz Board-Stand, Done nur „im Zyklus“ und als Frage ·
nie überschreiben, fehlende Dateien ergänzen · kein Abschnitt-Ersetzen aus der Werkbank · Mitnahme nur
lesend aus der Kopie · kanal-neutral zählen, nie je Person · Zyklus nicht zu früh umspringen · UX-Gerüst
(Schrittleiste, eine Primäraktion, Kontext eingeklappt, Handy-Antwortfeld, Wort zur Bewertung,
Leerzustände, Trockenlauf benennen) · E5/E6 als Knut-Entscheidungen. Stärkster Gegenpunkt, sichtbar
gehalten: *ob das Team überhaupt in die Werkbank schreibt* — deshalb kanal-neutral und E5.

**Runde 2 (12.10., Rollen in getrennten Pässen in der Hauptsitzung — die Teilagenten-Grenze von 4 je
Nachricht war mit Runde 1 erreicht) — PASS (0,78).** Bedingungen: P1 Mitnahme im Gleichlauf mit
`jira-sprint-carry.sh` (Prosa-Links, Stempel, Hinweiszeile) · P2 fehlende Tickets markieren statt
weglassen, leere Kopie → 409 · P3 Sprint-Seite zeigt weiter den neuesten Ordner, alle anderen Stellen den
aktuellen ≤ heute · P4 Schrittstatus nur aus Dateien · P5 Stand der Kopie in Schritt 5 anzeigen.
Restpunkt, nicht blockierend: Antworten behalten den Bestätigungsdialog je Antwort (Vault-Regel); am Handy
lästig, wird mit E5 neu bewertet.
