# OLAF-Werkbank

Chat-Oberfläche fürs Team (LibreChat), hinter der **Claude Code** arbeitet — mit unseren Skills,
dem Obsidian-Vault und Jira, **unter dem eigenen Claude-Konto jeder Person, ohne API-Schlüssel** —
und daneben die **Werkbank-Web-App** mit Einrichtung, Wissen (Vault), Board (Jira-Kopie PM),
Sprint (Review/Planning), Skills und Dateien & Teilen.
Plan und Entscheidungen: [`PLAN.md`](PLAN.md).

```
Browser ─► LibreChat :3080 ── Endpunkt „Claude Code“ + Vorlagen (Schlüssel = eigener Claude-Token)
   │            │  Fußzeile: Links zur Web-App
   │            ▼
   │       claude-bridge :3090 (OpenAI-kompatibel, streamt, Anhänge → Arbeitsverzeichnis)
   │            │  CLAUDE_CODE_OAUTH_TOKEN je Anfrage
   │            ▼
   │       Claude Agent SDK ── Skills (~/.claude/skills ← /vault/_meta/dist-skill), Vault /vault, Jira-MCP
   │
   └──► Werkbank-Web :3070 ── Einrichtung · Wissen · Board · Sprint · Skills · Dateien & Teilen
                │  Login = LibreChat-Konto · Vault nur lesend (Schreiben nur nach Bestätigung)
                ├── MongoDB (eigene DB „werkbank“: Jira-Kopie, Sitzungen, verschlüsselte Zugänge, Dateien)
                ├── Meilisearch (Index „werkbank_vault“: Volltextsuche im Vault)
                ├── Jira REST (Lesen: Kopie von PM; Schreiben: nur nach Klick, mit dem Token der Person)
                └── claude-bridge („Agent ansetzen“: nur lesend, Ergebnis als Kommentarentwurf)
```

## Ein-Klick-Einrichtung

```bash
scripts/werkbank.sh up
```

Das ist der eine Einstieg — auf einer frischen Coder-Workspace genauso wie hier, und beliebig oft
wiederholbar. Es

1. prüft die Werkzeuge (`curl git openssl jq awk`) und installiert **Node 22** nach `.runtime/node`,
   falls keins da ist; lädt **MongoDB** und **Meilisearch** als Binärdateien (kein Docker);
2. klont und baut **LibreChat v0.8.7** (nur beim ersten Mal bzw. bei einem anderen Tag — einige Minuten);
3. erzeugt fehlende **Geheimnisse** in `.env.local` (gitignored, Rechte 600) — vorhandene werden nie
   geändert oder ausgegeben;
4. schreibt die **URLs dieser Workspace** (aus `CODER_WORKSPACE_*`) als verwalteten Block in `.env.local`
   (`DOMAIN_CLIENT/SERVER`, `WERKBANK_PUBLIC_URL`, Fußzeilen-Links);
5. installiert Brücke und Web-App (`npm ci` nur wenn nötig) und baut die Oberfläche, wenn sich etwas geändert hat;
6. richtet die **Team-Skills aus dem Vault** ein (fehlende verlinken, nichts überschreiben, siehe unten);
7. startet alle Dienste, prüft sie und zeigt die nächsten Schritte mit Links.

| Befehl | Was |
|---|---|
| `scripts/werkbank.sh up` | einrichten (falls nötig), starten, prüfen, nächste Schritte |
| `scripts/werkbank.sh down` / `restart` | alles stoppen / neu starten |
| `scripts/werkbank.sh status` | läuft alles? |
| `scripts/werkbank.sh update` | Abhängigkeiten und Build auffrischen, Skills abgleichen, neu starten |
| `scripts/werkbank.sh doctor` | ausführliche Prüfung mit Hinweisen (ändert nichts) |
| `scripts/werkbank.sh skills [--apply]` | Vault-Skills: Bericht bzw. fehlende verlinken |
| `scripts/werkbank.sh test` | Tests der Brücke und der Web-App |
| `scripts/werkbank.sh e2e` | Playwright-Durchlauf durch alle Seiten (siehe „Tests“) |
| `scripts/werkbank.sh bridge-mock on\|off` | Brücke im Mock-Modus (kein Claude-Aufruf) bzw. wieder echt |

