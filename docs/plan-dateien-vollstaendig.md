---
titel: Werkbank — Dateien vollständig (Ablage, Ordnerbaum, Agenten-Ergebnisse)
stand: 11.10.2026
owner: Knut
zweig: feat/dateien-vollstaendig (Basis 258cdec = Live release/werkbank-2026-10-11b; nur lokal)
quelle: Auftrag Knut 11.10.2026 über Orchestrator-Strang
bericht: ~/work/knut/review-pakete/134-dateien-vollstaendig/bericht.md
---

# Dateien vollständig

## Auftrag (wörtlich)

> warum sind da nicht alle Dateien, die wir schon haben … ist da auch eine gute File-Structure drin — da sollten auch
> alle Files von Agents sein

## Stand vor dem Bau (Code 258cdec = Live)

- Tab „Dateien & Teilen“ (`web/src/pages/Dateien.tsx`) zeigt nur Mongo `werkbank.files` (`GET /api/files`,
  `server/main.ts`). Darin stehen Uploads (`saveUpload`, landen in `<docsDir>/_eingang/`) und von Agenten übernommene
  Dateien (`server/agentfiles.ts`, Kopie in die Ablage) bzw. Vault-Notizen (Link).
- Die Ablage selbst (`cfg.docsDir` = `~/work/dokumente`, Plan 81, `server/ablage.ts`) enthält heute **228 Dateien**
  (275 MB): `_eingang` 5, `intern/*` 11, `konekto/_allgemein` 0, `olaf/*` 212 — davon in Unterordnern unterhalb des
  Vorgangs 86 (`olaf/flexibilitaeten/pilot-seite/shots/…`, `olaf/rogue/web/…`). Die Werkbank kennt nur die Handvoll,
  die über sie hereinkam.
- Review-Pakete (`~/work/knut/review-pakete/NNN-slug/`, 135 Ordner) erscheinen nirgends. Typisch: `bericht.md`,
  `plan.md`/`spec.md`/`council.md`, `screens/*.png`; einzelne Pakete enthalten ganze Repos/`node_modules`
  (61-bot-coolify: 6541 Dateien ohne node_modules).
- Orchestrator-Stränge stehen in Mongo `orchestrator_runs` (Titel, Chat-URL, `prompt` auf 500 Zeichen gekürzt,
  `review.artefakte` aus review_ready).
- Liste ist flach (Tabelle mit 7 Spalten), auf dem Handy kaum brauchbar.

## Schnitt (ponytail)

### S1 Ablage-Abgleich (`server/ablagesync.ts`, neu)

Eine Funktion `syncAblage(owner)`:

1. Läuft die Ablage ab (beliebige Tiefe bis 8, ohne versteckte Einträge, `node_modules`, `.git`, `__pycache__`,
   Teildateien `.upload-*`; Deckel 5000 Dateien — darüber Abbruch ohne Änderung + Log). Fehlt der Ordner oder ist er
   nicht lesbar: nichts ändern.
2. Lädt alle Register-Einträge mit `path` (alle Besitzer, alle Herkünfte).
3. **Neu**: Datei ohne Eintrag und älter als 2 min (Upload/Agent-Ingest legen erst die Datei, dann den Eintrag an) →
   zuerst Umzug prüfen (s. 4), sonst neuer Eintrag `kind: 'ablage'`, Besitzer = Ablage-Besitzer, `path`, `name`,
   `size`, `mtimeMs`, `sha256`, `sharedWith: []`, `personal: false`, `createdAt` = mtime.
4. **Verschoben/umbenannt**: ein Eintrag (jede Herkunft außer Vault), dessen Datei fehlt, und eine neue Datei mit
   gleicher Größe und gleichem `sha256` — genau ein Paar → `path`/`name` des Eintrags folgen (Freigaben, Tickets
   bleiben). Mehrdeutig → behandeln wie „neu“ + „gelöscht“.
