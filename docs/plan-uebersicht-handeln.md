---
status: Plan 15.10.2026 (Paket 184) — Council siehe unten
quelle: Knut 15.10.2026 abends („Übersichtsseite richtig gut — nur Bearbeitung fehlt noch, um direkt agieren zu können“); Heute-Frage q-45fe10 („nach Themen organisiert wie die Chats; direkt entscheiden und antworten; mit Dropdowns“); Vorbild-Seite „Morgen 16.10.“ des Orchestrators
---

# Übersicht „Was fertig ist“ mit direktem Handeln

## Ziel

Eine Seite **Übersicht** im Workspace, die so aussieht wie die Morgen-Seite des Orchestrators (eine Karte je Sache, Ampel,
2–3 Sätze, Links, „Von dir“-Zeile) — aber mit Knöpfen: Push freigeben, Entscheidungen per Auswahl beantworten,
Rückfragen beantworten, Vorschau/Folien/Bericht öffnen. Gruppiert nach Thema wie die Chat-Seitenleiste.

## Stand heute (Code, Zweig auf Release 16b)

Alles Handeln gibt es schon — verstreut:

| Was | Wo heute | Route |
|---|---|---|
| Push freigeben (genau der gesehene Stand) | Heute → Karte → „Push freigeben“ | `POST /api/review/:id/freigabe` (nach `GET /api/review/:id`) |
| Entscheidungen übernehmen / eigene / nachprüfen | Leitstand-Review-Ansicht (`entscheidungen.tsx`); Heute nur als Freitext | `POST /api/review/:id/entscheidungen` (Release 15b) |
| Rückfragen des Orchestrators (q-…) | Heute → „Wartet auf dich“, Radio + Text | `POST /api/orchestrator/questions/:id/answer` |
| Nacharbeit an einen Strang / geprüft | Heute → Karte | `POST /api/leitstand/strands/:id/(reply|passt)` |
| Themen der Stränge | Chat-Seitenleiste | `themen.ts` (`groupThemen`, `themaOf`) |
| Kurzfassung, Fragen, Links, GitHub-Zeilen | Bericht-Kopf, vom Status-Takt in Mongo festgeschrieben | `berichtkopf.ts`, `berichtstand.ts`, `kopfFelder` |

Es fehlt: die Gruppierung nach Thema, die dichte Karte, eine Ampel über alle offenen Stränge (auch „läuft“/„blockiert“),
Entscheidungen als Auswahl auf der Karte, Rückfragen am Strang statt in einer Sammelliste, Folien-/Bilder-Links,
und dass halbe Eingaben ein Neuladen überleben.

## Schnitte (je ein Commit)

