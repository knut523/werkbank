---
status: Plan 12.10.2026 (Paket 141), Council siehe unten
quelle: Auftrag Knut 12.10.2026 („Heute — bin mir nicht sicher, was ich wirklich machen muss … da steht nur gemacht / nicht gemacht und Risiko, aber ich weiß nicht, worum es geht.“)
basis: release/werkbank-2026-10-11d (7fce7f0), Branch feat/heute-verstaendlich
---

# Heute verständlich: worum es geht, was zu tun ist

## Ziel

Jede Karte unter „Wartet auf dein Review“ beantwortet ohne Aufklappen, in dieser Reihenfolge:
**Worum es geht** · **Was du jetzt tun sollst** · **Stand** (live / in Release N / lokal fertig / läuft) ·
und am Knopf, **was „Passt“ bewirkt**. Gemacht / Nicht gemacht / Risiko / DoD bleiben, aber eingeklappt unter
„Details“. Karten zu Strängen, die schon live sind, sagen „Ist live seit Release N — nur noch abhaken“ und lassen
sich gesammelt abhaken.

## Stand heute (Code, 7fce7f0)

- `web/src/pages/Heute.tsx`, `ReviewBody`: Gemacht, Nicht gemacht, Risiko, DoD. Strang-Karten ohne review_ready zeigen
  den „### Stand“-Auszug der letzten Antwort.
- `strandCards()` (`web/server/leitstand.ts`) liefert Titel, review, Auszug, `bericht: boolean` — Auftrag (`prompt`,
  gekürzt auf 500 Zeichen), Plandatei (`plan`) und Bericht-Pfad (`bericht`) liegen im Dokument, werden aber nicht
  ausgewertet.
- Ob ein Strang live ist, weiß die Werkbank nicht. Die Information steht in Git: die Live-Instanz committet
  „Live = release/… (werkbank-gh SHA)“, die Release-Zweige im Quell-Repo tragen Merge-Commits
  „Merge feat/x (Paket NNN …)“.

## Schnitte

**S1 Karteninhalt (Server, rein + getestet) — `web/server/heutekarte.ts`.**
- `worumGeht({ title, prompt, planText, berichtText })` → ein Satz: Plan-Titel (H1) + erster Satz von „## Ziel“/„Ziel:“
  des Plans; sonst „Ziel:“ bzw. „## Ziel“ im Bericht; sonst „Ziel:“ im Auftrag; sonst erster Satz des Auftrags ohne
  „Auftrag (…):“-Vorspann. Höchstens 240 Zeichen.
- `wasTun({ berichtText, excerpt, paket })` → 1–3 Schritte aus „Für Knut zur Nachprüfung“ (bzw. „Braucht Knut“ im
  Bericht), sonst aus „- Braucht Knut: …“ im „### Stand“-Auszug; „nichts“ zählt nicht. Relative Links im Schritt zeigen
  auf die Paket-Datei (`api/files/agenten/<paket>/<rel>`). Mehr als 3 Schritte → „+ n weitere im Bericht“.
- Stand (nach Council, Bedingung 1–3): **live heißt „im Live-SHA enthalten“**, nicht „im Live-Zweig“. Aus dem Log der
  Live-Instanz (`WB_ROOT`, Betreffe `Live = release/… (werkbank-<repo> <sha>)`) kommen die Live-Einträge; der neueste
  gibt den Live-SHA. Release N = Reihenfolge des ersten Auftretens eines Release-Zweigs im Live-Log (11 = 1 … 11d = 4);
  Zweige ohne Live-Eintrag hängen sich danach an. Beleg je Strang: der HEAD seines Arbeitsordners (`d.cwd`, nur wenn
  sauber: `git status --porcelain --untracked-files=no` leer). `live` ⇔ `git merge-base --is-ancestor <HEAD> <Live-SHA>`
  im Quell-Repo; „seit Release N“ = erster Live-Eintrag, der ihn enthält. Sonst in einem `release/*`-Zweig enthalten →
  „in Release N, noch nicht live“. Ist der Ordner weg: Rückfall auf Merge-Commits mit eindeutiger Paketnummer (Ordnername
  aus dem Bericht-Pfad, nie die Nummer allein bei Dubletten) — auch dort Vorfahrschaft gegen den Live-SHA. Hat der
  Ordner neuere Commits als das, was live ist (Merge des Pakets live, HEAD nicht): `teilweise` („live seit Release N,
  neuere Commits noch nicht“) — nie in der Live-Gruppe. Kein Index (git weg/Fehler) → kein Chip.
- Git lesen (`web/server/releasestand.ts`): nur `execFile('git', …)` asynchron, ohne Shell, Timeout 3 s, kein Text
  aus Strängen in Argumenten außer geprüften SHAs/Pfaden; Ergebnisse je (SHA, Live-SHA) gecacht, Live-Log 60 s, gleichzeitige
  Aufrufe teilen ein Promise. Quell-Repo `WERKBANK_SOURCE_REPO` in `config.ts` (Vorgabe `~/work/knut/werkbank-gh`).