Die alten Einzelskripte (`setup.sh`, `start.sh`, `stop.sh`, `status.sh`) gibt es weiter; `werkbank.sh`
ruft sie auf. Logs: `.runtime/logs/<dienst>.log`. Schwere Schritte (LibreChat-Build) nicht parallel
zu anderen Builds laufen lassen.

## Dienste, Ports, Links

Alles läuft nativ und lauscht nur auf `127.0.0.1`. Erreichbar über die Coder-Vorschau (nur mit Coder-Anmeldung).

| Dienst | Port | Link |
|---|---|---|
| **Werkbank-Web** (Einrichtung, Wissen, Board, Sprint, Skills, Dateien) | 3070 | **https://3070--main--dev--knut.ws.konekto.energy** |
| **LibreChat** (Chat) | 3080 | **https://3080--main--dev--knut.ws.konekto.energy** |
| claude-bridge | 3090 | nur intern |
| MongoDB 8.0.20 | 27017 | nur intern |
| Meilisearch v1.35.1 | 7700 | nur intern (Chat-Suche + Vault-Suche) |

Querverweise: in LibreChat führen die Links in der **Fußzeile** zur Web-App (🚀 Einrichtung, 📚 Wissen,
🗂️ Board, 🔁 Sprint, 🧰 Skills, 📎 Dateien); in der Web-App führt **💬 Chat** oben links zurück.
„Im Chat öffnen“, „Im Chat besprechen“ usw. starten einen neuen LibreChat-Chat mit vorbereitetem Text.

## Erste Schritte im Browser

Die Web-App führt beim ersten Aufruf durch vier Schritte (Seite **Einrichtung**):

1. **Konto anlegen** — im Chat „Registrieren“ (nur `@maxenergy.at` / `@konekto.energy`), dann in der
   Werkbank mit **denselben Zugangsdaten** anmelden. Das Passwort prüft LibreChat; die Werkbank merkt
   sich nur eine eigene Sitzung (Cookie, 7 Tage). Zugelassen sind im Pilot nur Konten aus der
   Freigabeliste (`WERKBANK_ALLOWED_EMAILS`, Vorgabe = `BRIDGE_ALLOWED_EMAILS` = Knut).
2. **Eigenes Claude verbinden** — im Terminal `claude setup-token`, den Token (`sk-ant-oat…`) einfügen.
   Er landet verschlüsselt im **LibreChat-Schlüsselspeicher** (gleiches Verfahren wie das Zahnrad im
   Modell-Menü, Ablauf „nie“) und gilt damit im Chat und für „Agent ansetzen“. API-Schlüssel werden abgelehnt.
3. **Eigenes Jira verbinden** — E-Mail + Atlassian-API-Token (mit Bereichen: `read:jira-work`, für
   Schreiben vom Board zusätzlich `write:jira-work`). Wird geprüft (zählt die Tickets in PM),
   AES-256-GCM-verschlüsselt gespeichert (`WERKBANK_CREDS_KEY`), nie angezeigt, nie geloggt.
   **Pilot:** Für Knut kommt der Lesezugang ohne Eintrag aus dem Vaultwarden der VM — derselbe Weg wie
   `maxenergy-jira/scripts/jira-read.sh` (Eintrag „Jira api“, `JIRA_EMAIL`, `bw` mit `~/.config/vw/session`),
   nur im Speicher, 10 Minuten. Dieser Token **darf nicht schreiben**.
4. **Loslegen** — Kacheln zu Chat, Wissen, Board, Sprint, Skills, Dateien; darunter der Zustand der Dienste.

## Die Seiten

### 📚 Wissen — der Vault, nur lesend

- **Übersicht** je Team-Wurzel (`olaf/`, `konekto/`, `amper/`, `Intern/`, `_meta/`): Home, Open Questions,
  MOCs, neueste Timeline, PARA-Ordner (`00-Inbox`, `1-Projects`, `2-Areas`, `3-Resources`, `4-Archive`, …).
- **Baum** wie im Obsidian-Explorer, **Roadmap** Produkt-OLAF als Tabelle Thema × Zustand
  (`2-Areas/Product/Produkt-OLAF/1-Roadmap/<Thema>/<n-Zustand>/`, Übersichtsseiten `0-Overview`).
