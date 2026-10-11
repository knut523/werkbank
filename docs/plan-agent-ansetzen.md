---
status: Schnitt 2 (Teil A) von docs/plan-roadmap-zu-agent.md — Plan 09.10.2026, Council siehe unten; gebaut am Wochenende mit simuliertem Jira
quelle: docs/plan-roadmap-zu-agent.md, Teil A + Bedingungen 1–4, 7–10; E1–E5 entschieden (Knut, 09.10.2026: alle wie empfohlen)
zweig: feat/agent-ansetzen (von origin/dev 259f375; unabhängig von feat/heute-review-schlange und feat/orchestrator)
---

# Schnitt 2: „Agent ansetzen“ an einer Spec (Roadmap → Jira → Agent)

## Ziel

Knut nimmt eine Spec aus `3-Plan`, sieht eine Vorschau (Ticket-Felder, Dubletten, Agent-Auftrag) und bestätigt
**einmal**: Die Werkbank legt genau ein PM-Ticket an, liest es zurück, schreibt `jira:` in die Spec und setzt einen
Agenten darauf an. „Nur noch prüfen“ gilt erst **mit Schnitt 1** (Review-Schlange, `review_ready`, Push-Rückfrage auf
`feat/heute-review-schlange`): ohne ihn ist der Lauf ein normaler Karten-Agent, „fertig“ heißt dann nur „Sitzung bereit“.
`WERKBANK_ANSETZEN=live` deshalb erst nach Schnitt 1 einschalten (Council A9).

## Stand heute (origin/dev 259f375)

- Karten-Agent auf einem bestehenden Ticket: `POST /api/board/issue/:key/agent` (`main.ts`), `startChatAgent` (`agent.ts`).
- Jira-Schreiben nur Kommentar/Status/Fälligkeit/Labels/Parent/Priorität/Owner (`jirawrite.ts`), MCP oder REST.
  **Kein Anlegen.** `jira:` in eine Notiz: `addJiraFrontmatter` (`links.ts`).
- Spec-Liste: `roadmapSpecs()` (`main.ts`), offene „- Knut:“-Zeilen: `parseDecisions` (`roadmap.ts`).
- Sync-Sperre und atomares Schreiben: `syncLocked`, `writeAtomic` (`roadmapauto.ts`).
- Orchestrator (`feat/orchestrator`) startet Stränge über den internen Kanal mit Arbeitsordner und ohne Jira-Schreiben —
  für einen Ticket-Agenten aus der Roadmap passt der **Karten-Agent** (Projekt, Workstream-Bereich, Rückfrage vor
  Schreiben); der Orchestrator-Weg wird nicht benutzt. Übernommen wird nur seine 429/409-Behandlung in
  `createLibreChat` (wortgleich, damit die Zweige sauber zusammengehen).

## Entscheidungen, die hier gelten

- E2: Owner = die Person, die ansetzt (accountId aus `GET /myself`); „Passt“ kommentiert nur (Schnitt 1).
- E3: Fällig = Ende des laufenden Sprints (nächster Sprintbeginn − 1 Tag, sonst Beginn + 13 Tage; ohne Sprintordner + 14 Tage).
- E4: Workstream Standard PM-70, im Dialog änderbar (nur bestehende Workstreams der Kopie).
- E1: der Agent endet mit lokalem Branch und Rückfrage „pushen?“ — kommt mit der Agenten-Anweisung aus Schnitt 1.

## Schalter (Wochenend-Regel: kein echtes Jira)

`WERKBANK_ANSETZEN` = leer/`aus` (Vorgabe: Knopf zeigt „ausgeschaltet“, Route 403) · `sim` (simuliertes Jira: Tickets
`SIM-n` in der Werkbank-DB `jira_sim`, nichts verlässt den Rechner — nur für Test-Instanzen mit Vault-Kopie) ·
`live` (echter Weg: Anlegen über den konfigurierten Schreibweg, MCP `createJiraIssue` oder REST `POST /issue`).
Die Live-Werkbank bleibt damit unverändert, bis Knut `live` setzt.

## Schnitte

