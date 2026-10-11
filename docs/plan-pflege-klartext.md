---
status: Plan 11.10.2026 — Council siehe unten
quelle: Auftrag Knut 11.10.2026 („mach es in dem Task-View einfacher zu verstehen, was fehlt (braucht Pflege …)“), Paket 136
---

# Pflege in Klartext

## Ziel

Auf einen Blick sehen, **was** einem Ticket fehlt und **was zu tun ist** — ohne Hover, auch auf dem Handy.

## Stand heute (Code, Basis release/werkbank-2026-10-11b)

- Board-Karte: `🧹 n`, die Regelnamen nur im Tooltip (`src/pages/Board.tsx:65`), Sub-task-Zeile ebenso (`:42`),
  Sub-task-Leiste `🧹 n` (`:77`), Bahn `🧹 n` (`:542`), Owner-Auswahl `· 🧹 n` (`:521`).
- Die Regeln (`server/hygiene.ts`) kennen je Befund `detail` und `question`; zum Board gehen nur die Regelnamen
  (`hygieneAll` → `string[]`, `server/assist.ts:162`), ohne Tage.
- Vieles steht schon als eigener Chip auf der Karte: Datum („über 15.09.2026“, „ohne Datum“), „ohne Owner“,
  Banner „⚠ kaputt“/„ohne Parent“. Nur **still** und **Widerspruch** sieht man ausschließlich über `🧹`.
- Die Handlungen gibt es schon im Ticket-Detail (Board-Schublade): Fälligkeit setzen, Owner, Ziel, Status, Kommentar —
  jeweils mit Vorschau und Bestätigung über den bestehenden Schreibweg.
- „Heute“ (`HygienePanel`) zeigt den Regelnamen als Chip plus eine Frage; „Sprint“ verweist nur auf „Heute“.

## Schnitt (ein Commit)

**S1 Eine Quelle für die Texte** — neues `web/src/pflege.ts`: `PFLEGE: Record<Rule, { label(days), art, tun, act, knopf }>`,
`befundText(b)`, `zusammenfassung(befunde)` („3 überfällig · 2 ohne Datum · 1 still“) und `GLOSSAR`. Keine Texte doppelt.

**S2 Server: Tage mitgeben** — `hygieneAll` liefert `{ rule, days? }[]` statt `string[]` (Zähler unverändert);
`GET /api/board/issue/:key` liefert zusätzlich `hygiene` des Tickets selbst. Keine neuen Endpunkte, keine Schreibwege.

**S3 Karte** — statt `🧹 n` eine Pflege-Zeile mit Klartext-Chips. Ein Befund, der schon als eigener Chip sichtbar ist,
bekommt keinen zweiten Chip; stattdessen spricht dieser Chip Klartext:
- Datum: überfällig → „26 Tage überfällig · 15.09.“, ohne Datum → „Datum fehlt“ (statt „über 15.09.2026“/„ohne Datum“).
- „Sub-task ohne Owner“ → der vorhandene Chip „ohne Owner“ (unverändert).
- „ohne Workstream“/„Sub-task ohne Parent“ → das vorhandene Banner (unverändert).
- übrig bleiben als Pflege-Chips: „seit 14 Tagen still“, „Kommentar sagt „erledigt““, (heute bearbeitet).
Sub-task-Zeilen gleich. (Ein „+n“ entfällt: nach der Dedupe bleiben höchstens zwei Pflege-Chips — still und Widerspruch; „heute bearbeitet“ liefert `hygieneFor` nicht.) Bahn: „5 brauchen Pflege“,
Sub-task-Leiste „1 braucht Pflege“, Owner-Auswahl „· 3 Pflege“ statt `🧹`.

**S4 Was zu tun ist — im Detail** — oben im Ticket-Detail ein Kasten „Was fehlt“: je Befund Klartext + ein Satz,
was zu tun ist, + ein Knopf, der zum vorhandenen Feld springt (Datum setzen → Fälligkeit, Owner wählen → Owner,
Ziel zuordnen → Ziel, Status ändern → Übergänge, Stand schreiben → Kommentar, Jira-only → „In Jira öffnen“).
Der Knopf schreibt **nichts**; geschrieben wird wie bisher erst nach Vorschau + Bestätigung.

**S5 Filter „Braucht Pflege“** — über dem Board eine Zeile „Was fehlt: 3 überfällig · 2 ohne Datum · 1 ohne Owner · 1 still“,
gezählt über die sichtbaren Karten und Sub-tasks (folgt Owner-/Sprint-/Suchfilter).

**S6 Gleiche Texte auf „Heute“** — `HygienePanel` zeigt statt des Regelnamens das Klartext-Label (mit Tagen).
Sprint verweist schon auf „Heute“ — keine Änderung nötig.

**S7 Glossar** — einklappbares „Was heißt …?“ (`<details>`) unter der Filterzeile (nur bei „Braucht Pflege“),
im Detail-Kasten und im `HygienePanel`: Pflege, still, Widerspruch, ohne Workstream, ohne Owner.

## Nicht in diesem Schnitt

- „später“ (Snooze) auf dem Board: Snooze ist Fragen-Zustand **je Person** und blendet nur Fragen aus, nicht Board-
  Befunde; auf Karten fremder Owner wäre er irreführend. Bleibt auf „Heute“.