5. **Geändert**: Größe oder mtime anders → `size`, `mtimeMs`, `sha256` nachziehen.
6. **Gelöscht**: nur `kind: 'ablage'` — Datei fehlt und kein Umzug → Eintrag weg. Uploads/Agenten-Dateien behalten
   ihr bisheriges Verhalten („nicht mehr am Ablageort“). Schutz: fehlen in einem Lauf mehr als die Hälfte der
   Ablage-Einträge (und mehr als 20), werden keine gelöscht (Log „Ablage teilweise nicht lesbar?“).
7. **Doppelt**: ein Pfad mit Ablage-Eintrag und einem Eintrag anderer Herkunft → der Ablage-Eintrag geht (Upload/Agent
   gewinnt, Freigaben des Ablage-Eintrags werden übernommen).
8. Nie wird eine Datei geschrieben, verschoben oder gelöscht — nur Mongo.

Ablage-Besitzer: `WERKBANK_DOCS_OWNER` (E-Mail) → dieses LibreChat-Konto; sonst das einzige Konto mit Rolle `ADMIN`.
Unklar (keins/mehrere) → kein Abgleich, Hinweis für Admins im Tab.

Auslöser: alle 5 min im Hintergrund (Jobs) und beim Laden von `GET /api/files` durch den Besitzer (höchstens alle
30 s). Ein Lauf zur Zeit (Sperre im Prozess).

`_eingang/` braucht nichts Neues: ein Eintrag mit Pfad in `_eingang/` steht schon heute in „Noch einzusortieren“.

### S2 Ordneransicht (Dateien.tsx)

- Abschnitt „Ablage“ ersetzt die Tabelle „Meine Dateien“: Baum **Team → Vorgang → (Unterordner) → Dateien**, mit
  `<details>` einklappbar (Teams offen, Vorgänge zu), Zähler je Ordner, Ordner alphabetisch (`_allgemein` zuerst),
  Dateien neueste (Dokumentdatum, sonst mtime) zuerst.
- Datei-Zeile (flex, bricht auf dem Handy um): Kurztitel aus dem Schema (Slug mit Leerzeichen), Dokumentdatum, Art als
  Chip, Version, Herkunft-Chip (Ablage / hochgeladen / vom Agenten), Personendaten-/Geteilt-Chips; Name als Download.
  Aktionen hinter „⋯“ (aufklappbar): Teilen, Freigaben, Im Chat, an Ticket, Verschieben, Löschen (nur Upload/Agent).
- Oben: Suchfeld (Name, Vorgang, Ticket) und Filter Art (`ARTEN` + „ohne Art“). Mit Suche/Filter sind alle Treffer
  aufgeklappt; Ordner ohne Treffer verschwinden.
- Schema-Zerlegung serverseitig (`parseSchemaName` in `ablage.ts`): `JJJJ-MM-TT|undatiert _ art _ rest [_vN] .ext`.
  Passt der Name nicht, bleibt Datum/Art leer. Für abgelegte Dateien ohne `ablage`-Angaben kommt der Vorschlag fürs
  „Verschieben“ aus dieser Zerlegung, nicht mehr aus `suggestFor` je Datei (spart je Datei eine Mongo-Abfrage).

### S3 Agenten-Ergebnisse (neuer Reiter „Von Agenten“)

- `server/reviewpakete.ts` (neu): liest `WERKBANK_REVIEW_DIR` (Vorgabe `~/work/knut/review-pakete`) — nur Ordner
  `^\d{1,4}-[a-z0-9-]+$`. Je Paket: Titel = erste `# `-Überschrift aus `bericht.md`, sonst aus der ersten `.md`, sonst
  Slug; Datum = jüngste mtime der gelisteten Dateien; Dateien bis Tiefe 3, nur `.md .txt .pdf .png .jpg .jpeg .gif
  .webp .csv .json .html .patch .diff`, ohne versteckte/`node_modules`/`.git`, höchstens 60 je Paket (+ „N weitere“),
  höchstens 3000 besuchte Einträge je Paket. Ergebnis 60 s im Speicher.
