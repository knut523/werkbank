# Plan: Release 31 „Umzug“, Schnitt 3+4 — Betrieb, Geheimnis-Vermittler, Coolify, Dateien/Screenshot, Kontingent

Auftrag Knut (RL08, 02.11.2026) plus zwei Nachträge vom selben Tag („Melious läuft gefährlich niedrig“: Modelle per Schalter,
Zuarbeit per Schalter; „wir müssen flexibel sein“: Kontingent sichtbar, `=auto`). Grundlage: Lückenliste Paket 400
(Abnahme-Zeilen 4, 9, 10, 13, 16, 19). Schnitt 1+2 (`pr_lage`, Jira beide Seiten, Lage-Ansicht) baut ein anderer Strang — hier
keine Dateien davon, neue Logik in eigenen Modulen, in den gemeinsamen Dateien nur kleine, abgegrenzte Blöcke.

## Grundsätze (gelten für jedes Werkzeug)

1. **Jedes neue Werkzeug hinter einem eigenen Schalter, Vorgabe aus.** Nichts ändert sich, bis Knut ihn in `.env.local` setzt.
2. **Nur im Hauptchat** (`WERKBANK_LEITSTAND=1`); in Strängen sind die schreibenden gesperrt (`orchestratorBlock`, Deny-Regeln).
3. **Schreiben = Karte mit Ja/Nein + Klick-Nachweis.** Die Brücke stellt die Karte (wie `github_schreiben`) und merkt sich nach „ja“
   einen einmaligen Nachweis (`freigabeMerken`); die Web-App, die wirklich handelt, verbraucht ihn (`/internal/aktion-freigabe`).
   Auch im Auto-Modus „voll“: `ask`-Regel in `autoSettings` (der PreToolUse-Hook läuft dort nicht).
4. **Kein Geheimniswert ins Modell, ins Log oder in eine Antwort.** Werte holt nur die Web-App (`bw` mit der Sitzung aus
   `~/.config/vw/session`, Muster `creds.ts githubReadToken`); Antworten werden zusätzlich auf den Wert hin geschwärzt.
5. **Positivlisten im Code** (Review + Release nötig), Erweiterung nur über `.env.local` (das der Hauptchat nie lesen und nur
   per Klick schreiben kann). Die Schalter der neuen Rechte selbst stehen **nicht** auf der Liste von `werkbank_betrieb`
   (der Hauptchat kann sich keine Rechte freischalten).

## Teile

| # | Werkzeug | Schalter (Vorgabe aus) | Klick | Abnahme |
|---|---|---|---|---|
| 1 | `werkbank_betrieb` (schalter_setzen · neustart_web · neustart) | `WERKBANK_HAUPTCHAT_BETRIEB=on` | je Aufruf | 10 |
| 2 | `werkbank_stand` (Live-SHA vs. Release, Schalter Soll/Ist ohne Werte, Prozesse) | `WERKBANK_HAUPTCHAT_BETRIEB=on` | nein (lesend) | 16 |
| 3 | `geheimnis_nutzen` (HTTP-Aufruf mit Wert aus Vaultwarden) | `WERKBANK_GEHEIMNIS=on` | je Aufruf | 4 |
| 4 | `coolify` (status · variable_setzen · neustart · deploy) + Bash-Regel | `WERKBANK_COOLIFY=on` | je schreibendem Aufruf | 9 |
| 5 | `datei_teilen` (Download-Link) · `screenshot` (Desktop/Handy, Bild im Chat) | `WERKBANK_DATEIEN_CHAT=on` | nein | 13, 19 |
| 7 | Kontingent-Anzeige (Melious-Rest, Monat je Modell; Claude je Konto: erschöpft bis/frei, Züge heute) | keiner (nur Anzeige) | — | Nachtrag 2 |
| 8 | Modellwahl per Schalter: `WERKBANK_REGULAR_MODELL`, `WERKBANK_QUICK_MODELL`, `WERKBANK_ZUARBEIT`, je auch `auto`; Schwelle `WERKBANK_KONTINGENT_SCHWELLE` (20) | Vorgabe = heutiges Verhalten | — | Nachtrag 1+2 |
| 6 | Abnahme-Nachspiel der 20 Zeilen (soweit mit S3/S4 möglich) | — | — | alle |