- Plandatei sicher lesen (Bedingung 4): wie `readBericht` (O_NOFOLLOW, O_NONBLOCK, isFile, ≤ 200 KB), nur `.md`
  unter `~/work`; Cache über Pfad + mtime + Größe.

**S2 `/api/today` und gesammeltes Abhaken (Server).**
- `strandCards(u, { detail: true })` hängt `worum`, `todo`, `todoMore`, `stand`, `paket` an (nur für `/api/today`; der
  Zähler liest weiter nur Mongo).
- `POST /api/leitstand/strands/passt-live { items: [{ id, seen }] }` (nur Admins): rechnet den Stand je Strang **selbst**
  neu (vertraut dem Browser nicht), hakt nur `live` ab, prüft den gesehenen Stand und „arbeitet gerade“ wie beim
  einzelnen „Passt“, Notiz „live seit Release N (gesammelt abgehakt)“. Antwort `{ done, skipped: [{ id, why }] }`.

**S3 Karten (Web).**
- Strang- und Lauf-Karten: Block „Worum es geht“ · „Was du jetzt tun sollst“ (Liste mit Links, sonst „Nichts zu tun,
  nur zur Kenntnis.“) · Stand-Chip · Knöpfe mit Hinweiszeile („Passt: markiert als geprüft — nichts wird geschrieben,
  gepusht oder gemergt.“ / mit Jira-Kommentar: „… und schreibt nach Bestätigung einen Kommentar in Jira.“ ·
  „Nacharbeit: dein Text geht als neue Nachricht an den Agenten, er arbeitet weiter.“).
- Gemacht / Nicht gemacht / Risiko / DoD in `<details>` „Details“ (zu).
- Karten mit Stand `live`: eigene Gruppe am Ende „Schon live — nur noch abhaken (n)“, Text „Ist live seit Release N —
  nur noch abhaken“, Knopf „Alle live gegangenen als geprüft markieren“ mit Bestätigungsdialog (Liste der Titel).
- Lauf-Karten (Jira-Agentenläufe): „Worum es geht“ = Ticket + Titel; „Was tun“ = „Ergebnis im Chat ansehen, dann
  Passt oder Nacharbeit.“, wenn „Nicht gemacht“ etwas nennt: dieser Text als zweiter Schritt.

## DoD (Prüfsätze)

1. Eine Strang-Karte mit Plandatei zeigt unter „Worum es geht“ den Plan-Titel und den ersten Satz von „## Ziel“ — Test `heutekarte`.
2. Ohne Plan und ohne Ziel im Bericht zeigt sie den ersten Satz des Auftrags ohne „Auftrag (Knut …):“-Vorspann — Test.
3. Ein Bericht mit „## Für Knut zur Nachprüfung“ (4 Punkte) ergibt genau 3 Schritte und „+ 1 weiterer im Bericht“ — Test.
4. Ein relativer Link `bilder/a.png` in einem Schritt zeigt auf `api/files/agenten/<paket>/bilder/a.png` — Test.
5. Ohne Bericht-Schritte, aber mit „- Braucht Knut: Token freigeben“ im Stand-Auszug, ist das der Schritt; mit „nichts“ steht „Nichts zu tun, nur zur Kenntnis.“ — Test + Screenshot.
6. Ein Strang-HEAD, der im Live-SHA von 11c enthalten ist, ergibt bei Live = 11d „live seit Release 3“; ein HEAD nur in der Spitze eines Release-Zweigs, nicht im Live-SHA, ergibt „in Release N, noch nicht live“ (11b-Fall); ohne Release „fertig, in keinem Release“; HEAD mit Commits nach dem Merge → „teilweise“ — Test.
7. Eine Paketnummer mit zwei Ordnern (140) wird nicht über die Nummer zugeordnet — Test.
8. Fehlt das Quell-Repo oder scheitert git, liefert `/api/today` die Karten ohne Stand-Chip statt eines Fehlers — Test.
9. `/api/today/count` ruft weder git noch Dateien auf (Zähler bleibt Mongo-only) — Code-Review/Test.
10. „Passt“ und „Nacharbeit“ tragen eine sichtbare Hinweiszeile, was sie bewirken; mit Häkchen „mit Jira-Kommentar“ ändert sich der Hinweis — Screenshot.
11. Gemacht / Nicht gemacht / Risiko / DoD stehen in einem zugeklappten „Details“ — Screenshot + e2e.
12. Live-Karten stehen in der Gruppe „Schon live — nur noch abhaken“ mit „Ist live seit Release N — nur noch abhaken“ — Screenshot.
13. „Alle live gegangenen als geprüft markieren“ fragt mit Liste nach; nach „Abhaken“ verschwinden genau die Live-Karten — e2e/Test.
14. `passt-live` hakt einen Strang, der laut Server nicht live ist, nicht ab (auch wenn der Browser ihn schickt), und keinen mit verändertem gesehenem Stand — Test.
15. `passt-live` ist für Nicht-Admins 403 — Test.
16. Handy (390 px): Worum/Was tun/Stand/Knöpfe ohne waagrechtes Scrollen, Knöpfe ≥ 44 px — Screenshot.
17. Repo-Tests grün (`scripts/werkbank.sh test` bzw. eigene Test-Mongo), `vite build` ohne Fehler.