**S1 Server-Kern `ansetzen.ts`** (reine Funktionen + Ablauf)
- `specGate(spec)`: nur `3-Plan`, keine offene „- Knut:“-Zeile → sonst `{ ok:false, why, decisions }` (Bedingung 4).
- `ticketDraft(spec, …)`: Typ Task, parent, Titel = Spec-Titel, Beschreibung mit `Ziel:` (Spec-Abschnitt Ziel),
  `Ergebnis:` (Modus „bis Review“ → „Plandatei, Code auf lokalem Branch, Review-Paket“; „nur Plan“ → „Plandatei“),
  Spec-Pfad + `spec: <slug>` (für die Dublettensuche), DoD als Liste; Owner, Priority Medium, Fällig = Sprintende.
- `localDuplicates(spec, issues)`: `jira:` der Spec, Slug in der Beschreibung, ≥ 2 gemeinsame Titel-Begriffe.
- `AnsetzenJira`-Schnittstelle: `me`, `search(jql)`, `create(fields)`, `get(key)`, `fix(key, actions)`;
  `simJira()` und `liveJira(u)`.
- `ansetzen(u, spec, opts)`: Ablauf mit Absichts-Dokument `spec_tickets` (`_id` = Spec-Pfad):
  1. Vorprüfung: Admin, kein Trockenlauf, Schalter an, Gate, Claude-Token, Jira-Schreibweg — sonst Fehler, nichts geschrieben.
  2. Schlüssel bestimmen: `useKey` (Knut wählt die Dublette) · `jira:` der Spec · Schlüssel aus `spec_tickets` ·
     offene Absicht ohne Schlüssel → erst Live-Suche nach dem Slug (`text ~`), Treffer übernehmen · sonst Absicht
     speichern → anlegen → Schlüssel sofort speichern.
  3. Zurücklesen; Abweichungen bei parent/assignee/priority/duedate einmal nachziehen, erneut lesen; bleibt eine →
     Fehler mit Feldname, Ticket bleibt, Spec/Agent nicht.
  4. `jira:` in die Spec: nur bei freier Sync-Sperre, Hash wie in der Vorschau, `writeAtomic`; sonst `link: offen`
     (beim nächsten Klick nachgeholt).
  5. Agent starten (gemeinsame Funktion mit der Board-Route, Spec als `specPath` im Prompt, Bedingung 8). Volle
     Parallelgrenze (429) → `agent: wartet auf Platz`, Knopf „Agent starten“ (Bedingung 9).
- Live-Dublettensuche vor dem Anlegen: `summary ~` mit 2–3 Varianten (ganzer Titel, die zwei seltensten Begriffe) und
  `text ~ "<slug>"`, nur Projekt PM, offene und erledigte.

**S2 Routen** (`main.ts`)
- `POST /api/roadmap/ansetzen` ohne `confirm`: Vorschau (Gate, Entwurf, Dubletten lokal + live, Workstreams,
  Modus, Hash, Stand aus `spec_tickets`) — **0 Schreibvorgänge** (Bedingung 1).
- mit `confirm: true, hash, parent?, note?, mode?, useKey?`: Ablauf S1; Antwort je Schritt (`ticket`, `link`, `agent`).
- `GET /api/roadmap/ansetzen?path=` Stand für die Fortsetzung.

**S3 Oberfläche** (`web/src/AgentAnsetzen.tsx`, eingehängt in Rangliste und Spec-Ansicht im Wissen)
- Knopf „Agent ansetzen“ nur für Admins, nur bei Specs in `3-Plan`; sonst bei offenen Entscheidungen „Entscheiden“
  (Link auf die offenen Fragen).
- Dialog: Ticket-Vorschau (Titel änderbar, Workstream-Auswahl, Owner, Fällig, Priority), Dubletten mit „an PM-xxx
  ansetzen“, Modus „bis Review“ / „nur Plan“, Notiz; Hinweis „SIMULIERT“ im Modus `sim`; eine Primäraktion
  „Ticket anlegen und Agent starten“. Ergebnis je Schritt ✓/✗ mit Link zu Ticket und Chat; bei halbem Stand
  „Fortsetzen“.

