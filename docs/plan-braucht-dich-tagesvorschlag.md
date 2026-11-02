# Plan: „Braucht dich“ verstehen + Tagesvorschlag (Release 30b)

---
status: Plan 02.11.2026
quelle: Auftrag Knut 30.10./02.11. (Hauptsitzung) — R30b Teil A „Braucht dich über den Hauptchat“ + Teil B
  (docs/plan-tagesvorschlag.md); Nachtrag Hauptsitzung 02.11. („ich weiß nicht, was ich in diesen Situationen
  tun soll … wir sollten das systematisch fixen“): drei reale Karten, die Knut nicht versteht.
basis: release/werkbank-2026-10-29 (= Live R29), Branch feat/r30-braucht-dich-tag
---

# Plan: „Braucht dich“ verstehen + Tagesvorschlag

## Ziel

**A) „Braucht dich“ verstehen.** Was ein Strang von Knut braucht, ist eine echte Frage mit Kontext, Optionen und
Empfehlung — kein Rohbericht. Jede „Braucht Knut“-Zeile wird klassifiziert:

- **(a) echte Entscheidung für Knut** → Entscheidungsseite (Karte mit Kontext · Optionen · Empfehlung · Knöpfe).
- **(b) Aktion, die der Hauptchat selbst kann** (Push nach Gate, Merge im Worktree, Skill installieren, CLI laufen
  lassen, Strang neu starten) → geht als Aufgabe an den Hauptchat, nicht als Frage an Knut.
- **(c) erledigt/veraltet** (schon beantwortet, Commit schon live, PR geschlossen/gemergt, Strang durch neueren ersetzt)
  → automatisch geschlossen mit Begründung.

Budget-Fragen („Budget erreicht“) bekommen Knöpfe „schließen“ / „+50 % Budget“ direkt auf der Karte.
Der Hauptchat bündelt die offenen Fragen und zeigt sie gebündelt; die Antwort geht automatisch zurück an den Strang.
Die Karte zeigt nie Rohbericht-Stichpunkte, sondern „Was du tun musst“ in einem Satz + Knopf — oder „nichts, das
erledigt der Hauptchat“.

**B) Tagesvorschlag.** „Mein Tag“ schlägt den Tag vor statt einen leeren Tag zu zeigen
(Regeln s. docs/plan-tagesvorschlag.md, wörtlich übernommen unten).

Beide Teile hinter Schaltern, Vorgabe **aus**.

## DoD (wörtlich aus dem Auftrag)

- DoD A: drei echte Beispiele (Admin-UAT e3ea4584 · Ticker-Fix Paket 269 Commit 5899146 · tariff-app#193 „Merge
  erlauben/ausführen“) als Testfälle mit Fixtures aus den echten Berichten: Beispiel 1 und 2 landen in (c)
  (erledigt/veraltet), Beispiel 3 in (b) (Hauptchat-Aufgabe).
- DoD B: leerer Tag → Vorschlag sichtbar; „Übernehmen“ legt Blöcke an; „Verwerfen“ je Block; Test mit echten
  Morgenlage-Daten (Fixtures aus dem echten Erzeuger), aktiver Browser-Test mit Screenshot.
- Gezeigt an der lokalen Testinstanz (scripts/isoliert.sh) mit echten (kopierten) Daten, Screenshots 1440 + 390 px.
- Suite grün (`node --test`, saubere Umgebung), Pläne in docs/.

## Schnitte

### S1 — Klassifikation der „Braucht Knut“-Zeilen (Server, rein): `web/server/braucht.ts` (neu)

Reine Funktion `klassifiziere(zeile, kontext) → { art: 'entscheidung' | 'aktion' | 'veraltet', … }`:

- **veraltet-Prüfungen (c)**, rein und testbar ohne Netz/Git:
  - `antwortVorhanden`: Frage ist über die Inbox/Entscheidungsseite schon beantwortet (Log-Vergleich über Kennung).
  - `commitLive`: genannter Commit ist im Live-Stand (Inhalt über die `standFrom`/`paketInSubject`-Maschinerie aus
    releasestand.ts — die prüft Merge-Commits nach Paketnummer, nicht nur Git-Abstammung).
  - `neuererStrang`: ein jüngerer Strang mit gleichem `lauf`/Ziel existiert.
- **aktions-Erkennung (b)**, Muster-Regeln („Push … laufen lassen“, „Merge … in diesem Strang“, „Skill … installieren“,
  „Strang neu starten“, „CLI … laufen lassen“): Aktionen, die der Hauptchat ausführen kann (github_schreiben push,
  pr_oeffnen; Strang-Neustart über orch-Aktionen) — die Liste der ausführbaren Aktionen des Hauptchats ist bekannt
  (WERKBANK_HAUPTCHAT_GITHUB, orch_starten).
- **entscheidung (a)**: alles andere — die Zeile wird zur Frage aufgebaut: `wasTun`-Schritt (ein Satz „Was du tun
  musst“) aus heutekarte.ts als Titel, Kontext aus worum/plan, Optionen/Empfehlung falls ableitbar, sonst
  Ja/Nein/Anders.

### S2 — Hauptchat-Bündelung + Aktionen an den Hauptchat (Server): Erweiterung `web/mcp/werkbank-tools.ts` + main.ts

- Neues internes API `GET /internal/braucht` (nur Hauptchat): die klassifizierten offenen „Braucht dich“-Punkte,
  gebündelt nach Strang, je Karte: Kontext · Optionen · Empfehlung · „Was du tun musst“ · Kommentarzeile.
- (b)-Punkte: statt einer Frage an Knut erscheinen sie dem Hauptchat als ausführbare Aufgabe (z. B.
  „Merge in Strang X ausführen“ → github_schreiben pr_oeffnen/push nach Gate) und werden mit Begründung aus der
  Knut-Sicht entfernt.
- (c)-Punkte: automatisch geschlossen mit Begründung (Eintrag im Log, Nachricht an den Strang, Karte verschwindet).
- Strang schließen/archivieren als Aktion (gibt es in orch heute nicht): `POST /internal/orchestrator/aktion` mit
  `aktion: 'archivieren'` → setzt `reviewedBy: 'auto'`, `zustand: 'erledigt'` mit Grund (aufraeumen.ts-Muster).

### S3 — Budget-Knöpfe auf der Karte (Server + UI): entscheidungsseite.ts / Entscheidungen.tsx

- Budget-Fragen (kind 'budget' aus cosbudget.ts) erscheinen mit Knöpfen „schließen“ / „+50 % Budget“ statt
  Ja/Nein/Anders. „+50 % Budget“ = bestehende answerQuestion-Logik (budgetTokens × 1,5), „schließen“ = Anhalten.

### S4 — Tagesvorschlag (Server + UI): `web/server/tagesvorschlag.ts` (neu) + timebox.ts/Timebox.tsx

- `vorschlag({ morgenlage, fragen, brauchtKnut, carryOver, termine })` → Blöcke nach den Regeln aus
  plan-tagesvorschlag.md (rein, regelbasiert; kein Modell, kein Schreiben).
- `Block.quelle: 'vorschlag'` (neues Feld, cleanBlock prüft es mit).
- GET /api/timebox: wenn der Tag leer ist und `WERKBANK_TAGESVORSCHLAG=an`, liegt der Vorschlag bei; sonst
  Hinweis „Vorschlag ansehen“.
- POST /api/timebox/vorschlag: `uebernehmen` (legt alle Blöcke mit quelle 'vorschlag' an) / `verwerfen` je Block
  (löscht sie). Bis zur Übernahme sind die Blöcke grau dargestellt (nur lesbar, kein Drag).
- Termine aus dem ICS-Feed nur, wenn COS_ICS an; Lücken statt Überlappung.

