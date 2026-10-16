---
status: Plan 15./16.10.2026 (Paket 185, Council mit Bedingungen B1–B9); Umsetzung S1, S2, S4, S5, S6 ab 16.10.2026 (Paket 187)
quelle: Bestandsaufnahme Release 16b; Knut 15.10.2026 nachts („Mockups gefallen mir sehr, umsetzen“); D1 von Knut beantwortet (Übersicht ersetzt Heute), D2–D8 als Empfehlung gebaut
---

# Plan: OLAF Workspace entrümpeln — vier Bereiche, eine Startseite, eine Sprache

Bestandsaufnahme: Release 16b (`9097562`), isolierte Testinstanz.

## Problem (aus Knuts Sicht)

Knut will morgens drei Dinge: sehen, was fertig ist, freigeben und entscheiden. Tagsüber startet und steuert er
Unter-Chats und spricht mit dem Hauptchat. Dafür gibt es heute **19 Navigationsziele**: 4 LibreChat-Panels, das
Hauptchat-Symbol, 5 Seiten in der Leiste, 5 weitere unter „Mehr“ und 4 im Kontomenü. Dieselben Dinge stehen an
mehreren Stellen, zum Beispiel:

- Entscheidungen beantworten: 3 Stellen mit 2 verschiedenen Oberflächen
- Bericht lesen: 4 Stellen
- Hauptchat: 3 Stellen
- Unter-Chats: 3 Stellen, dazu die Karten auf Heute
- Dateien: 3 Stellen
- Zielbaum: 2 Stellen
- „Ziel zuordnen“: 5 Stellen

Dieselbe Sache heißt außerdem verschieden. Ein Arbeitsfaden heißt Strang, Unter-Chat, Agent oder Lauf. „Review“ hat 5
Bedeutungen, „Freigabe“ 3. Dazu kommen Technikdetails im Alltag: Env-Namen, SHAs, IDs, Token-Tabellen.

## Lösung (aus Knuts Sicht)

Vier Bereiche in der Leiste, am Handy als Tableiste:

1. **Chats**: der Hauptchat oben, darunter die Unter-Chats nach Thema, dann die eigenen Chats.
2. **Übersicht** ist die Startseite:
   - je Thema Karten mit Ampel, 2–3 Sätzen, Links und einer Zeile „Von dir“;
   - gehandelt wird direkt auf der Karte, Bericht und Freigabe stehen in einer Schublade;
   - darunter „Läuft“ und „Erledigt“.
3. **Planen**: Roadmap · Sprint · Board · Ziele · Mein Tag als Reiter.
4. **Wissen**: Vault · Dateien · Skills als Reiter.

Das **Kontomenü** führt zu Einrichtung, Einstellungen, Archiv und Abmelden. In der Einrichtung stehen Claude, Jira,
Melious mit Verbrauch, Automatik (PR-Ticker) und Technik.

Begriffe stehen fest im Glossar unten.

## Kernabläufe: vorher → nachher (Klicks ab Chat)

| Ablauf | Vorher | Nachher |
|---|---|---|
| Morgens: was ist fertig, freigeben | Heute (1) → Karte lesen → „Push freigeben“ (2) → bestätigen (3); Entscheidungen als Auswahl nur auf der Hauptchat-Seite: Mehr → Hauptchat & Unter-Chats → „Review & Freigabe“ (+3) | Übersicht (1) → „Push freigeben“ auf der Karte (2) → bestätigen (3); Entscheidungen auf derselben Karte |
| Rückfrage eines Unter-Chats beantworten | Heute → „Wartet auf dich“ unten suchen → Auswahl → Antworten | Übersicht → Karte des Unter-Chats → Auswahl → Antworten |
| Unter-Chat steuern | Chatverlauf → Abschnitt → Thema → Chat; Status zusätzlich auf der Hauptchat-Seite | Chats → Thema → Chat (gleich), Status nur dort und in der Übersicht |
| Hauptchat schreiben | Symbol oder Abschnitt oder Chatliste | Chats → Hauptchat (oben angeheftet); auf der Übersicht „Hauptchat öffnen“ |

## Glossar (verbindlich für alle sichtbaren Texte)