- **Notizen** gerendert: Frontmatter als Chips, Callouts (`> [!note]-`) aufklappbar, Wikilinks klickbar
  (Auflösung über den vault-weit eindeutigen Basenamen, `\|` in Tabellen), nicht auflösbare Links
  markiert, Kommentaranker ausgeblendet, kein Roh-HTML aus Notizen. Rechts **Backlinks**, **Verweist auf**
  und ein kleiner Nachbarschafts-Graph.
- **Volltextsuche** über Meilisearch (eigener Index, nur lesend indiziert; neu bei Änderungen am Vault
  nach 20 s und alle 10 Minuten, oder per „↻ Index“).
- **„Im Chat öffnen“** startet einen Chat mit der Notiz als Kontext. Geändert wird der Vault von hier
  aus nie — das macht Claude im Chat, nach „ja“.

### 🗂️ Board — Jira-Kopie von PM

- Kopie des Projekts **PM** („OLAF“; nicht das Projekt mit dem Schlüssel OLAF): Schlüssel, Titel, Status,
  Owner, Parent/Workstream, Fälligkeit, Priorität, Aktualisiert, Beschreibungsauszug, Anzahl Kommentare,
  letzter Kommentar. Abgleich alle 15 Minuten (Pilot: mit Knuts Lesetoken) und per „↻ Jetzt synchronisieren“
  (mit dem Zugang der klickenden Person).
- **Spalten** = Status (Backlog, To Do, In Progress, Ongoing, Done), **Bahnen** = Workstreams
  (Sub-tasks über ihren Parent). **Filter:** Owner, überfällig, ohne Datum, Suche; ältere erledigte ausgeblendet.
- **Karte:** Details, Sub-tasks, „Im Chat besprechen“ und — jeweils mit **Bestätigungsdialog**, unter dem
  eigenen Jira-Konto — **Kommentar**, **Statuswechsel** (nur Übergänge, die es wirklich gibt) und **Fälligkeit**.
- **🤖 Agent ansetzen** (Idee kandev/Vibe Kanban): startet über die Brücke eine Claude-Code-Sitzung mit
  dem eigenen Claude-Token und dem Ticket als Kontext, **nur lesend** (Schreibwerkzeuge werden ohne
  Rückfrage abgelehnt). Verlauf live an der Karte; am Ende ein **Kommentarentwurf**, bearbeitbar, der
  erst nach „An Jira senden“ + Bestätigung gepostet wird.
- **Keine neuen Tickets** aus der Werkbank (olaf-jira: nur auf ausdrücklichen Auftrag, mit Duplikatsuche
  und Workstream) — dafür die Chat-Vorlage „Jira-Ticket anlegen“.

### 🔁 Sprint — Review und Planning aus dem Vault

- Zyklus aus `olaf/1-Projects/sprint-JJJJ-MM-TT/` (Summary, Review, Planning; Archiv wählbar).
- **Sprint-Ziel** und **Ergebnisse S1–S4** (DoD, Owner, Datum) aus der Planning-Notiz, daneben die
  **Review-Bewertung** derselben S-Zeilen (✅/🟡/❌, Beleg, „Warum / was ändern wir“).
- **Fragen und Antwortzeilen** je Notiz und Abschnitt: jede Zeile mit Anker `<!--k:PM-xxx-->` (auch in
  Callouts), vorhandene Antworten, leere Felder `  - Name:`, Mitnahme `→ mitnehmen:`, bereits
  übertragene `✓`-Zeilen, Jira-Status aus der Kopie. **Antworten** geht direkt in der Seite: Vorschau als
  Diff → Bestätigen → die Zeile wird in die Notiz geschrieben (leeres Feld gefüllt oder neue Zeile mit
  richtiger Einrückung/Callout-Präfix). Hat sich die Notiz inzwischen geändert, wird nicht geschrieben.
- **Überfällige und undatierte Tickets** aus der Jira-Kopie („offen“ ist kein Befund, sondern eine Frage).
- **Sprint-Sync vorbereiten**: führt `jira-sync-plan.sh --sprint <Ordner>` aus (read-only), übersetzt die
  Notizen in Vorschläge (Status / Fälligkeit / Kommentar in der Form `Name (Sprint Review, TT.MM.JJJJ): …`),
  markiert Widersprüche zum Board und offene Fragen, `→ mitnehmen` nie nach Jira. Ausgeführt wird nur,
  was angehakt und bestätigt ist; danach markiert `jira-sync-mark.sh` genau die umgesetzten Zeilen mit
  `✓ Datum → Jira`. Tickets anlegen gehört nicht dazu.