- Strang-Link: `orchestrator_runs` des Admins, deren `title`, `prompt` oder `review.artefakte`/`review.gemacht` den
  Paketnamen (`134-dateien-vollstaendig`) oder „Paket 134“ enthalten → Titel + Chat-URL (neuester Treffer).
- API (nur Admin, Feature `dateien`): `GET /api/files/agenten` (Pakete + eingesammelte Chat-Dateien),
  `GET /api/files/agenten/<paket>/<rel>` (Download; `?inline=1` nur für png/jpg/gif/webp mit passendem Typ,
  `nosniff`, CSP sandbox), `GET /api/files/agenten/<paket>/<rel>?vorschau=1` für `.md`/`.txt` → `{ html }`
  (markdown-it, `html: false`, Vorgabe aus `vault.ts`). Pfad strikt im Paketordner (realpath, keine Symlinks hinaus).
- Oberfläche: Liste der Pakete, neueste zuerst, je Paket einklappbar (Titel, Nummer, Datum, Strang-Link, Dateien mit
  „Vorschau“ für Markdown/Bilder in einem Overlay, sonst Download). Suche über Titel/Slug. Darunter „Aus Chats“: die
  schon eingesammelten Agenten-Dateien/Vault-Notizen (`kind: agent|vault`) als Liste mit Chat-Herkunft.
- Nur lesen: nichts verschieben, nichts ins Register.

### S4 Teilen

Übernommene Dateien sind normale Register-Einträge des Besitzers → Teilen, Freigabe zurücknehmen, Download für
Geteilte, „Im Chat“, „an Ticket“ laufen über die bestehenden Wege. `path`/`ablage`/`source` gehen wie bisher nicht an
Geteilte. Löschen für `kind: 'ablage'` gesperrt (403 + kein Knopf), siehe E2.

### S5 Sichtbarkeit

Ablage-Einträge gehören dem Ablage-Besitzer, Review-Pakete nur für Admins. `WERKBANK_TEAM_FEATURES` unverändert.

## Nicht im Schnitt

- Kein Dateisystem-Watcher (Takt + beim Laden reicht).
- Review-Pakete nicht teilbar, nicht im Register (eigener Bereich, nur lesen).
- Keine Umbenennung/Neuordnung der echten Ablage; keine Personendaten-Erkennung für übernommene Dateien.
- Backup: übernommene Ablage-Dateien bleiben draußen (E1).

## Entscheidungen

- **E1 Backup** — Kontext: das Nachtbackup nimmt heute jede Datei aus `files` (außer Vault). Mit dem Abgleich kämen
  275 MB Ablage dazu (inkl. zips/Fonts). Optionen: (a) `kind: 'ablage'` ausnehmen — Umfang wie heute; (b) mitnehmen.
  Empfehlung (a); umgesetzt mit (a), per `orch ask` an Knut.
- **E2 Löschen** — Kontext: Löschen in der Werkbank löscht die echte Datei. Optionen: (a) für Ablage-Dateien kein
  Löschen in der Werkbank; (b) wie Uploads. Empfehlung (a) (Auftrag: „nie Dateien löschen“).
- **E3 Besitzer** — technisch, kein Ask: `WERKBANK_DOCS_OWNER` oder einziger Admin.

## DoD (Prüfsätze)

1. Liegt eine Datei in der Fixture-Ablage, steht sie nach einem Abgleich im Register des Besitzers mit Herkunft
   „Ablage“, und `GET /api/files` liefert sie mit Team, Vorgang, Datum und Art aus dem Schema.
2. Wird die Datei in der Ablage verschoben/umbenannt, zeigt das Register nach dem nächsten Abgleich den neuen Pfad
   unter derselben ID mit erhaltenen Freigaben; wird sie gelöscht, verschwindet der Eintrag.
3. Der Abgleich verändert keine einzige Datei der Ablage (Prüfsumme des Fixture-Baums vorher = nachher).
4. Eine Datei in `_eingang/` steht nach dem Abgleich in „Noch einzusortieren“.
5. Uploads und Agenten-Dateien bekommen keinen zweiten Eintrag (auch nicht im 2-min-Fenster, auch nicht nach
   „Ablegen“).