| Begriff | Bedeutung | ersetzt |
|---|---|---|
| Hauptchat | der eine führende Chat | Leitstand, Hauptsitzung, Orchestrator |
| Unter-Chat | ein Arbeitsfaden, den der Hauptchat startet | Strang, Agent, Lauf, Orchestrator-Strang (Wortwahl: D3) |
| Ampel | läuft · braucht dich · bereit zum Push · blockiert · erledigt | wartet auf dich, zu prüfen, fertig, gestoppt, hängt |
| Freigeben | nur: Push eines geprüften Stands erlauben | Freigabe einer Sync-Frage („Ja“), GitHub-„Freigeben“ (→ „Approve“) |
| Abhaken | Ergebnis gesehen, nichts mehr zu tun | Passt, Erledigt, als geprüft markieren |
| Nacharbeit | Text zurück an den Unter-Chat | Zurück an den Agenten |
| Review | nur für GitHub-PR-Reviews und den Sprint-Review-Termin | „Wartet auf dein Review“ (→ „braucht dich“), Review-Pakete (→ Ergebnisse) |
| Pflege | nur fehlende Angaben an Tickets | Roadmap-Konsistenz (→ „Prüfen“) |

## Schnitte (je ein PR, in dieser Reihenfolge)

**S1 Begriffe und Texte** (Werkbank-Web und `librechat.yaml`, Aufwand S, Risiko niedrig)
- Glossar in allen sichtbaren Texten umsetzen.
- Begrüßung kürzen, damit sie nicht mehr auf die alte Fußzeile verweist.
- Env-Namen, SHAs, IDs und Token-Messung hinter „Technische Details“ legen.
- DoD:
  - `grep` über `web/src` findet in sichtbaren Strings kein „Strang“, „Leitstand“, „Hauptsitzung“ und kein `WERKBANK_` mehr.
  - Die Begrüßung passt auf 390 px ohne Scrollen.
  - `npm test` und `e2e/smoke.mjs` sind grün.

**S2 LibreChat-Standard ausblenden** (`librechat.yaml`, Patch 20, Aufwand S–M, Risiko mittel)
- Per yaml aus: Prompts, Presets, Temporärer Chat.
- Per Patch ausgeblendet: Lesezeichen (nur die Oberfläche; Lesezeichen-Daten und API bleiben), Projekte, Büroklammer-Panel, „Meine Dateien“.
- Das Anhängen im Chat bleibt.
- DoD:
  - Die Leiste zeigt keine Prompts, Lesezeichen und Dateien mehr.
  - Hauptchat-Gruppen und Orchestrator-Lesezeichen wachsen weiter (Prüfung F10).
  - Anhängen im Chat funktioniert.
  - Smoke-Test grün.

**S3 Übersicht wird Startseite** (nach Merge von Plan 184; Web; Aufwand M–L, Risiko mittel)
- Die Übersicht nimmt den Rest von Heute auf:
  - Board-Agent-Läufe,
  - Rückfragen,
  - Vault-Sync-Fragen,
  - Entwurf „Woran wir arbeiten“,
  - G0-Stopps,
  - hängende Läufe.
- Für Team-Nutzer zeigt sie deren eigene Läufe, Fragen und Pflege.
- `#/` und `#/heute` führen auf die Übersicht.
- Ein Zähler „braucht dich“ ersetzt die bisherigen Zähler.
- Vault-Entscheidungen (316) und die Ticket-Pflege bekommen auf der Startseite nur noch je eine Zeile mit Link nach Planen.
- DoD:
  - Jeder Abschnitt von Heute hat eine benannte neue Stelle (Tabelle „Was weg kann“).
  - Ein Team-Konto ohne Admin sieht seine Läufe und Fragen.
  - Alte Links (`#/heute`, `#/leitstand?review=…`, `?bericht=`, `?auftrag=`) öffnen die passende Karte bzw. Schublade.
  - Bilder bei 1440 und 390, hell und dunkel.

**S4 Seite „Hauptchat & Unter-Chats“ auflösen** (Web; Aufwand M, Risiko mittel)
- Review-, Bericht- und Auftrag-Ansicht werden eine Schublade in der Übersicht. Die Komponenten werden wiederverwendet, nicht kopiert.
- Melious-Kachel und Messung ziehen in Einrichtung › Melious.
- Die PR-Ticker-Schalter ziehen in Einrichtung › Automatik.
- Die Ticker-Meldungen ziehen nach Planen › Roadmap › PRs.
- Auto-Review-Unter-Chats erscheinen als Karten.
- Der Dialog „Hauptchat starten/neu starten“ bleibt als Route und ist über das ⋯-Menü des Hauptchats erreichbar.
- DoD:
  - Keine Funktion der Seite ohne neue Stelle.
  - `#/leitstand` führt auf die Übersicht.
  - Der Neustart mit Übergabe funktioniert.