- **Neuen Zyklus anlegen**: legt den Ordner mit den drei Notizen aus `templates/sprint/` an (gültiges
  Frontmatter, Sprint-Ziel, Tabelle S1–S4, Review-Abschnittsfolge nach `olaf-sprint-planning`) — nach
  Vorschau und Bestätigung. Den alten Zyklus archiviert die Runde (nicht automatisch).

### 🧰 Skills

- Alle Skills, die Claude in der Werkbank hat: Name, Beschreibung, Stand, Quelle, Version (Frontmatter
  `version` oder Inhalts-Hash) und letzte Änderung. Stände: *verlinkt* (aus dem Vault, immer aktuell),
  *fehlt*, *lokale Kopie gleich/abweichend*, *nur lokal*, *Link woandershin*, *kaputter Link*.
- **Einrichten** wie das Coder-Startskript: fehlende Vault-Skills (`/vault/_meta/dist-skill/*/`) werden
  als Link nach `~/.claude/skills` (bzw. `$CLAUDE_CONFIG_DIR/skills`) gelegt; **nichts wird überschrieben** —
  abweichende lokale Kopien werden nur gemeldet (derzeit `olaf-jira-sync`, `olaf-service-cases`).
- **Schnellstart:** Kacheln für die Chat-Vorlagen (siehe unten).

### 📎 Dateien & Teilen

- **Dateien**: hochladen (bis 25 MB; PDF, Bilder, Text/Markdown/CSV/JSON, Office, OpenDocument, `.eml` —
  keine Programme, Skripte, Archive, HTML/SVG), optional „enthält Personendaten“ markieren,
  **mit Teammates teilen** und zurücknehmen, herunterladen (immer als Anhang, `nosniff`), löschen.
  **„Im Chat“** legt eine Kopie ins eigene Claude-Arbeitsverzeichnis (`dateien/…`, 0600) und startet einen Chat.
  Gespeichert unter `.runtime/werkbank/files/` — nie im Repo, **keine externen Links**.
- **Chats**: „Geteilt mit mir“ und „Von mir geteilt“ (aus LibreChat). **Als Kopie weiterführen** legt den
  Verlauf als Markdown ins **eigene** Arbeitsverzeichnis (`geteilt/<id>.md`) und startet einen neuen
  Chat mit dem **eigenen** Claude — nie mit Token oder Sitzung der teilenden Person.
- **Protokoll**: wer hat was (nur ID) mit wem geteilt, append-only in `.runtime/werkbank/share-log.jsonl`,
  ohne Inhalt und ohne Dateinamen. Jede Person sieht ihre Einträge, Admins alle.

## Was im Chat passiert

- **Eine Claude-Code-Sitzung je Chat.** Die Brücke merkt sich Chat-ID → SDK-Sitzung
  (`.runtime/bridge/sessions.json`) und setzt bei der nächsten Nachricht fort (`resume`).
- **Statuszeilen statt JSON:** Werkzeugaufrufe erscheinen als kurze kursive Zeilen, z. B.
  „🔎 Suche im Vault: …“, „📄 Datei gelesen: …“, „🎫 Jira: getJiraIssue – PM-123“, „🧰 Skill: olaf-jira“.
- **Schreiben nur nach „ja“.** Lesen, Suchen, Skills und Teilagenten laufen ohne Rückfrage. Vor jedem
  Schreiben/Ändern von Dateien, jedem Bash-Befehl und jedem schreibenden Jira-/MCP-Aufruf hält die
  Sitzung an und fragt; die nächste Nachricht ist die Antwort („ja“ → ausführen, sonst nicht). Offene
  Rückfragen verfallen nach 30 Minuten.
- **Gesperrt, auch mit „ja“:** `git push`, `git merge`, `gh pr merge|create|comment|review…`, schreibende
  GitHub-API-Aufrufe, GitHub-MCP-Schreibwerkzeuge (Hook `PreToolUse` + `canUseTool`).
- **Anhänge erreichen die Sitzung:** Dateien, die im Chat mit **„Hochladen zum KI-Anbieter“** angehängt
  werden, legt die Brücke in `anhaenge/<chat>/` im Arbeitsverzeichnis der Person ab (erlaubte Typen,
  20 MB je Datei, Rechte 0600, Namen bereinigt, nie ausführbar) und nennt sie Claude im Prompt.
  („Hochladen als Text“ schickt den Text direkt mit.)