### 1 `werkbank_betrieb`

- **Positivliste** `SCHALTER` in `web/server/betrieb.ts`: Name, erlaubte Werte, Prozess (web/bruecke/beide → welcher Neustart),
  Code-Vorgabe. Werte sind aufgezählt (on/off/auto/Modellnamen/Zahl 0–100) → kein Zeilenumbruch, keine Einschleusung.
- Schreiben: nur die eine Zeile `NAME=wert` in `<Instanz>/.env.local` (ersetzen oder anhängen), atomar (tmp + rename, Rechte bleiben).
  Die Antwort nennt nur „NAME: alt → neu“ für Namen der Liste; andere Zeilen werden nie zurückgegeben.
- Neustart: die Web-App startet `scripts/werkbank.sh restart-web|restart` der eigenen Instanz **abgelöst** (setsid, 3 s Verzug, damit
  die Antwort noch ankommt), Ausgabe nach `.runtime/logs/betrieb-neustart.log`. Drain ohne eigenen Zug: die Brücke meldet in
  `/health` zusätzlich `drainOhneLeit` (laufende Züge ohne Hauptchat); `werkbank.sh` zählt mit `WB_DRAIN_FELD=drainOhneLeit` nur diese.
- Danach: Stränge laufen über `autoWeiter` von selbst weiter (unverändert); der Hauptchat bekommt das vorhandene `weiterEvent` und
  zusätzlich eine Meldung „Neustart fertig“ aus einer Marke, die die Web-App beim Start liest (`meldeLeitstand`).

### 2 `werkbank_stand`

Live-SHA (aus „Live = …“, `releasestand.ts`) gegen den Kopf des Release-Zweigs; je Schalter der Liste: Code-Vorgabe · Soll
(`.env.local`) · Ist (laufender Prozess; Web direkt, Brücke über `/health` → nur Wertklasse) · „Neustart nötig“. Prozesse: Web-
Laufzeit, Brücke erreichbar + laufende Züge + Start. Nie Werte außerhalb der Liste; Werte der Liste sind keine Geheimnisse.

### 3 Geheimnis-Vermittler `geheimnis_nutzen`

- Zwecke im Code (`ZWECKE` in `web/server/geheimnis.ts`): Name → Vaultwarden-Eintrag + Feld, erlaubte Hosts (exakt, nur https, kein
  Port, keine Zugangsdaten in der URL), erlaubte Methoden, Header-Form (z. B. `Authorization: Bearer {}`). Erweiterung per
  `WERKBANK_GEHEIMNIS_ZWECKE` (JSON in `.env.local`, gleiche Prüfung).
- Ablauf: Karte (Zweck, Eintrag, Methode, URL, Body) → Klick → Web-App holt den Wert, ruft genau diese URL auf (`redirect: manual`,
  30 s), schwärzt den Wert (roh, URL- und Base64-kodiert) aus der Antwort, gibt Status + gekürzten Text zurück. Kein Cache.

### 4 `coolify`

- Apps nur nach Positivliste `WERKBANK_COOLIFY_APPS` (Muster, Vorgabe `knut-olaf-bot-demo*`), Auflösung Name → UUID über
  `GET /applications`. Aktionen: `status` (lesend, ohne Klick: App, Zustand, letzte Deployments, Variablen **nur Namen**),
  `variable_setzen` (Klick), `neustart` (Klick), `deploy` (Klick). Token über Zweck `coolify` (Teil 3), ohne zweiten Klick.
- **Lücke schließen:** Bash an Coolify (Host `coolify.konekto.energy` bzw. dessen IP) fragt immer: `ask`-Regel in `autoSettings`
  (Auto-Modus) und `confirm` in `classify`/`leitstandCheck` (Hook-Weg).

### 5 `datei_teilen` und `screenshot`