**S5 Leiste auf vier Bereiche** (Patch 20 + 50, Web-Router; Aufwand M, Risiko mittel)
- Die Leiste hat die Einträge Chats · Übersicht · Planen · Wissen. „Mehr“ und das Hauptchat-Symbol entfallen (D2).
- Planen und Wissen sind Reiter-Hüllen um die bestehenden Seiten:
  - der zuletzt benutzte Reiter wird gemerkt;
  - die alten Routen bleiben als Alias.
- Die Funktionsfreigaben gelten je Reiter. Ein Bereich ohne freigegebenen Reiter ist unsichtbar.
- Unter-Chats sind in der normalen Chatliste standardmäßig ausgeblendet. Ein Schalter blendet sie ein, die Suche findet alle (D5).
- DoD:
  - `smoke.mjs` und `eine-oberflaeche.mjs` sind auf vier Einträge umgestellt und grün.
  - Kein toter Link in den Berichten der letzten 14 Tage (Link-Prüfung über die Review-Pakete).

**S5b Handy-Tableiste** (Patch 20; Aufwand M, Risiko mittel)
- Am Handy eine Tableiste unten mit den vier Bereichen; die Schublade bleibt für die Chatliste.
- Eigener PR nach S5. Knut testet erst auf dem eigenen Telefon.
- DoD:
  - Knöpfe ≥ 44 px, kein waagrechtes Scrollen bei 390 px.
  - Nichts verdeckt das Eingabefeld.

**S6 Planen entrümpeln** (Web; Aufwand S–M, Risiko niedrig, optional)
- Der zweite Zielbaum im Sprint wird ein Link auf Ziele.
- Die Roadmap-Tabelle in Wissen entfällt.
- Der Knopf „PR prüfen (forge) — Kommt bald“ im Board entfällt.
- Das Banner „Bei mir: n offen“ auf vier Seiten entfällt.
- „Ziel zuordnen“ wird eine gemeinsame Komponente.
- DoD: dieselben Funktionen bleiben erreichbar, in einer Liste belegt.

## Ausroll-Reihenfolge

S1 und S2 sind unabhängig voneinander. Danach gilt: Merge von Plan 184 → S3 → S4 → S5 → S5b → S6. Ausgerollt wird
jeweils mit einem Werkbank-Release (`release/werkbank-*`). S2, S5 und S5b brauchen einen neuen LibreChat-Client-Bau
(Patch). Infra: keine neuen Einstellungen. Feature-Schalter bleiben `web/server/features.ts`.

## Messung (Council B7)

Die Ausgangswerte stammen aus `werkbank-web.log` (28.09.–15.10.):

- Rückfragen: 44 gestellt, 3 in der Oberfläche beantwortet.
- Unter-Chats: 101-mal „bereit zum Review“ gemeldet, 7 per Knopf abgehakt.
- PR-Ticker-Einstellungen: 4-mal geändert.

Seitenaufrufe werden nicht geloggt. S3 bekommt deshalb eine Zeile im vorhandenen Log je Aktion auf der Übersicht. Zwei
Wochen nach S5 wird verglichen.

## Bewusst nicht

- Kein neues Datenmodell und keine neuen Schreibwege.
- Keine gemeinsame Suche über Vault und Dateien.
- Kein Ersatz für LibreChat.
- Der iframe bleibt (frühere Entscheidung E1).

## Entscheidungen

| | Frage | Stand |
|---|---|---|
| D1 | Übersicht wird Startseite, Heute geht darin auf | **Knut: ja** (S3 = Plan 184, auf diesem Zweig schon gebaut) |
| D2 | Leiste: vier Bereiche Chats · Übersicht · Planen · Wissen, Reiter merken sich den letzten, alte Adressen als Alias | gebaut als Empfehlung, Knut kann ändern |
| D3 | Sichtbar „Unter-Chat“, „Strang“ nur intern | gebaut als Empfehlung |
| D4 | Seite „Hauptchat & Unter-Chats“ auflösen (Melious + Automatik → Einrichtung, Listen → Übersicht/Chats, Neustart → ⋯-Menü) | gebaut als Empfehlung |
| D5 | Unter-Chats aus der normalen Chatliste ausblenden, Schalter blendet ein, Suche findet alle | gebaut als Empfehlung |
| D6 | LibreChat-Standard ausblenden (yaml: Prompts, Presets, Temporärer Chat; Patch: Lesezeichen-Oberfläche, Projekte, Büroklammer-Panel, „Meine Dateien“) | gebaut als Empfehlung |
| D7 | „Mein Tag“ bleibt als Reiter unter Planen, auf der Startseite eine Zeile | gebaut als Empfehlung |
| D8 | Vault-Entscheidungen und Ticket-Pflege auf der Startseite nur je eine Zeile | gebaut als Empfehlung (Plan 184 hat das schon so) |