**S1 Daten (Server, rein + Route).** Neues Modul `web/server/uebersicht.ts`:
- `ampel(d, felder)` → `push` (Kopf `bereit_fuer_github`, keine offene Frage, noch nicht gepusht) · `review` · `laeuft` · `blockiert`
  (Kopf `blockiert` oder Strang gestoppt). Freigabe/gepusht steht als Zusatz („freigegeben · wartet auf Push“, „gepusht · PR #n“).
- `vonDir(karte)` → eine Zeile „Von dir: Push-Go und D1–D3“ / „Review“ / „Antwort auf die Rückfrage“ / „nichts — läuft“.
- `paketLinks(paket, dateien, basis)` → Bericht, Folien (`*.html` im Paket, ohne `index.html`), Bilder (Ordner `screenshots/`
  oder erstes Bild) — Folien und Bilder über den vorhandenen Review-Pakete-Dienst (`WERKBANK_PAKETE_URL`, sonst der Eintrag
  „Review-Pakete“ im Dienste-Register); ohne Basis nur der Bericht.
- `uebersicht(strands, …)` → Themen (Reihenfolge wie `groupThemen`) mit Zählern je Ampel; Rückfragen ohne Strang als eigene
  Gruppe „Hauptchat“.
- `GET /api/uebersicht` (nur Admin): offene Stränge (nicht von Knut geprüft, 30 Tage), je Strang `kopfFelder`, offene
  Entscheidungen aus dem Bericht (Textblöcke **D1 — …** und Kopf-`fragen`, nur unbeantwortete, `berichtHash` des gelesenen
  Texts), offene q-Rückfragen mit `strand.id`, `seen`, Links. Nur lesen.

**S2 Antwort an einen Strang (kleine Erweiterung einer vorhandenen Route).** `POST /api/leitstand/strands/:id/reply` nimmt
zusätzlich `kind: 'antwort'` und schickt „Antwort von Knut auf deine Rückfrage: …“ in denselben Strang (gleiche Prüfungen:
`seen`, läuft nicht, kein Trockenlauf). Kein neuer Schreibweg.

**S3 Seite (Web).** `#/uebersicht`, Navigationseintrag „Übersicht“ (nur Admin, mit Zahl „Von dir“):
- Kopf: Titel, Datum, ein Satz „So bringst du es auf GitHub“ (Freigabe hier, Push macht der Hauptchat, nie mergen).
- Je Thema ein `<details>` mit Zählern (z. B. „Flex · 2 bereit · 1 Review“); auf/zu bleibt nach Neuladen (localStorage).
- Karte: Titel + Ampel, 2–3 Sätze (`worum` aus dem Kopf, sonst Plan/Bericht-Satz), GitHub-Zeile, Link-Chips
  (Bericht · Folien · Bilder · Vorschau/Bot aus `review:` des Kopfs · Chat), „Von dir“-Zeile.
- Handeln (aufklappbar unter der Karte):
  - **Push freigeben** — derselbe Ablauf wie auf Heute (Stand holen, zeigen, bestätigen). Gemeinsame Funktion statt Kopie.
  - **Entscheidungen** — je Frage eine Auswahl „Empfehlung übernehmen · Eigene Antwort · Nachprüfen“ + Textfeld; „Alle
    Empfehlungen“; senden über die vorhandene Route.
  - **Rückfragen (q-…)** am Strang — Auswahl der Optionen + Text; vorhandene Antwort-Route.
  - **Antworten / Nacharbeit / Passt** an den Strang — S2 bzw. vorhandene Routen.
- Entwürfe (Auswahl + Text) liegen in localStorage je Strang+Kennung und verschwinden erst nach erfolgreichem Senden.
- 390 px: Karten einspaltig, Knöpfe ≥ 44 px, keine waagrechte Rollleiste. Dark/Light über die vorhandenen Variablen.

## Nicht in diesem Schnitt

Heute bleibt, wie sie ist (D1). Kein Push, kein Merge, keine neue GitHub-Schreibroute, keine Änderung an der
Dateiauslieferung (Folien laufen über den vorhandenen Paket-Dienst), LibreChat-Leiste unverändert (D2).

## Entscheidungen für Knut

- **D1 — Heute ersetzen oder ergänzen?** Optionen: (a) Übersicht als eigene Seite, Heute bleibt; (b) Übersicht ersetzt
  den Abschnitt „Wartet auf dein Review“ auf Heute; (c) Übersicht wird die Startseite. **Empfehlung (a)**, gebaut: ohne
  Risiko für Heute (Tag, Tickets, Board-Läufe); nach ein paar Tagen Nutzung entscheiden, ob (b).
- **D2 — Eintrag in der LibreChat-Leiste?** Empfehlung: erst nach D1 — die Leiste ist ein Patch am LibreChat-Bau.

## Definition of Done

1. `GET /api/uebersicht` liefert nur für Admins Themen-Gruppen mit Karten (Ampel, Kurzfassung, Links, Von-dir, offene
   Entscheidungen, Rückfragen), Nicht-Admin 403 (Test).
2. Ampel: `bereit_fuer_github` ohne offene Frage → push; mit offener Frage → review; laufend → läuft; blockiert/gestoppt → blockiert (Test).
3. Push freigeben, Entscheidungen, q-Antworten, Antwort/Nacharbeit/Passt gehen über die vorhandenen Routen; `reply` mit
   `kind: 'antwort'` (Test über die reine Textfunktion).
4. Entwürfe und auf/zu überleben Neuladen (e2e).
5. 1440 und 390 px, hell und dunkel: Screenshots vom echten Build auf einer isolierten Instanz; keine waagrechte Rollleiste bei 390.
6. `npm test` und `vite build` grün; Pass A/B/C mit Gegenprüfung; Bericht, Folien, Release-Skript-Entwurf im Paket 184.

## Council (15.10.2026)

Befürworter, Spezialist und UX in der Hauptsitzung, Advocatus Diaboli zusätzlich über das zweite Modell
(`challenge`, glm-5.3-flash; der erste Lauf mit glm-5.3 kam ohne Antwort zurück). Übernommen, nachdem im Code geprüft:

1. **Links aus dem Kopf sind Selbstauskunft** — `href` nur für `http(s)://`, sonst Text; Linktext wird von React escaped,
   kein `dangerouslySetInnerHTML` auf der Seite.
2. **Zwei Quellen für Entscheidungen** (Textblöcke `**D1 — …**` und Kopf-`fragen`) — nach Kennung zusammenführen (eine
   Zeile je Kennung), beantwortet gilt aus beiden Quellen (`- Knut:` im Text, `antwort:` im Kopf, `entscheidungenAntwort`).
   So auch die Route heute.
3. **Eingaben nicht verlieren** — Entwürfe bleiben bei jedem Fehler (auch 409 „Bericht geändert“) stehen; nach 409 lädt die
   Seite neu und der Entwurf hängt wieder an derselben Kennung.
4. **Ampel mit fester Reihenfolge**: läuft > blockiert > bereit zum Push > dein Review. „Freigegeben“/„gepusht“ nur aus der
   Freigabe der Werkbank (`freigaben`), nie aus dem Kopf. Eine Freigabe für einen älteren Stand zeigt „Freigabe veraltet“.
5. **Push freigeben** bleibt der Ablauf von Heute (Stand live holen, im Dialog zeigen, genau den bestätigen) — eine
   gemeinsame Funktion; nie mit anderen Aktionen verkettet.
6. **Ohne Paketdienst** (keine Basis-URL) keine Folien-/Bilder-Chips statt toter Links.
7. **Sichtbarer Stand** („Stand 14:32“) und Nachladen alle 60 s sowie beim Zurückkehren in den Tab; Entwürfe überleben das.

Nicht übernommen: serverseitige Sperren je Strang (die vorhandenen Routen prüfen `seen`/`berichtHash` und „läuft“; neue
Sperren wären eine Änderung an Release-15b-Routen, nicht Teil dieses Auftrags) und Einschränkungen am Paketdienst (der
läuft schon, nur hinter der Coder-Anmeldung, und wird hier nicht verändert) — beides als Risiko im Bericht.

## Teil B — Übersicht wird Startseite in der Bildsprache von Paket 185 (Knut, 15.10. abends)

Vorgaben: (1) Jede Entscheidung auf der Übersicht ist mit **Ja / Nein / Anders …** beantwortbar. „Ja“ übernimmt die
Empfehlung, „Nein“ lehnt sie ab, „Anders“ öffnet ein Textfeld. Die Antwort landet dort, wo die Frage herkommt
(Bericht-Kopf `antwort:` bzw. Textblock `- Knut:` bzw. orch-ask), und der Unter-Chat wird damit fortgesetzt. (2) Die Übersicht
in Struktur und Bildsprache der Mockups aus Paket 185 (Abschnitt 7, D1 b) als Startseite, die Heute ersetzt — keine siebte
Seite, alte Adressen bleiben gültig (185-Council B1, B3). Damit ist D1 dieses Plans überholt.

**B-S1 Startseite.** `#/` zeigt die Übersicht; `#/heute` und `#/uebersicht` sind Aliasse. Der Navigationseintrag „Heute“ heißt
„Übersicht“ (Feature-Freigabe `heute` gilt weiter, auch in der LibreChat-Leiste: nur der Text ändert sich). Aufbau wie das
Mockup: Kopf mit Datum und Zähler-Pillen (brauchen dich · bereit zum Push · laufen · blockiert) → Hauptchat-Zeile → Rückfragen
ohne Unter-Chat → Themen mit Karten (laufende Unter-Chats nicht als Karte) → Agentenläufe am Board und „Wartet auf dich“ aus
Heute (Team-Nutzer verlieren nichts, B2) → „Läuft“ als Liste → „Erledigt diese Woche“ (eingeklappt) → Zeile „Außerdem in
Planen“ (offene Vault-Entscheidungen, Tickets mit Pflegebedarf, Mein Tag — je Zahl und Link; die Listen selbst stehen auf
ihren Seiten, wie 185-D8 empfiehlt). Bericht, Auftrag und Änderungen öffnen in einer **Schublade** statt einer Unterseite.

**B-S2 Ja / Nein / Anders.** Entscheidungen (D-/E-Kennungen) und Rückfragen (q-…, „Braucht Knut“) einheitlich. Eine einzelne
Frage geht mit einem Klick ab; bei mehreren Entscheidungen einer Karte wird gewählt und gesammelt gesendet, dazu „Alle
Empfehlungen übernehmen“. Server: `POST /api/review/:id/entscheidungen` nimmt `art: 'abgelehnt'` und `weiter: true`; Antworten auf
Kopf-Fragen trägt der Server jetzt selbst als `antwort:` in den Kopf ein (nur wenn der Unter-Chat nicht läuft; sonst wie bisher
nur an den Unter-Chat), geprüft durch erneutes Lesen des Kopfs. Mit `weiter: true` bekommt der Unter-Chat die Antworten
immer als Nachricht und arbeitet weiter.

**DoD Teil B:** `#/`, `#/heute`, `#/uebersicht` zeigen die Übersicht; keine weitere Seite in der Navigation; Ja/Nein/Anders schreibt
an die Quelle (Test für `antwort:` im Kopf, Textblock, orch-ask) und setzt den Unter-Chat fort (Ablauf-Test); Board-Läufe und
„Wartet auf dich“ stehen weiter auf der Startseite; 1440/390, hell/dunkel ohne waagrechtes Rollen.