## Nicht in diesem Schnitt

- Kein Schreiben in Vault, Jira, GitHub; Live-Instanz unverändert.
- Keine Änderung am Zähler „Heute (n)“ (siehe Entscheidung E1 im Bericht).
- Keine Zusammenfassung durch ein Sprachmodell — nur Text aus Plan/Bericht/Auftrag.

## Council (Runde 1, 12.10.2026)

Rollen: Proponent + Engineering, Devil's Advocate, UX (ux-expert), je eigener Teilagent; Finalizer hier.

**VERDICT: HOLD (0,7)** — Richtung stimmt (nur vorhandene Texte, kein Schreiben, Zähler bleibt Mongo-only), aber die
Live-Erkennung über Zweignamen hätte genau den gefährlichsten Fehler erzeugt (Beleg im Git: 11b war erst bei 258cdec
live, der Zweig wuchs danach bis 0a6876a).

Bindende Bedingungen:
1. [must-fix] Live nur über Vorfahrschaft zum SHA des neuesten Live-Commits; Test „Live-SHA älter als Zweigspitze →
   in Release N, nicht live“ (11b-Fall).
2. [must-fix] Nacharbeit nach dem Merge: HEAD des Arbeitsordners muss im Live-SHA enthalten sein, sonst `teilweise`,
   nie Live-Gruppe; dieselbe Prüfung in `passt-live` (frisch, ohne Cache).
3. [must-fix] Live-Log-Regex akzeptiert `werkbank-gh` und `werkbank-release`; Tests gegen die echten Betreffe;
   Release N aus dem Live-Log statt Namensreihenfolge.
4. [must-fix] Plandatei nur über einen sicheren Leser (kein Symlink, keine FIFO, Größe).
5. [must-fix] Links in Schritten nur relativ, ohne Schema/`..`/absolute Pfade, Paket = Ordnername aus dem Bericht-Pfad.
6. [must-fix] git nur asynchron mit Timeout, Runner injizierbar; Brücke weg → `passt-live` überspringt alle mit Grund statt 503.
7. [must-fix] Einzel- und Sammel-„Passt“ teilen eine Prüffunktion (seen, running, reviewOrch); `items` ≤ 30.
8. [ux] Live-Gruppe eingeklappt (`<details>`), je Strang eine Zeile, Sammelknopf auch zugeklappt erreichbar; Zahl am
   h2 zählt nur Nicht-Live.
9. [ux] Risiko bleibt sichtbar: Zusammenfassung der Details nennt „⚠ Risiko“, und ein genanntes Risiko steht einzeilig
   über den Knöpfen.
10. [ux] Stand-Chip im Kartenkopf, Klartext („live seit Release 3“ · „in Release 4, noch nicht live“ · „fertig, in keinem
    Release“ · „Agent arbeitet“); Bedeutung im Text, nicht nur Farbe.
11. [ux] Leerer Schritt: „Nichts zu tun außer lesen — dann ‚Passt‘.“; Sammel-Abhaken mit Titel-Liste im Dialog und
    Rückmeldung „n abgehakt · m übersprungen (Grund)“.
12. [verify] Screenshot handy mit vielen Karten, davon mehrere live: „Wartet auf dich“ ist ohne langes Scrollen erreichbar.

Notiz (Devil's Advocate, nicht blockierend): Release-Nummern sind Anzeige; der Zweigname steht im Tooltip.

## Review des Diffs (12.10.2026)

- Runde 1: Spec/Standards/UX 9/12 Bedingungen, feindlicher Pass FAIL (HEAD im Live-SHA schlug einen noch nicht live
  gegangenen Merge → falsches „live“). Alles ab Konfidenz 50 behoben, je mit Regressionstest (`heutekarte.test.ts`
  „Review-Fix 1/2“), Bedingungen 8, 11, 12 nachgezogen (Knopf außerhalb `<details>`, Gründe im Toast, Sprungzeile).
- Runde 2: PASS-WITH-CONCERNS; B1–B5 behoben (Test „Review-Runde 2“): `git status` scheitert → kein Beleg; Merge vor
  der letzten Anweisung belegt nichts ohne eigenen Worktree; neue Dateien zählen; nur der beim Start für den Strang
  angelegte Worktree (`ownWorktree`) belegt; Cache-Schlüssel mit Strang-Stand. B6 bewusst nicht (würde „Keine Tests
  geschrieben“ verstecken).
- Nicht umgesetzt, an Knut: git-Aufrufe in Strang-Ordnern zusätzlich mit abgeschalteten fsmonitor- und Hook-Einstellungen
  (per `-c`) härten — im Orchestrator-Strang gesperrt.