## Council-Bedingungen (bindend)

- **B1** Nie zwei Startseiten länger als ein Release.
- **B2** Team-Nutzer verlieren nichts: eigene Board-Läufe, Fragen, Pflege auf der Übersicht; Funktionsfreigaben je Reiter;
  Prüfung mit einem Team-Konto vor S5.
- **B3** Alte Adressen bleiben gültig (`#/heute`, `#/leitstand?review=|bericht=|auftrag=|start=1`, `#/board`, `/wb/<seite>`);
  Link-Prüfung über die Berichte der letzten 14 Tage vor S5.
- **B4** yaml vor Patch. Lesezeichen und Projekte nur in der Oberfläche ausgeblendet; Daten und API bleiben, die
  Orchestrator-/Hauptchat-Lesezeichen wachsen weiter.
- **B5** Unter-Chats verschwinden aus der Chatliste nur mit Schalter; die Suche findet alle.
- **B6** Handy-Tableiste (S5b) ist ein eigener PR nach S5; erst Test auf Knuts Telefon. **Nicht Teil dieser Umsetzung.**
- **B7** Messung: Ausgangswerte aus dem Log, eine Log-Zeile je Aktion auf der Übersicht, Vergleich zwei Wochen nach S5.
- **B8** Jede Zeile „weg/verschieben“ hat eine benannte neue Stelle (Tabelle unten) oder ist von Knut als „entfällt“ entschieden.
- **B9** „Hauptchat neu starten mit Übergabe“ bleibt in höchstens zwei Klicks erreichbar (⋯-Menü).

## Umsetzung (Paket 187)

Grundsatz: Komponenten bleiben, sie ziehen nur um. Keine neuen Routen auf dem Server, kein neues Datenmodell, keine neuen
Einstellungen. Jeder Schnitt ist ein Commit und lässt sich einzeln zurücknehmen.

**S1 Begriffe und Texte**
- Sichtbare Texte in `web/src` und `librechat/overlay` nach dem Glossar. Statuswörter der Unter-Chats einheitlich
  (`läuft · braucht dich · bereit · blockiert · erledigt`), nur in der Anzeige — die Server-Werte (`wartet`, `fertig`,
  `gestoppt`, `wartet auf dich`) bleiben, weil Tests, Brücke und Hauptchat sie lesen.
- Begrüßung (`interface.customWelcome`) auf zwei kurze Sätze: was der Workspace ist, wo die Einrichtung steht.
- Env-Namen, SHAs, mergeBase, patchId, Konversations-IDs und Token-Tabellen hinter „Technische Details“ (`<details>`).
- Prüfung: `web/test/glossar.test.ts` sucht in sichtbaren Strings (ohne Kommentare) nach „Strang“, „Leitstand“,
  „Hauptsitzung“, „Orchestrator“ und `WERKBANK_` — bleibt als Wächter.

**S2 LibreChat-Standard ausblenden**
- yaml: `prompts: false`, `presets: false`, `temporaryChat: false`. `bookmarks` bleibt `true` — sonst sperrt LibreChat die
  Tags-API, über die der Hauptchat seine Lesezeichen setzt (B4).
- Neuer Patch `70-client-entruempeln.patch`: Lesezeichen- und Dateien-Panel aus der Leiste (`useSideNavLinks.ts`),
  Lesezeichen-Knopf im Chat-Kopf (`Header.tsx`), Projekte-Abschnitt (`ConversationsSection.tsx`), „Meine Dateien“ im
  Kontomenü (`AccountSettings.tsx`). Anhängen im Eingabefeld bleibt unberührt.

**S4 Seite „Hauptchat & Unter-Chats“ auflösen**
- `#/leitstand` (mit und ohne Parameter) zeigt die Übersicht. `?review=`, `?bericht=`, `?auftrag=` öffnen die Schublade
  mit den bisherigen Komponenten (`Review`, `Bericht` aus `Leitstand.tsx`, exportiert statt kopiert); `?start=1` öffnet
  dort den Dialog „Hauptchat (neu) starten“. Dasselbe gilt für `#/?…` und `#/heute?…`.