- Keine neuen Jira-Schreibwege, kein Schreiben direkt aus einem Chip.
- Chat-Fragen (`hygieneBlock`) und MCP `hygiene_list` bleiben unverändert (sie nutzen `question`).

## DoD (Prüfsätze)

1. Auf einer Board-Karte steht nirgends mehr `🧹 n`; jeder Befund ist als Klartext sichtbar, ohne Hover. (e2e: Karte enthält kein „🧹“, enthält „Tage überfällig“.)
2. „still“ erscheint als „seit N Tagen still“, „Widerspruch“ als „Kommentar sagt „erledigt““. (Unit-Test `pflege.test.ts`.)
3. Kein Befund steht doppelt auf einer Karte (Datum/Owner/Banner nicht zusätzlich als Pflege-Chip). (Unit-Test der Filterfunktion.)
4. Höchstens zwei eigene Pflege-Chips je Karte (still, Widerspruch); deshalb kein „+n“. (Code: `SHOWN_ELSEWHERE` in `Board.tsx`; Sichtprüfung.)
5. Ticket-Detail zeigt „Was fehlt“ mit Satz + Knopf je Befund; der Knopf springt zum Feld und schreibt nichts. (api-Test: Detail liefert `hygiene`; Sichtprüfung.)
6. Filter „Braucht Pflege“ zeigt die Zusammenfassung nach Art mit Anzahl. (Unit-Test `zusammenfassung`; Sichtprüfung.)
7. „Heute“ zeigt dieselben Klartexte wie das Board (eine Quelle `src/pflege.ts`). (grep: kein zweiter Text.)
8. Glossar „Was heißt …?“ einklappbar an Board-Filter, Detail und Heute.
9. Handy (390 px): kein waagrechtes Rollen auf Board/Detail; Chips umbrechen. (Shots-Skript meldet „nein“.)
10. Zähler unverändert: Filter-Zahl, Bahn-Zahl, Owner-Zahl wie vorher. (bestehende api-Tests grün.)
11. Keine neuen Endpunkte, keine neuen Schreibpfade. (Diff-Prüfung `server/main.ts`.)
12. Alle Tests grün (`werkbank.sh test`-Äquivalent mit eigener Wegwerf-Mongo), Build grün, Shots vorher/nachher desktop + handy.

## Entscheidungen

Entschieden von Knut, 11.10.2026: E1–E4 „passt“ (wie gebaut). Kontext und Optionen im Bericht
(`review-pakete/136-pflege-klartext/bericht.md`).

- **E1** Keine doppelten Chips: der vorhandene Datum-/Owner-Chip spricht Klartext, eigene Pflege-Chips nur für still und Widerspruch. — Entscheidung Knut, 11.10.2026
- **E2** Knöpfe im Ticket-Detail („Was fehlt“), nicht auf der Karte. — Entscheidung Knut, 11.10.2026
- **E3** Kein Snooze („später“) am Board; bleibt auf „Heute“. — Entscheidung Knut, 11.10.2026
- **E4** Kein „+n“ (nach E1 höchstens zwei Pflege-Chips). — Entscheidung Knut, 11.10.2026

## Council (11.10.2026)

Die Teilagenten für die Rollen kamen in diesem Strang ohne Bericht zurück (Übergabe fehlte, Nachfragen gesperrt);
Specialist, UX-Rolle (Skill ux-expert) und Gegenrede liefen deshalb als getrennte Durchgänge in der Hauptsitzung.

**Runde 1 — HOLD.** Bindende Bedingungen:
1. [must-fix] „Datum fehlt“ nur mit Befund `ohne Datum`; Backlog ohne Datum bleibt neutral „ohne Datum“.
2. [must-fix] „Owner fehlt“ nur mit Befund `Sub-task ohne Owner`; sonst bleibt „ohne Owner“.
3. [must-fix] Tage „überfällig“ vom Server, wenn es einen Befund gibt (kein Tag Abweichung zwischen Karte und Heute).
4. [must-fix] Sprungknopf im Detail fällt auf den Abschnitt „Aktionen“ zurück, solange das Feld noch nicht geladen ist.
5. [must-fix] (UX sev 3) „+n“ ist ein Knopf mit mindestens 24 px Höhe und `aria-expanded`. → Beim Bau gegenstandslos: nach der Dedupe gibt es höchstens zwei Pflege-Chips, „+n“ entfällt (siehe S3).
6. [must-fix] (UX sev 3) Auffindbar, wo die Handlung steht: Filterzeile sagt „Karte öffnen: dort steht, was zu tun ist“; „Was fehlt“ steht im Detail ganz oben.
7. [must-fix] (Gegenrede) Zahlen benannt: „n Tickets · m Befunde: …“, damit Filter-Zahl (Tickets) und Zusammenfassung (Befunde) sich nicht widersprechen.
8. [verify] Keine `🧹 n`-Zahl mehr auf Karte, Sub-task-Zeile, Sub-task-Leiste, Bahn und Owner-Auswahl.
9. [verify] Handy 390 px ohne waagrechtes Rollen auf Board und Detail.
10. [escalate → Knut] Abweichungen von Knuts Skizze (E1–E3) nicht still: als Entscheidungen mit Empfehlung im Bericht.