### S5 — Ansicht „Braucht dich“ (UI): Erweiterung Entscheidungen.tsx (bestehende Karte)

- (a)-Karten in der bestehenden Entscheidungsseite mit vollständigerem Kontext (wasTun-Schritt statt
  Rohbericht); „Was du tun musst“ als hervorgehobener Satz; „nichts — erledigt der Hauptchat“ als Statuszeile
  bei (b)-Punkten mit der Aktion, die der Hauptchat ausführt.

### Tests (neu: `web/test/braucht.test.ts`, `web/test/tagesvorschlag.test.ts`, Fixtures `web/test/fixtures/`)

- Fixtures aus den echten Berichten (Admin-UAT e3ea4584, Ticker-Fix Paket 269, tariff-app#193) — als
  Stand-Auszüge/Berichtsköpfe nachgebaut, keine echten IDs/Daten aus Produktion ins Fixture kopieren außer den
  ohnehin öffentlichen Commits/Paketnummern.
- Drei Beispiele aus dem Nachtrag als Testfälle: (c), (c), (b).
- Regel-Tests Prio 1–3, max 3 Muss, Bündelung, Lücken statt Überlappung, nur-leerer-Tag.

## Schalter

- `WERKBANK_BRAUCHT_DICH` (Vorgabe aus) — Teil A komplett: Klassifikation, Bündelung, Budget-Knöpfe.
- `WERKBANK_TAGESVORSCHLAG` (Vorgabe aus) — Teil B komplett.

## Offene Entscheidungen (Knut)

| # | Kontext | Optionen | Empfehlung |
|---|---|---|---|
| D1 | Budget-Knöpfe: Auftrag sagt „schließen“ / „+X Budget“, bestehende Logik sagt „Weiter mit +50 %“ / „Anhalten“ (×1,5) | 1) „schließen“ / „+50 % Budget“ wie der Auftrag · 2) bestehende Bezeichner „Weiter mit +50 %“ / „Anhalten“ · 3) frei konfigurierbarer Faktor | 1) — Auftrags-Wortlaut, Faktor bleibt 1,5 wie bisher |
| D2 | (b)-Aktionen des Hauptchats: automatisiert ausführen oder nur vorschlagen? Push/Merge nach Gate ist über WERKBANK_HAUPTCHAT_GITHUB freigegeben, braucht aber Knuts „Ja“ im Chat | 1) Hauptchat schlägt die Aktion vor, Knut klickt Ja (heutiger Freigabe-Weg) · 2) Hauptchat führt automatisch aus, wenn das Gate grün ist | 1) — Freigabe-Weg bleibt, Karte wird aber verständlich („Hauptchat kann Push nach Gate — Freigabe nötig“) |
| D3 | „Braucht dich“-Ansicht: eigene neue Seite oder Erweiterung der bestehenden Entscheidungsseite? | 1) Erweiterung der bestehenden Seite (Karte bekommt „Was du tun musst“ + Klassifikation) · 2) eigene Ansicht „Braucht dich“ | 1) — es gibt schon die Seite aus demselben Vorbild, eine zweite würde die Zahl der Orte erhöhen, an denen Fragen liegen |
| D4 | Tagesvorschlag-Termine aus ICS: nur wenn COS_ICS an — in der Testinstanz ist COS_ICS aus, Screenshots ohne Termine | 1) so lassen, DoD-Screenshots ohne Termine · 2) COS_ICS in der Testinstanz an | 2) — Termine sind Teil des Vorschlags und im Test einfach schaltbar |

## Prüfung

- `node --test` mit sauberer Umgebung (`env -i HOME=$HOME PATH=$PATH …`), jeder DB-Test closeDb().
- Schwere Läufe über `flock /tmp/olaf-schwer.lock`.
- Aktiver Test: scripts/isoliert.sh mit kopierten Daten, Screenshots 1440 + 390 px.
- Pass C: `challenge` art=diff gegen die Basis.