- Melious-Verbrauch (Kachel und Messung) → Einrichtung › Melious; PR-Ticker-Schalter → Einrichtung › Automatik
  (nur Admins, wie bisher); Ticker-Meldungen und Auto-Reviews → Planen › Roadmap › PRs.
- Die Unter-Chat-Liste je Lauf entfällt als Seite: offene stehen als Karten bzw. unter „Läuft“ auf der Übersicht und
  im Chat-Abschnitt, erledigte unter „Erledigt“. Modell und Gegenprüfung stehen auf der Karte unter „Technische Details“.
- ⋯-Menü des Hauptchats: „Hauptchat neu starten …“ (B9, zwei Klicks); der Eintrag „Alle Unter-Chats“ führt auf die Übersicht.

**S5 Leiste auf vier Bereiche**
- LibreChat-Leiste: LibreChats Chatverlauf (= Chats) · Übersicht · Planen · Wissen. Das 🛰️-Symbol und „Mehr“ entfallen;
  die Einrichtung steht weiter im Kontomenü.
- Planen = Reiter Roadmap · Sprint · Board · Ziele · Mein Tag, Wissen = Reiter Vault · Dateien · Skills. Die Reiter sind
  die bisherigen Seiten unter ihren bisherigen Adressen; der Bereich merkt sich den zuletzt benutzten Reiter
  (`localStorage`, gleicher Ursprung für Leiste und Seite). Ein Reiter erscheint nur mit Funktionsfreigabe, ein Bereich
  ohne freigegebenen Reiter gar nicht.
- Unter-Chats (Titel „Orchestrator · …“) fehlen in der normalen Chatliste; ein Schalter im Hauptchat-Abschnitt
  („auch in der Liste zeigen“) blendet sie ein, bei einer Suche erscheinen immer alle (B5). Patch in
  `ConversationsSection.tsx`.

**S6 Planen entrümpeln**
- Zielbaum im Sprint → Link auf Planen › Ziele; Roadmap-Tabelle in Wissen entfällt (`#/wissen/~roadmap` → Roadmap);
  „PR prüfen (forge) — Kommt bald“ im Board entfällt; Hinweis „Bei mir: n offen“ auf Roadmap, Board, Sprint, Mein Tag
  entfällt (der Zähler steht an der Übersicht); „Ziel zuordnen“ nutzt eine gemeinsame Auswahl-Komponente.

### Was wohin kommt (B8)

| Bisher | Neue Stelle |
|---|---|
| Heute (Seite) | Übersicht (Plan 184) |
| Hauptchat & Unter-Chats: Start/Neustart mit Übergabe | ⋯-Menü des Hauptchats → Übersicht mit Dialog (`#/leitstand?start=1`); Übersicht-Kopfzeile „Neu starten …“ |
| Hauptchat & Unter-Chats: Liste je Lauf | Übersicht (Karten, Läuft, Erledigt) und Chat-Abschnitt |
| Review & Freigabe, Bericht-, Auftrag-Ansicht | Schublade auf der Übersicht (alte Links öffnen sie) |
| Melious-Kachel, Messung | Einrichtung › Melious |
| PR-Ticker-Schalter, Deckel | Einrichtung › Automatik |
| PR-Ticker-Meldungen, Auto-Reviews | Planen › Roadmap › PRs |
| Hauptchat-Symbol in der Leiste | Hauptchat-Abschnitt oben in Chats |
| „Mehr“ | Reiter in Planen und Wissen |
| Prompts, Presets, Temporärer Chat | entfällt (D6); Vorlagen im Modell-Menü |
| Lesezeichen (Oberfläche), Projekte | entfällt in der Oberfläche (D6); Daten und API bleiben |
| Büroklammer-Panel, „Meine Dateien“ | Wissen › Dateien; Anhängen im Chat bleibt |
| Unter-Chats in der Chatliste | Hauptchat-Abschnitt; Schalter und Suche |
| Zweiter Zielbaum im Sprint | Planen › Ziele |
| Roadmap-Tabelle in Wissen | Planen › Roadmap |
| „PR prüfen (forge) — Kommt bald“ | entfällt (toter Knopf) |
| „Bei mir: n offen“ | Zähler an der Übersicht |