6. Fehlt die Ablage oder fehlt mehr als die Hälfte (> 20), löscht der Abgleich keinen Eintrag.
7. Eine Nicht-Besitzerin sieht Ablage-Dateien nicht; nach Teilen kann sie die Datei herunterladen und sieht keinen
   Ablagepfad; Löschen einer Ablage-Datei liefert 403.
8. Der Tab zeigt den Baum Team → Vorgang → Dateien, einklappbar, mit Suche und Art-Filter; auf 390 px Breite ohne
   waagrechtes Scrollen bedienbar (Screenshot).
9. Ein Admin sieht unter „Von Agenten“ die Review-Pakete der Fixture mit Titel aus `bericht.md`, Datum, Dateien und —
   wo ein Strang den Paketnamen nennt — Strang-Link; Markdown öffnet als Vorschau, Bilder inline.
10. Nicht-Admins bekommen auf `/api/files/agenten*` 403; `../`, absolute Pfade und Symlinks aus dem Paket heraus
    liefern 400/404.
11. `node_modules`/`.git`/versteckte Dateien erscheinen weder im Register noch in den Paketen.
12. `scripts/werkbank.sh test` grün, `vite build` grün.

## Testplan

- `test/ablagesync.test.ts` (Testmongo, Fixture-Ordner im tmp): neu, verschoben, umbenannt, geändert, gelöscht,
  2-min-Fenster, Doppelt, Schutz bei fehlender Ablage, Prüfsumme des Baums unverändert.
- `test/reviewpakete.test.ts`: Titel, Dateifilter, Deckel, Pfadprüfung, Strang-Zuordnung.
- `test/api.test.ts`: Ende-zu-Ende über die API (Abgleich, Teilen, 403 Löschen, Agenten-Endpunkte, Nicht-Admin).
- Screenshots (Playwright, Desktop + 390 px) gegen eine Kopie der **Liste** der echten Ordnerstruktur: Dateinamen aus
  `~/work/dokumente` und `~/work/knut/review-pakete` nur gelesen, als leere/kleine Platzhalterdateien in einen tmp-Ordner
  nachgebaut (echte Inhalte werden nicht kopiert).

## Council

Hinweis: Die Rollen als Teilagenten (zwei Anläufe, sechs Agenten) lieferten in diesem Orchestrator-Strang keinen Bericht
zurück (fehlende Übergabe; Nachfragen per SendMessage sind im Strang gesperrt). Der Council lief deshalb in der
Haupt-Sitzung des Strangs, Rollen nacheinander und getrennt — also **ohne unabhängiges zweites Modell**.

### Runde 1 — HOLD (0.7)

Messung vorab (nur lesend, 11.10.2026): `listPakete` über die echten Review-Pakete 56 ms (131 Pakete, 2435 gelistete
Dateien, 611 über dem Deckel, 101 Pakete ohne `bericht.md`); `walkAblage` über `~/work/dokumente` 2 ms (228 Dateien).

- Proponent: baut auf der vorhandenen Ablage (Plan 81) auf, statt eine zweite Dateiwelt zu schaffen; Register bleibt
  einzige Quelle für Besitz/Freigaben, Teilen kommt gratis; Abgleich ist idempotent und schreibt nie ins Dateisystem.
- Devil's Advocate (stärkste Punkte): (1) „Verschieben“ einer übernommenen Datei aus einem Unterordner
  (`olaf/flexibilitaeten/pilot-seite/fonts/…`) reißt sie aus einer Website-Struktur und macht sie flach — Datenschaden
  durch einen Klick. (2) Backup schließt Ablage-Dateien aus, der Mongo-Dump enthält aber ihre Einträge → nach einem
  Restore ohne Ablage stehen Einträge ohne Datei (Löschschutz greift, „fehlt“ bleibt sichtbar). (3) Löschschutz blockiert
  auch ein gewolltes Löschen eines Vorgangs mit > Hälfte der Dateien (nur `olaf/flexibilitaeten`, 118). (4)
  Strang-Zuordnung über den auf 500 Zeichen gekürzten Auftrag trifft unvollständig. (5) `ablegen()` und Abgleich im
  selben Moment: Umzug-Erkennung zieht den Upload-Eintrag mit — gleiches Ergebnis, harmlos.