- **Vorlagen** im Modell-Menü starten einen Chat mit passender Vorgabe (LibreChat `promptPrefix`, von der
  Brücke beim Sitzungsstart weitergegeben): **Spec schreiben (plan-to-pr)**, **Council**,
  **Jira-Ticket anlegen (olaf-jira)**, **Sprint-Review**, **Service-Fall**, **Vault aufräumen**.
- **Chats teilen:** oben rechts „Teilen“ → Link erstellen → Zugriff verwalten → Teammates auswählen.
  Links sind **nur für angemeldete Konten** lesbar (`ALLOW_SHARED_LINKS_PUBLIC=false`,
  `interface.sharedLinks.public: false`, Rolle ohne `SHARE_PUBLIC`); ohne Anmeldung → 401.
- **Grenzen gegen Missbrauch:** ein laufender Zug je Nutzer, 15 Minuten je Zug, höchstens 40 Schritte.
- **Titel** erzeugt die Brücke aus der ersten Nachricht, ohne Claude aufzurufen.

## Umgebung der Claude-Sitzungen (Pilot)

- Laufen als **VM-Nutzer `knut`** mit `settingSources: ['user', 'project']` und `skills: 'all'`:
  `~/.claude/CLAUDE.md`, alle Skills unter `~/.claude/skills`, Plugins, Knuts Hooks und MCP-Server gelten
  wie im Terminal. Arbeitsverzeichnis je Nutzer: `.runtime/bridge/scratch/<nutzer-id>` (dort liegen auch
  `anhaenge/`, `dateien/`, `geteilt/`); `/vault` ist zusätzlich freigegeben.
- **Jira im Chat** kommt aus der Nutzer-MCP-Konfiguration (Atlassian-MCP, OAuth) — im Pilot Knuts Anmeldung,
  deshalb die E-Mail-Freigabe.
- **Für den Team-Workspace nötig:** je Person eigener Unix-Nutzer oder eigenes `CLAUDE_CONFIG_DIR`
  (Skills per `werkbank.sh skills --apply` mit `CLAUDE_CONFIG_DIR` verlinken), eigener Jira-Zugang je
  Person (Einrichtung), Vault-Schreibrechte klären, dann die Freigabelisten entfernen.

## Sicherheit und Datenschutz

- Keine Zugangsdaten im Repo oder im Log: Claude-Token im LibreChat-Schlüsselspeicher (AES-CBC mit
  `CREDS_KEY`), Jira-Token AES-256-GCM (`WERKBANK_CREDS_KEY`), Werkbank-Sitzungen nur als Hash.
- Schreibende Aufrufe der Web-App brauchen Sitzung + Header `x-werkbank: 1` (CSRF) und — für Vault und
  Jira — eine ausdrückliche Bestätigung im Dialog (ohne sie liefert der Server nur die Vorschau).
- Vault-Pfade werden auf `/vault` begrenzt; Notizen werden ohne Roh-HTML dargestellt; strenge CSP.
- **Hochgeladene Dateien werden nicht auf Viren geprüft.** Sie werden nie ausgeführt, nur als Anhang
  ausgeliefert, und nur erlaubte Typen werden angenommen — trotzdem nur Dateien aus bekannter Quelle
  hochladen. Dateien mit Personendaten bleiben in der Workspace (keine öffentlichen Links, kein zweiter Anbieter).
- Die Anmeldung der Web-App gibt die Client-IP an LibreChat weiter, damit dessen Anmelde-Limit je Person greift.

## Konfiguration im Repo