**S4 Tests** (Bedingung 10)
- `jira-mock`: `POST /issue` (Schlüssel ab PM-1000), `GET /myself`, `text ~`/`summary ~` in `/search/jql`,
  Fehlereinspeisung (`failCreate: 'after'` = angelegt, aber 500; `dropFields` = Feld beim Anlegen verloren).
- Bridge-Mock: `createJiraIssue` liefert eine Antwort mit Schlüssel.
- Tests: Vorschau = 0 Schreibvorgänge; nicht Admin 403; Trockenlauf 409; Gate (Pre-Plan, offene Knut-Zeile);
  Dublette per Slug; Fehler nach dem POST + neuer Versuch = 1 POST; Zurücklesen zieht verlorenes Feld nach;
  `jira:` in der Spec, Sync-Sperre → `link: offen`; Agent mit Spec-Pfad im Prompt; 429 → wartet auf Platz;
  Sim-Modus Ende-zu-Ende.

## Definition of Done (aus dem Gesamtplan, Teil A)

1. „Agent ansetzen“ an einer Spec legt nach Vorschau genau ein Jira-Ticket mit Workstream-Parent, Owner, Priority, Fälligkeit, Ziel/Ergebnis an, liest es zurück, schreibt `jira:` in die Spec und startet den Agenten.
2. Dubletten-Prüfung vor dem Anlegen; erneuter Klick legt kein zweites Ticket an.
3. Ohne Jira-Zugang / ohne Claude-Token: klare Meldung, nichts halb angelegt.
6. Tests (Jira-Mock für Anlegen/Zurücklesen/Dublette/Fehler mittendrin), README, ausgerollt, Review.

(DoD 4 und 5 — Review-Schlange, Buckets — gehören zu Schnitt 1, `feat/heute-review-schlange`.)
Zusätzlich für diesen Wochenend-Bau: echter Weg hinter `WERKBANK_ANSETZEN=live`, aus; Test gegen echtes Jira am Montag.

## Nicht drin

Review-Schlange, `review_ready`, Push-Rückfrage (Schnitt 1); Ausrollen; echtes Jira.

## Council (09.10.2026, vor dem Bau)

Stimmen getrennt als Teilagenten: Spezialist (Technik/Jira), Advocatus Diaboli (anderes Modell), UX-Experte (Skill
ux-expert); Befürworter und Finalizer in der Hauptsitzung. Für Knut zur Nachprüfung (Wochenend-Regel).

**Befürworter.** Fast alles ist vorhanden (Karten-Agent, Schreibweg, `addJiraFrontmatter`, Sync-Sperre); neu sind ein
Anlegen mit Zurücklesen und ein Absichts-Dokument. Der Schalter hält die Live-Werkbank unverändert.

**Spezialist.** Idempotenz hat drei Lücken: Doppelklick während des Anlegens (MCP bis 120 s, Brücke 150 s) → atomare
Sperre mit Ablaufzeit; JQL-Suche ist kurz nach dem Anlegen blind → bei unklarem Ergebnis nie automatisch neu anlegen;
`_id` = Pfad bricht beim Zustandswechsel → Slug. Schlüssel aus `createJiraIssue` streng lesen, sonst „unklar“. Owner nie
aus dem Token der Kopie (sonst wäre Knut Owner für alle). Vault: Hash direkt vor dem Schreiben, `vaultDry`, Sync-Sperre
erneut prüfen. Sim: eigenes Feld, nur mit Vault-Kopie, nie in `jira_issues`. Prüfen: `parent`/`priority`/`duedate` auf
dem Anlege-Bildschirm von PM/Task.

**Advocatus Diaboli.** `jira: SIM-n` im echten Vault; Tippfehler im Schalter; Agent mit falschen Feldern; 409 und 429
als unsichtbare Halbzustände; Admin nur in der Oberfläche; „nur noch prüfen“ stimmt ohne Schnitt 1 nicht.