- Specialist: Routen kollidieren nicht (`agenten` passt nicht auf das UUID-Muster); `suggestFor` nur noch für
  „Noch einzusortieren“; Pfadprüfung zerlegt vor dem Dekodieren, `paketFile` prüft jedes Segment auf Symlinks.
- UX: Teams offen, Vorgänge zu; „Zuletzt dazugekommen“ fehlt (Knut sucht oft das Neueste); Aktionen je Datei hinter
  „⋯“; 131 Pakete brauchen Suche und „mehr zeigen“; keine Tabellen in den neuen Bereichen (Handy).

Bindende Bedingungen:

1. [must-fix] Kein „Verschieben“/„Ablegen“ für Ablage-Dateien in Unterordnern unterhalb des Vorgangs — Server (400)
   und Oberfläche (kein Knopf).
2. [must-fix] Löschen von Ablage-Dateien 403 (Server) und kein Knopf (Oberfläche).
3. [verify] API-Test: Abgleich über `GET /api/files`, Teilen an Bernd + Download ohne Pfad, 403 Löschen, Nicht-Admin 403
   auf `/api/files/agenten*`, Pfadausbruch über die API 404.
4. [must-fix] UX: „Zuletzt dazugekommen“ (8), Baum mit Suche + Art-Filter, Aktionen hinter „⋯“, Pakete mit Suche und
   „mehr zeigen“ (30 je Schritt), Vorschau als Overlay; keine Tabelle in Baum/Paketen.
5. [verify] Screenshots Desktop + 390 px ohne waagrechtes Scrollen (Playwright misst `scrollWidth <= innerWidth`).
6. [doc] Bericht nennt Restore-Hinweis (2), Löschschutz-Grenzfall (3) und die Strang-Trefferquote als ungemessen,
   solange die Live-Daten nicht lesbar sind.

### Runde 2 (gebauter Stand) — PASS (0.75)

Bedingungen 1–6 geprüft:
1. `ablegen()` antwortet für Ablage-Dateien in Unterordnern mit 400, und die Oberfläche zeigt dort kein „Verschieben“
   (API-Test).
2. Löschen antwortet mit 403, es gibt keinen Knopf (API-Test).
3. Der API-Test „Dateien vollständig“ ist grün.
4. Die UX-Punkte sind umgesetzt (Bilder in `review-pakete/134-dateien-vollstaendig/screens/`).
5. Die Screenshots zeigen auf Desktop und Handy nirgends waagrechtes Scrollen.
6. Restore, Löschschutz und Strang-Trefferquote stehen im Bericht. Die Quote ist gemessen: 8 von 9 Strängen nennen ihr
   Paket im Auftrag.

Neue Funde aus dem Review-Pass, gleich behoben:
- (a) Kopie statt `mv`: Die junge Kopie liegt im 2-min-Fenster, deshalb wurde der alte Eintrag mitsamt Freigaben
  gelöscht. Jetzt wartet ein fehlender Eintrag, solange eine junge unbekannte Datei gleicher Größe existiert (Test
  „Kopie statt mv“).
- (b) Beim Zusammenführen von Doppelten wird niemand mehr mit sich selbst geteilt.
- (c) In „Noch einzusortieren“ ließ sich nichts teilen. `_eingang` steht jetzt als eigener Ordner mit im Baum.

Bleibt sichtbar (nicht blockierend):
- Der Smoke-Test (`e2e/smoke.mjs`) ist auf die neue Ansicht umgestellt, aber nicht gelaufen, weil er ein laufendes
  LibreChat braucht.
- Der erste Live-Abgleich hasht einmal 275 MB.