| Datei | Inhalt |
|---|---|
| `scripts/werkbank.sh` | der eine Einstieg (up/down/restart/status/update/doctor/skills/test/e2e/bridge-mock) |
| `scripts/setup.sh`, `start.sh`, `stop.sh`, `status.sh`, `env.sh` | Einzelschritte, idempotent |
| `librechat/librechat.yaml` | Endpunkt „Claude Code“, Modell-Specs und Vorlagen, Teilen, Oberfläche, Registrierung |
| `librechat/.env` | LibreChat-Umgebung **ohne** Geheimnisse (Ports, Login-Schalter, Teilen) |
| `.env.local` | Geheimnisse + verwalteter URL-Block — erzeugt, gitignored, 600 |
| `claude-bridge/src/` | Brücke: `server.ts` (HTTP, Anhänge, Vorgaben, Nur-lesen-Modus), `sessions.ts`, `tools.ts`, `attachments.ts`, `mock.ts` |
| `web/server/` | Web-App-Server (TypeScript, läuft ohne Build): `main.ts` (Routen), `auth.ts`, `creds.ts`, `crypto.ts`, `vault.ts`, `search.ts`, `jira.ts`, `agent.ts`, `sprint.ts`, `syncplan.ts`, `skills.ts`, `sharing.ts` |
| `web/src/` | Oberfläche (Vite + React), Optik wie LibreChat (Inter, hell/dunkel) |
| `templates/sprint/` | Vorlagen für neue Sprint-Zyklen (Summary, Review, Planning mit S1–S4) |

## Tests

```bash
scripts/werkbank.sh test   # Brücke (10) + Web-App (29), ohne echte Konten, ohne /vault zu ändern
scripts/werkbank.sh e2e    # Playwright, ca. 1 Minute
```

- **Parser** (`web/test/parsers.test.ts`): Frontmatter, Wikilinks, Backlinks, Darstellung (Callouts,
  kein Roh-HTML), Roadmap; Sprint-Anker und Antwortzeilen (auch in Callouts, Code-Span-Anker zählen
  nicht), Einfügen von Antworten, Sprint-Ziel/S1–S4/Bewertung, Vorlagen, Sync-Vorschläge, Fälligkeiten.
  Die Sync-Zeilen werden **gegen `jira-sync-plan.sh` verglichen** — auf der Fixture und (nur lesend) auf
  den echten Zyklen 2026-09-14 und 2026-09-28: identisch.
- **Jira** (`jira.test.ts`, gegen `test/jira-mock.ts`): Blättern, Abbildung, Workstreams, Nur-lesen-Token.
- **API Ende-zu-Ende** (`api.test.ts`): Login/Freigabe, CSRF, Token-Speicherung, Board-Sync und Filter,
  Bestätigungspfade (Vorschau schreibt nie), Agent-Lauf, Antworten mit Konfliktschutz, Sprint-Sync mit
  ✓-Markierung, neuer Zyklus, Skills, Dateien (Typen, Teilen, fremder Zugriff), geteilte Chats und Kopie.
- **Brücke** (`claude-bridge/test`): zusätzlich Anhänge, Nur-lesen-Modus, Vorlagen-Vorgabe.
- **Playwright** (`web/e2e/smoke.mjs`): alle Seiten mit zwei Testkonten, dazu echt durch LibreChat:
  Anhang erreicht die Sitzung, Vorlage gibt ihre Vorgabe weiter, Chat teilen nur mit dem Teammate
  (anonym 401), Kopie weiterführen, Freigaben zurücknehmen. Bilder unter `.runtime/e2e/web/`.

**Was dabei ersetzt ist:** Jira (lokaler Nachbau), Claude (Brücke im Mock-Modus — `e2e` schaltet sie für
die Dauer um und danach zurück), der Vault (Kopie von `web/test/fixtures/vault`). Die Testkonten und alles,
was an ihnen hängt, werden danach gelöscht.

## Stand (28.09.2026)

**Erledigt und geprüft**
- Ein-Klick-Einrichtung `werkbank.sh up` (hier idempotent erneut gelaufen), `doctor` grün.
- Web-App auf 3070 läuft mit echten Daten: Vault-Index 869 Notizen, Jira-Kopie 307 Tickets (28 überfällig,
  21 offen ohne Datum), aktueller Zyklus 2026-09-28 mit 117 + 15 Ankern; Seiten mit echten Daten
  nur lesend durchgesehen (keine Seitenfehler).
- Skills: 8 fehlende Vault-Skills verlinkt (amper-*, claude-slides, paca-env), 39 verlinkt, 2 abweichende
  lokale Kopien gemeldet, nicht angefasst.
- Alle Tests und der Playwright-Durchlauf grün (16 Schritte).

**Nicht echt geprüft**
- Echter Claude-Durchlauf mit eigenem Token (bewusst nicht — kein Token hier).
- Schreiben nach Jira mit einem echten Schreib-Token (der Pilot-Token darf nur lesen; geprüft gegen den Nachbau).
- Der Teilen-Dialog von LibreChat wurde per API bedient, nicht durchgeklickt.