- `datei_teilen(pfad|id)`: Datei aus „Meine Dateien“ (id) oder aus erlaubten Ordnern (eigener Scratch, Review-Pakete, Ablage)
  → Eintrag in „Meine Dateien“ (Kopie) → Link `…/werkbank/api/files/<id>/download` (Login-Cookie, kein öffentlicher Link).
- `screenshot(url, geraet)`: Playwright/Chromium der Web-App; Werkbank-Seiten mit Knuts Sitzung; Größen desktop 1440×900,
  handy 390×844 (dpr 2) wie in `web/e2e`. PNG in „Meine Dateien“, Antwort mit Markdown-Bild (`?inline=1`, neu im Download für
  Bilder) und Pfad, damit der Hauptchat das Bild selbst ansehen kann (Read).

### 7/8 Kontingent und Modellwahl

- `web/server/kontingent.ts` (rein + dünne Hülle): Melious-Rest in % (Dashboard echt, sonst geschätzt; Sperre = 0), Monat je
  Modell; Claude je Konto (Reihenfolge wie Brücke) erschöpft bis/frei (`/internal/accounts-state`), Züge heute aus `zug_log`.
- `wahl(einstellung, lage)`: `melious:<abo-modell>` | `claude` | `auto` → auto = Melious, solange Rest ≥ Schwelle; sonst Claude;
  alle Claude-Konten erschöpft → Melious. Gilt für REGULAR, QUICK (Strangstart) und ZUARBEIT (Text im Auftrag + Weiche der
  Brücke für lesende Teilagenten). Jede Umschaltung von auto → Meldung an den Hauptchat + Anzeige; nie still.
- Anzeige: `GET /api/kontingent`, Zeile in der Kopfleiste der Werkbank; das Werkzeug `auslastung` hängt dieselbe Zeile an.

## Tests

Je Teil eine Testdatei (rein, ohne Netz): Positivliste/Werte, `.env.local`-Bearbeitung, Karten und Einordnung (`classify`,
`orchestratorBlock`, `autoSettings.ask`), Klick-Nachweis Pflicht, Schwärzung, Host-/Methodenprüfung, Coolify-Musterliste,
Kontingent-Rechnung und jede Wahl-Kombination (Schwelle drüber/drunter, alle Konten erschöpft, Umschaltmeldung). E2E an einer
isolierten Instanz (`scripts/isoliert.sh`) mit Screenshots; Coolify/Vaultwarden dort gegen Stubs, nie gegen Produktion.

## Schalterliste (neu)

| Name | Werte | Vorgabe | Prozess |
|---|---|---|---|
| `WERKBANK_HAUPTCHAT_BETRIEB` | on/off | off | web |
| `WERKBANK_GEHEIMNIS` | on/off | off | web |
| `WERKBANK_GEHEIMNIS_ZWECKE` | JSON | leer | web |
| `WERKBANK_COOLIFY` | on/off | off | web |
| `WERKBANK_COOLIFY_APPS` | Muster, Komma | `knut-olaf-bot-demo*` | web |
| `WERKBANK_COOLIFY_URL` | URL | `https://coolify.konekto.energy` | web |
| `WERKBANK_DATEIEN_CHAT` | on/off | off | web |
| `WERKBANK_REGULAR_MODELL` | `melious:<abo>` / claude / auto | `melious:glm-5.3` | web |
| `WERKBANK_QUICK_MODELL` | `melious:<abo>` / claude / auto | `melious:glm-5.3-flash` | web |
| `WERKBANK_ZUARBEIT` | melious / claude / auto | melious | web + Brücke |
| `WERKBANK_KONTINGENT_SCHWELLE` | 0–100 | 20 | web |

Alle von Hand in `.env.local` (Werkbank hat kein Infra-Repo); die Rechte-Schalter (Betrieb, Geheimnis, Coolify) bewusst nicht über
`werkbank_betrieb` setzbar.

## Draußen

Werte aus Vaultwarden als Coolify-Variable setzen (ohne dass das Modell sie sieht) — als Entscheidung D gestellt, nicht gebaut.
Öffentliche (Cookie-freie) Teilen-Links. Live schalten.