**UX-Experte.** Eine Primäraktion je Zustand; bei Dublette „An PM-xxx ansetzen“ primär, „Trotzdem neues Ticket“
sekundär; nicht durch Klick daneben schließen; Schritte mit ✓/✗ und `aria-live`; „SIMULIERT“ im Kopf und im
Knopf-Text; Knopf in der Spec-Zelle (nicht neue Spalte), in der Spec-Ansicht volle Breite; Modus als Radio mit Ergebnis.

```
VERDICT: HOLD (confidence 0.76) → nach Umsetzung: PASS für sim, live erst nach Montag + Schnitt 1
BINDING CONDITIONS (umgesetzt; Test in Klammern):
  A1 [must-fix] Schalter: nur „sim“/„live“ wirken, alles andere = aus mit Hinweis; sim nur mit WERKBANK_VAULT_IS_COPY=1,
                schreibt `sim-jira:`, nie in jira_issues; live beachtet Trockenlauf (ansetzen.test „Schalter“, „Simuliertes Jira“).
  A2 [must-fix] spec_tickets je Slug mit atomarer Sperre (4 min) — paralleler Doppelklick = 1 Anlegen, zweiter 409
                (ansetzen.test „Doppelklick parallel“).
  A3 [must-fix] Unklares Anlegen (5xx, Zeit, Schlüssel nicht lesbar) → „unklar“, Kandidaten zeigen, nie automatisch neu;
                neu nur mit „Trotzdem neues Ticket“ (api.test: Fehler nach POST + 2 Klicks = 1 POST; ansetzen.test „Unklar“).
  A4 [must-fix] Owner aus /myself des eigenen Zugangs oder atlassianUserInfo, nie aus dem Token der Kopie.
  A5 [must-fix] Zurücklesen inkl. Nachziehen parent/assignee/priority/duedate; bleibt eine Abweichung → kein Spec-Link,
                kein Agent; Agent bekommt das frisch gelesene Ticket (api.test: verlorene Priorität/Fälligkeit nachgezogen).
  A6 [must-fix] Spec-Link: Hash direkt vor dem Schreiben, Sync-Sperre, vaultDry, writeAtomic; sonst „offen“ und beim
                nächsten Klick nachgeholt (api.test mit gehaltener flock-Sperre).
  A7 [must-fix] Admin aus der Sitzung (needAdmin); Bestätigen nur mit dem Hash der Vorschau (api.test 403/409).
  A8 [must-fix] 429/409 beim Agent-Start → „Agent offen“ mit Grund, gespeichert, „Fortsetzen“ (api.test mit 429).
  A9 [must-fix] Ziel ehrlich: „nur noch prüfen“ erst mit Schnitt 1; live erst danach.
  A10 [should]  Sim-Ticket im Agent-Auftrag als SIMULIERT markiert („nicht in Jira suchen/schreiben“).
  A11 [should]  Fälligkeit mit Herkunft in der Vorschau (Sprintende / Fallback sichtbar).
  A12 [should]  UX-Punkte 1–9 (Screenshots im Review-Paket 119).
  V1 [verify]   Montag, echtes Jira: createJiraIssue über den MCP — Antwortform (Schlüssel lesbar?), parent für Task
                unter Workstream, Priorität „Medium“, duedate beim Anlegen, Owner = Knut.
NOTES: createJiraIssue bleibt NICHT im direkten MCP-Weg der Brücke (dein Test mcpdirect sagt ausdrücklich „nicht
       freigegeben“) — die Antwort läuft über die Claude-Sitzung, gekürzt auf 2000 Zeichen; der Schlüssel steht vorn.
       Für Knut zur Nachprüfung. Restrisiko Sync-Sperre: Prüfung und Schreiben sind nicht atomar (flock wird nicht gehalten).
```

## Stand nach dem Bau (09.10.2026)

- DoD 1: erfüllt gegen Jira-Nachbau und simuliert; echtes Jira offen (V1, Montag).
- DoD 2: erfüllt (Dubletten lokal + Jira-Suche, Spec-Kennung, Sperre, unklar ≠ neu).
- DoD 3: erfüllt (ohne Claude-Token 412 „Nichts angelegt“; ohne Jira-Schreibweg 412).
- DoD 6: Tests ja; README ja; ausgerollt nein (Wochenend-Regel); Review: Knut.