## Bekannte Grenzen

- Web-App und Chat haben **getrennte Sitzungen** (zwei Subdomains) — einmal in jeder anmelden, gleiche Zugangsdaten.
- Board-Schreibaktionen gehen nur mit einem eigenen Jira-Token mit `write:jira-work`; sonst Fehlermeldung
  mit Hinweis, und der Weg über den Chat (Atlassian-MCP, Rückfrage) bleibt.
- Die Jira-Kopie ist für alle Werkbank-Konten gleich (gelesen mit dem Zugang des Pilot-Kontos bzw. der klickenden Person).
- **Bearbeiten/Neu generieren** älterer Nachrichten verzweigt in LibreChat, die Claude-Sitzung läuft linear weiter.
- Bei einem Neustart der Brücke gehen offene Rückfragen verloren; die Sitzung lässt sich fortsetzen.
- Bash-Befehle brauchen im Chat immer ein „ja“, auch rein lesende.
- Die Pilot-Sitzungen haben Knuts Rechte auf der VM (Dateien, Hooks, Gedächtnis, Jira).
- Hochgeladene Dateien: kein Virenscan (siehe oben).

## Offene Entscheidungen

1. **Zielstruktur S1–S4 im Skill festschreiben.** Die Vorlagen in `templates/sprint/` nutzen je eine
   Tabelle `| # | Ergebnis | DoD | Owner | Datum |` (Planning) und `| # | Ergebnis | Bewertung | Beleg | Warum / was ändern wir |`
   (Review); der Skill `olaf-sprint-planning` beschreibt das noch nicht, der Zyklus 2026-09-28 hat noch keine S-Zeilen.
   *Empfehlung:* Tabellenform übernehmen und den Skill im Chat (mit Bestätigung) auf v1.6 nachziehen.
   - Knut:
2. **Jira-Schreiben vom Board.** Der Pilot-Lesetoken darf nicht schreiben. *Empfehlung:* jede Person trägt
   in der Einrichtung einen eigenen Token mit `write:jira-work` ein (Zuordnung stimmt, keine zweite Identität);
   bis dahin schreibt der Chat über den MCP.
   - Knut:
3. **Wessen Sicht speist die Jira-Kopie?** Im Pilot liest der 15-Minuten-Abgleich mit Knuts Lesetoken, alle
   Werkbank-Konten sehen dieselbe Kopie. *Empfehlung:* für PM so lassen (Team-Board); im Team-Workspace ein
   festes Sync-Konto mit reinem Lesetoken bestimmen.
   - Knut:
4. **Darf ein geteilter Chat weitergeführt werden?** Umgesetzt als „Als Kopie weiterführen“ — neuer Chat mit
   dem eigenen Claude, Verlauf als Datei. *Empfehlung:* so lassen; nie die Sitzung der teilenden Person fortsetzen.
   - Knut:
5. **Eine Anmeldung für Chat und Werkbank.** Heute zwei Sitzungen (zwei Coder-Subdomains). *Empfehlung:* im
   Pilot so lassen; im Team-Workspace beide hinter einer Domain (Pfad-Proxy) oder per OIDC anbinden.
   - Knut:
6. **Alten Sprint-Zyklus beim Anlegen archivieren?** *Empfehlung:* nein, nicht automatisch — die Runde
   verschiebt den Ordner im Chat (Skill: als Einheit nach `4-Archive/`, nicht per `mv`), die Werkbank legt nur an.
   - Knut:
7. **Abweichende lokale Skill-Kopien** `olaf-jira-sync` und `olaf-service-cases` in `~/.claude/skills`.
   *Empfehlung:* prüfen, ob die lokale Fassung neuer ist; wenn nicht, Ordner löschen und `werkbank.sh skills --apply`
   verlinkt die Vault-Fassung.
   - Knut:
8. **Virenscan für Uploads.** *Empfehlung:* für den Pilot ohne (Typ-Liste, nie ausführen); im Team-Workspace
   ClamAV vor dem Speichern.
   - Knut:
9. **Aufbewahrung geteilter Dateien.** Derzeit unbegrenzt bis zum Löschen. *Empfehlung:* Dateien mit
   „Personendaten“ nach 90 Tagen automatisch löschen (mit Hinweis vorher).
   - Knut:
