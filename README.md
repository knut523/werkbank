# OLAF-Werkbank

Chat-Oberfläche fürs Team (LibreChat), hinter der **Claude Code** arbeitet — mit unseren Skills,
dem Obsidian-Vault und Jira, **unter dem eigenen Claude-Konto jeder Person, ohne API-Schlüssel** —
und daneben die **Werkbank-Web-App** mit Einrichtung, Wissen (Vault), Board (Jira-Kopie PM),
Sprint (Review/Planning), Roadmap, Skills und Dateien & Teilen.
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
   └──► Werkbank-Web :3070 ── Einrichtung · Wissen · Board · Sprint · Roadmap · Skills · Dateien & Teilen
                │  Login = LibreChat-Konto · Vault nur lesend (Schreiben nur nach Bestätigung)
                ├── MongoDB (eigene DB „werkbank“: Jira-Kopie, Sitzungen, verschlüsselte Zugänge, Dateien)
                ├── Meilisearch (Index „werkbank_vault“: Volltextsuche im Vault)
                ├── Jira REST — nur Lesen (Kopie von PM, Übergänge) mit dem Lesetoken
                ├── claude-bridge /internal/mcp-call — Jira-Schreiben über den Atlassian-MCP der Person (nach Bestätigung)
                └── LibreChat /api/agents/chat — „Agent ansetzen“ legt einen echten Chat „PM-123 · Titel“ an
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
| `scripts/werkbank.sh stream-timing` | Zeitmessung Streaming: Brücke direkt und im Browser durch LibreChat (Mock) |
| `scripts/werkbank.sh bridge-mock on\|off` | Brücke im Mock-Modus (kein Claude-Aufruf) bzw. wieder echt |

Die alten Einzelskripte (`setup.sh`, `start.sh`, `stop.sh`, `status.sh`) gibt es weiter; `werkbank.sh`
ruft sie auf. Logs: `.runtime/logs/<dienst>.log`. Schwere Schritte (LibreChat-Build) nicht parallel
zu anderen Builds laufen lassen.

## Dienste, Ports, Links

Alles läuft nativ und lauscht nur auf `127.0.0.1`. Erreichbar über die Coder-Vorschau (nur mit Coder-Anmeldung).

| Dienst | Port | Link |
|---|---|---|
| **LibreChat** (Chat **und** alle Werkbank-Seiten in der linken Leiste) | 3080 | **https://3080--main--dev--knut.ws.konekto.energy** (Werkbank-Seiten unter `/wb/einrichtung`, `/wb/wissen`, `/wb/board`, `/wb/sprint`, `/wb/roadmap`, `/wb/skills`, `/wb/dateien`) |
| Werkbank-Web direkt (Health/Debug, eigenes Login) | 3070 | https://3070--main--dev--knut.ws.konekto.energy |
| claude-bridge | 3090 | nur intern |
| MongoDB 8.0.20 | 27017 | nur intern |
| Meilisearch v1.35.1 | 7700 | nur intern (Chat-Suche + Vault-Suche) |

Die Werkbank-Seiten sind **Einträge in LibreChats linker Leiste** (siehe „Die Werkbank im Chat“ unten) und öffnen
im Hauptbereich — mit einer Anmeldung. Die Fußzeilen-Links gibt es weiterhin. „Im Chat öffnen“, „Im Chat
besprechen“ usw. starten einen neuen Chat mit vorbereitetem Text im selben Fenster.

## Erste Schritte im Browser

Die Web-App führt beim ersten Aufruf durch fünf Schritte (Seite **Einrichtung**):

1. **Konto anlegen** — im Chat „Registrieren“ (nur `@maxenergy.at` / `@konekto.energy`), dann in der
   Werkbank mit **denselben Zugangsdaten** anmelden. Das Passwort prüft LibreChat; die Werkbank merkt
   sich nur eine eigene Sitzung (Cookie, 7 Tage). Zugelassen sind im Pilot nur Konten aus der
   Freigabeliste (`WERKBANK_ALLOWED_EMAILS`, Vorgabe = `BRIDGE_ALLOWED_EMAILS` = Knut).
2. **Eigenes Claude verbinden** — im Terminal `claude setup-token`, den Token (`sk-ant-oat…`) einfügen.
   Er landet verschlüsselt im **LibreChat-Schlüsselspeicher** (gleiches Verfahren wie das Zahnrad im
   Modell-Menü, Ablauf „nie“) und gilt damit im Chat und für „Agent ansetzen“. API-Schlüssel werden abgelehnt.
3. **Jira lesen** — E-Mail + Atlassian-API-Token (Bereich `read:jira-work` reicht). Wird geprüft (zählt die Tickets in PM),
   AES-256-GCM-verschlüsselt gespeichert (`WERKBANK_CREDS_KEY`), nie angezeigt, nie geloggt.
   **Pilot:** Für Knut kommt der Lesezugang ohne Eintrag aus dem Vaultwarden der VM — derselbe Weg wie
   `maxenergy-jira/scripts/jira-read.sh` (Eintrag „Jira api“, `JIRA_EMAIL`, `bw` mit `~/.config/vw/session`),
   nur im Speicher, 10 Minuten. Dieser Token **darf nicht schreiben**.
4. **Jira schreiben (Atlassian-MCP)** — Knut, 29.09.: „Schreiben erstmal über MCP“. Kommentare, Statuswechsel und
   Fälligkeiten (Board, Sprint-Sync, Pflegefragen, Werkzeug `jira_update`) gehen über den Atlassian-MCP **in der
   Claude-Code-Sitzung der Person**, siehe „Jira schreiben über den MCP“. Knopf **„Jira-MCP prüfen“** liest nur den
   Verbindungsstatus (Init der Sitzung, kein Modellaufruf).
5. **Loslegen** — Kacheln zu Chat, Wissen, Board, Sprint, Skills, Dateien; darunter der Zustand der Dienste.

## Die Werkbank im Chat (linke Leiste)

Unter dem „Neuer Chat“-Knopf stehen sieben Symbole: 🚀 Einrichtung · 📖 Wissen · 🗂 Board · 🔁 Sprint ·
🧭 Roadmap · 🧩 Skills · 🔗 Dateien & Teilen. Ein Klick öffnet die Seite im Hauptbereich von LibreChat (Adresse
`/wb/<seite>`, Unterseiten stehen als `?h=…` in der Adresszeile und überstehen Neuladen).

- **Eine Anmeldung:** LibreChat reicht `/werkbank/*` an die Web-App (3070) durch. Dort kommt LibreChats
  Refresh-Cookie mit; die Web-App prüft ihn wie LibreChat selbst (Signatur mit `JWT_REFRESH_SECRET` und
  gültige Sitzung mit diesem Token-Hash in LibreChats DB). Die Freigabeliste gilt weiter. Direkt auf 3070
  gibt es weiter das eigene Login (für Health/Debug). `/werkbank/internal/*` reicht der Proxy nie durch.
- **Optik:** gleiche Schrift (Inter), Farben und Abstände wie LibreChat; **Hell/Dunkel folgt dem Chat**
  (die Seite beobachtet LibreChats `dark`-Klasse), Symbole aus LibreChats Symbolsatz (lucide).
- **Technik, klein und wiederholbar:** zwei neue Dateien (`librechat/overlay/…`: Proxy, Leiste, Seite) und zwei
  kleine Patches (`librechat/patches/10-server-werkbank-proxy.patch`: 2 Zeilen in `api/server/index.js`;
  `20-client-werkbank-nav.patch`: Leiste + Route). `scripts/librechat-patch.sh` spielt sie bei jedem
  `werkbank.sh up|update` ein (schon angewandte werden erkannt; passt ein Patch nach einem LibreChat-Update
  nicht mehr, bricht es mit Hinweis ab) und baut nur den Client neu, wenn sich etwas geändert hat.

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
  aus nur an zwei Stellen, jeweils nach Vorschau und Bestätigung: `jira:` ins Frontmatter (Verknüpfen) und
  Antwortzeilen (Sprint, Roadmap). Alles andere macht Claude im Chat, nach „ja“.
- **Verknüpfte Tickets** je Notiz (rechts): Keys aus Frontmatter (`jira`, `ticket`, `tickets`, `jira-key`), aus dem
  Text (ohne Code) und aus Jira-Links, mit Status aus der Kopie. Für Notizen **ohne** Key: „Passt vielleicht zu“
  (siehe „Dokumente an Tickets“).

### 🗂️ Board — Jira-Kopie von PM

- Kopie des Projekts **PM** („OLAF“; nicht das Projekt mit dem Schlüssel OLAF): Schlüssel, Titel, Status,
  Owner, Parent/Workstream, Fälligkeit, Priorität, Aktualisiert, Beschreibungsauszug, Anzahl Kommentare,
  letzter Kommentar. Abgleich alle 15 Minuten (Pilot: mit Knuts Lesetoken) und per „↻ Jetzt synchronisieren“
  (mit dem Zugang der klickenden Person).
- **Spalten** = Status (Backlog, To Do, In Progress, Ongoing, Done), **Bahnen** = Workstreams.
  **Filter:** Owner, überfällig, ohne Datum, Braucht Pflege, Suche; ältere erledigte ausgeblendet.
- **Sub-tasks hängen unter ihrer Karte** (keine eigenen Karten mehr): „▸ Sub-tasks **2/5** erledigt“ mit
  Fortschrittsbalken, auf-/zuklappen je Karte oder alle („Sub-tasks aufklappen“), je Sub-task Key, Titel,
  Status, Owner, Datum (überfällig rot) und 🧹 „Braucht Pflege“; Klick öffnet den Sub-task. Filter greifen auch
  über Sub-tasks (eine Karte bleibt sichtbar, wenn nur ein Sub-task passt, dann blasser).
  **Kaputte Sub-tasks** — Sub-task ohne Parent (in der echten Kopie PM-259…264 und PM-266: Jira liefert
  dort kein `parent`, sie hängen also *nicht* unter dem Workstream) — stehen als eigene Karte mit
  „⚠ kaputt: Sub-task ohne Parent“ in „Ohne Workstream“, oben gezählt, und haben die Pflegeregel
  „Sub-task ohne Parent“.
- **Karte:** Details, Sub-tasks, **Dokumente**, „Im Chat besprechen“ (legt einen verknüpften Chat an) und —
  jeweils mit **Bestätigungsdialog** — **Kommentar**, **Statuswechsel** (nur Übergänge, die es wirklich gibt)
  und **Fälligkeit**, geschrieben **über den Atlassian-MCP** (siehe unten).
- **🤖 Agent ansetzen = echter Chat** (Knut, 29.09.): legt in LibreChat eine neue Unterhaltung
  **„PM-123 · Titel“** mit dem Ticket als Kontext an — im Namen der Person (kurzlebiger LibreChat-Zugangstoken,
  derselbe Aufruf wie „Senden“), unter ihrem Claude. LibreChat fährt den Zug serverseitig weiter, der Agent
  arbeitet also **auch ohne offenen Tab**; wer den Chat öffnet, sieht den Fortschritt live. Jedes Schreiben
  (Vault, Dateien, Jira) hält im Chat an und wartet auf **„ja“**; GitHub-Schreiben ist gesperrt. An der Karte:
  Status **läuft / wartet auf ja / fertig** (aus der Brücke), „Im Chat öffnen“, welche Dateien der Agent
  geschrieben hat; am Board-Kärtchen „🤖 wartet auf ja“. Ein Agent je Karte und Person; eine offene Rückfrage
  bleibt stehen, auch wenn die Person inzwischen woanders chattet (höchstens 5 wartende je Person).
- **📝 Nur Entwurf** bleibt als Option: lesend im Hintergrund, Ergebnis als bearbeitbarer Kommentarentwurf,
  der erst nach „An Jira senden“ + Bestätigung gepostet wird.
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

### 🧭 Roadmap — Produkt OLAF, eigene Sektion (Knut, 29.09.)

Quelle nur der Vault unter `olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap/` (Regeln aus dem Skill `olaf-produkt-roadmap`).
Eigener Eintrag in LibreChats Leiste (🧭) und in der Web-App, fünf Reiter:

| Reiter | Was | Schreibt |
|---|---|---|
| **Priorisierung** | Rangliste aus `0-Overview/priorisierung-roadmap-produkt-olaf.md` (die Tabelle, die `scripts/rank.py` erzeugt): Rang, WSJF, GW/ZK/RR/Größe, Kategorie, blockiert durch, nächster Schritt, **Gründe** (Abschnitt 2.1), offene Knut-Zeilen, Jira-Keys und PRs der Spec. ▲/▼ verschiebt | nach Bestätigung **einen Vorschlag** als Zeile unter „## Vorschläge aus der Werkbank“ auf der Priorisierungsseite — neu gerechnet wird die Tabelle in der Hauptsitzung (`rank.py` hält die Werte) |
| **Zustände** | Kanban je Thema × Zustandsordner (`1-Backlog … 6-Archive`), je Spec Status, ❓ offene Entscheidungen, Tickets, PRs | — |
| **PR-Review** | PRs aus `0-Overview/pr-stand-produkt-olaf.md` und den PR-Links der Specs: Review-Stand (Änderungen verlangt / freigegeben / offen), **wer ist dran**, Deploy-Gates (Deploy/Migration/Rotation/Flag aus dem Register), Specs, Jira über die Spec. **GitHub nur lesend** (Links) | — |
| **Offene Entscheidungen** | alle leeren `- Knut:`-Zeilen aus Specs und Übersichten (echt: 330), mit Frage (übergeordneter Listenpunkt) und Abschnitt, filterbar nach Thema | Antwort → Vorschau → Bestätigen → genau diese Zeile wird gefüllt (Konfliktschutz über Hash) |
| **Konsistenz** | `scripts/roadmap_check.py` (nur lesend): Befunde je Prüfung B1–B5 (echt heute: 12 Fehler, 58 Hinweise) | — |

Verknüpfung **Spec ↔ Jira ↔ PR**: Jira-Keys einer Spec kommen aus dem Verknüpfungsindex (unten), PRs aus
GitHub-Links und Kurzformen (`admin#175`, `tariff-app #166`) im Spec-Text.

### 📎 Dokumente an Tickets, Vault-Seiten mit Tasks verknüpfen

- **Verknüpfungsindex** (einmal über den ganzen Vault, danach laufend: jede Vault-Änderung baut den Index neu, wie
  die Suche): je Notiz die Keys `PM-\d+` aus Frontmatter (`jira`, `ticket`, `tickets`, `jira-key`), Text (ohne
  Code) und Jira-Links (`…/browse/PM-123`); PR-Links in derselben Zeile wie der Key. Echt: 201 Keys, 115 Notizen mit Key.
- **An der Karte** („📎 Dokumente“): Vault-Notizen mit dem Key (Frontmatter zuerst), vom Karten-Agenten geschriebene
  Dateien (auch ohne Key; der Agent setzt außerdem `jira: <Key>` in neue Notizen), PRs aus dem Vault, **angehängte
  Dateien** (Dateien & Teilen → „an Ticket“, oder an der Karte „Eigene Datei an PM-… hängen“; sichtbar nur für
  Besitzer und Freigegebene), **Chats von dieser Karte** (Agent und „Im Chat besprechen“).
- **Vorschläge** für Notizen ohne Key: Titel, Dateiname und Tags gegen den Ticket-Titel (ohne Personennamen und
  Allgemeinwörter; mindestens zwei gemeinsame Begriffe, einer davon selten, oder ein seltener langer Begriff; ohne
  Transkripte/Daily/Personen). Nur Vorschlag: **Verknüpfen** zeigt vorher/nachher des Frontmatters und schreibt nach
  Bestätigung `jira: PM-123` (vorhandener Wert wird zur Liste); optional zusätzlich ein Kommentar im Ticket über den
  MCP. **„passt nicht“** merkt sich die Ablehnung. Echt: 67 Tickets mit Vorschlag — spürbar Rauschen dabei, deshalb
  bewusst nur Vorschlag.
- **Wissen** zeigt je Notiz „Verknüpfte Tickets“ bzw. „Passt vielleicht zu“.
- PRs direkt von GitHub: **nicht gebaut** (die Werkbank hat keinen GitHub-Lesezugang; PRs kommen aus dem Vault).

### ✍️ Jira schreiben über den MCP

- Lesen bleibt beim **Lesetoken** (Kopie, Übergänge). Geschrieben wird über den **Atlassian-MCP in der
  Claude-Code-Sitzung der Person**: die Web-App ruft die Brücke (`/internal/mcp-call`, interner Token + Claude-Token
  der Person), die eine kurze SDK-Sitzung startet. Deren Wächter erlaubt **genau den einen bestätigten Aufruf mit genau
  diesen Argumenten** (`addCommentToJiraIssue` mit `contentFormat: markdown`, `transitionJiraIssue` mit der Übergangs-ID
  aus dem Lesen, `editJiraIssue` mit `duedate`) und lehnt alles andere ab. Dauert einige Sekunden und ist ein
  kleiner Claude-Zug.
- **401 / nicht angemeldet / MCP fehlt** → klare Meldung mit dem einmaligen Schritt (unten); der Status steht dann
  auch in der Einrichtung. Ohne verbundenen MCP: **keine Pflegefragen** im Chat, nur die Badges und einmal ein Hinweis.
- `WERKBANK_JIRA_WRITE=rest` schaltet auf das alte REST-Schreiben mit eigenem Token zurück.
- **Pilot:** Die Sitzungen laufen als VM-Nutzer `knut` — der Atlassian-MCP ist also Knuts OAuth-Anmeldung, egal
  wer klickt. Deshalb weiter nur Knut freigeschaltet; im Team-Workspace braucht jede Person ihre eigene
  Claude-Konfiguration (eigener Unix-Nutzer oder `CLAUDE_CONFIG_DIR`) mit eigener MCP-Anmeldung.

### 🧰 Skills

- Alle Skills, die Claude in der Werkbank hat: Name, Beschreibung, Stand, **Nutzung** (Aufrufe über das
  Skill-Werkzeug in Werkbank-Sitzungen, Personen, zuletzt; „Kern“ markiert), Quelle, Version (Frontmatter
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

### 🧹 Task-Hygiene — eigene Tickets sauber halten, sanft

Regeln (Skill `olaf-jira`: Daten folgen der Realität; keine neuen Tickets; Statuswechsel nur mit Bestätigung),
angewandt auf die **eigenen** PM-Tickets aus der Jira-Kopie (Zuordnung über `GET /myself` bzw. den Namen):

| Regel | Wann |
|---|---|
| überfällig | Fälligkeit < heute, nicht Done |
| ohne Datum | offen, nicht Backlog, kein Datum |
| still | In Progress und seit 7 Tagen kein Update/Kommentar (`WERKBANK_STALE_DAYS`) |
| Widerspruch | letzter Kommentar klingt erledigt („erledigt“, „ist durch“, „live“ …, ohne „nicht/noch/wartet“), Status offen |
| ohne Workstream | kein Parent |
| Sub-task ohne Owner | Sub-task unter einem eigenen Ticket ohne Owner |

- **Wann gefragt wird (Knut, 28.09.):** nur in der **ersten Werkbank-Chat-Sitzung des Tages** (Wiener Zeit) und
  zum **Tagesabschluss** — erste Sitzung ab 16 Uhr (`WERKBANK_EOD_HOUR`) oder ausdrücklich über die Vorlage
  **„Tagesabschluss“** bzw. den Knopf 🌙 Tagesabschluss (dann zuerst die heute angefassten eigenen Tickets).
  Alle anderen Sitzungen: keine Fragen. Höchstens **3 Fragen**, je Ticket eine, nichts doppelt am selben Tag,
  „später“ = heute nicht mehr. Die eigentliche Anfrage hat immer Vorrang.
- **Im Chat:** Claude fragt kurz, eine Frage nach der anderen; aus der Antwort wird eine Jira-Aktion, die das
  Werkzeug `jira_update` schreibt — **erst nach „ja“** und **mit dem Jira-Zugang der Person** (wie am Board).
  „später“ → `hygiene_snooze`.
- **Board:** 🧹-Zähler je Karte, Bahn und Owner, Filter **„Braucht Pflege“**, oben die eigenen Fragen (höchstens 3).
  **Sprint:** Liste aller eigenen Pflegepunkte. Antworten dort: eine Zeile → Vorschlag → Bestätigen → Jira.

## Was im Chat passiert

- **Eine Claude-Code-Sitzung je Chat.** Die Brücke merkt sich Chat-ID → SDK-Sitzung
  (`.runtime/bridge/sessions.json`) und setzt bei der nächsten Nachricht fort (`resume`).
- **Statuszeilen statt JSON:** Werkzeugaufrufe erscheinen als kurze kursive Zeilen, z. B.
  „🔎 Suche im Vault: …“, „📄 Datei gelesen: …“, „🎫 Jira: getJiraIssue – PM-123“, „🧰 Skill: olaf-jira“.
- **Streaming (Knut, 29.09.: „erscheint erst, wenn final da“):** sofort „⏳ Claude arbeitet …“, bei Denkblöcken
  „💭 denkt nach …“, bei langen Werkzeugschritten alle 15 s „⏳ … läuft seit N s“, Text Wort für Wort. Siehe
  „Streaming: Ursache und Messung“.
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
- **Kontext-Paket** für jede **neue** Sitzung (nicht bei Fortsetzung), siehe unten.
- **Werkzeuge nur für Werkbank-Sitzungen** (Konfiguration der Brücke, nicht die Nutzer-Konfiguration):
  `vault-search` (Vault durchsuchen, lesend) und `werkbank` (`hygiene_list`, `hygiene_snooze`, `skills_list`, `jira_update` mit Rückfrage).
- **Skills je Bedarf:** statt aller Skills sieht eine Sitzung den Kern (`claude-bridge/skills-core.json`, 13 Skills),
  dazu die Skills der gewählten Vorlage und jeden, den man im Chat nennt („Skill olaf-email-templates“,
  `/olaf-email-templates` oder in Backticks) — die Zuschaltung bleibt für die Unterhaltung. `BRIDGE_SKILLS=all` schaltet zurück.
- **Deine Claude-Sitzungen** (Einrichtung): Status je Unterhaltung — läuft / wartet auf „ja“ / bereit — mit Link zum Fortsetzen.
- **Die Sitzung bekommt keine Werkbank-Geheimnisse** in ihre Umgebung (vorher erbte sie `.env.local`).

## Streaming: Ursache und Messung

**Befund (Ende-zu-Ende, im Code nachgesehen):** Die Brücke hatte `includePartialMessages` schon an und schreibt
jedes Textstück sofort; LibreChat v0.8.7 reicht es über den fortsetzbaren Stream (`/api/agents/chat/stream`,
`Content-Encoding: identity`, `X-Accel-Buffering: no`, `res.flush()` je Ereignis) durch — **gepuffert wird dort
nicht** (Messung: 48 von 48 Stücken kommen einzeln im Browser an). Die gefühlte Langsamkeit kommt **vor** dem
ersten Token: CLI-Start, alle MCP-Server der Nutzer-Konfiguration, ein sehr langer System-Prompt (im ersten echten
Zug 77 314 Tokens, davon **Werkzeuge 66 805** — `ENABLE_TOOL_SEARCH=auto` hat nichts zurückgestellt, deferred 0) und
nicht gestreamtes Denken. Bis dahin war die Antwortblase leer. Der Zug selbst dauerte 21 s.

**Geändert:** sofortige Arbeitsanzeige (vor Kontext-Paket und CLI-Start), 💭 bei Denkblöcken, ⏳ bei langen
Werkzeugschritten, `ENABLE_TOOL_SEARCH=true` (MCP-Schemas erst bei Bedarf; `BRIDGE_TOOL_SEARCH=auto` stellt zurück),
Zeiten je Zug im Log der Brücke (`turn end … ms: {arbeitet, kontext, init, ersteNachricht, denkt, ersterText, ende}`).

**Gemessen** (`scripts/werkbank.sh stream-timing`, Mock-Zug mit ~2 s bis zum ersten Token, ein Werkzeug, 40 Wörter;
ms ab Absenden; lokal, ohne Coder-Proxy):

| | erstes Sichtbares | „denkt nach“ | erster Text | Werkzeugzeile | letztes Wort | Zwischenstände |
|---|---:|---:|---:|---:|---:|---:|
| Brücke direkt, vorher | 2 116 | — | 2 116 | 2 427 | 6 003 | 48 |
| Brücke direkt, jetzt | **54** | 670 | 2 137 | 2 443 | 6 024 | 50 |
| Browser durch LibreChat, vorher | 3 071 | — | 3 071 | 3 416 | 6 955 | 48 |
| Browser durch LibreChat, jetzt | **936** | 1 381 | 2 837 | 3 154 | 6 719 | 49 |

LibreChat selbst kostet ~0,9 s bis zum ersten Stück (Anlegen des Jobs, Schlüssel, Aufbau). **Nicht gemessen:** der
Coder-Proxy (`*.ws.konekto.energy`, braucht Coder-Anmeldung) und ein echter Claude-Zug — die neuen Zeiten im Log
zeigen das beim nächsten echten Chat.

## Such-Werkzeug `vault-search`

Kleiner MCP-Server (stdio, nur lesend, ohne Abhängigkeiten): `web/mcp/vault-search.ts`. Sucht im
Meilisearch-Index der Werkbank (Tippfehler-tolerant) und fällt ohne Meilisearch/Schlüssel auf eine Suche im
Dateisystem zurück (ebenfalls mit Tippfehler-Toleranz). Der Index bleibt frisch: Web-App beobachtet `/vault`
(20 s gebündelt) + alle 10 Minuten + bei `werkbank.sh up|update`.

| Werkzeug | Was |
|---|---|
| `search` | Volltext; Filter `folder`, `team`, `topic` (Domäne unter `2-Areas` oder Roadmap-Thema), `state` (Roadmap-Zustand oder `status`), `type`, `status`, `tags`, `fields` (Frontmatter), `modified_since`; liefert Treffer mit kurzem Ausschnitt, nicht ganze Dateien |
| `outline` | Frontmatter + Gliederung (Überschriften mit Länge) — die billige Mittelstufe |
| `read_note` | Frontmatter geparst, Wikilinks aufgelöst, Inhalt; `section` = nur ein Abschnitt, `max_chars` (Vorgabe 12 000) |
| `backlinks`, `links`, `list_folder`, `recent` | Verlinkung, Ordner, zuletzt geändert |

### Such-Werkzeug auch in Claude Code nutzen

Nicht eingerichtet — wer es im eigenen Claude Code (Terminal) will, führt einmal aus:

```bash
claude mcp add --scope user vault-search -- node /home/knut/work/werkbank-dev/web/mcp/vault-search.ts
```

Der Server liest den Meilisearch-Schlüssel selbst aus `.env.local` des Werkbank-Repos (er landet also nicht in
`~/.claude.json`); ohne ihn sucht er im Dateisystem. Entfernen: `claude mcp remove --scope user vault-search`.

## Kontext-Paket und Token-Sparsamkeit

Jede **neue** Werkbank-Sitzung bekommt am Ende des System-Prompts ein kurzes Paket (Stufe „Index“ der
schrittweisen Offenlegung — Details holt Claude selbst über `vault-search`/Jira):

- deine PM-Tickets (Zahlen + die nächsten 3 Fälligkeiten), Sprint-Ziel und deine S-Zeilen (sonst die ersten 3),
- Roadmap-Hub (Stand + „In Arbeit / Als nächstes“), offene Fragen (Anzahl + Top 3), PR-Register (Überschriften),
  Daily Debrief von heute (Überschrift + Pfad),
- **Vault-Karte:** die wichtigsten Notizen als `[[Basename]]`, gerankt nach Verlinkung (Backlinks) und Nähe zu
  deinem Sprint und dem Roadmap-Hub, gefüllt bis ~260 Tokens,
- nur zu Tagesbeginn/Tagesabschluss: höchstens 3 Pflegefragen (am Ende, damit der Rest des Präfixes stabil bleibt).

Regeln: **Obergrenze 1 500 Tokens** (geschätzt), jenseits der Top 3 nur Zahlen, **keine Kundendaten** (nur
Überschriften, Zahlen, Pfade); **neu erzeugt nur, wenn sich Eingaben ändern** (Hash über mtime/Größe der Quellen
+ Jira-Stand; innerhalb des Tages bytegleich → Prompt-Cache greift); fortgesetzte Sitzungen bekommen es nicht noch einmal.

**Gemessen** (Seite Einrichtung → „Kontext für Claude“; je Sitzung ohne Inhalt in `werkbank.context_log`):

| Fester Teil je Sitzung | vorher | jetzt |
|---|---|---|
| Skill-Liste (nur `~/.claude/skills`, geschätzt) | ~7 600 Tokens (49 Skills; mit Plugins waren es 222 Skills, also deutlich mehr) | ~2 200 Tokens (13 Kern-Skills) |
| Kontext-Paket (Knut, echte Daten) | — | ~700 Tokens |
| eigene MCP-Werkzeuge (vault-search + werkbank) | — | ~970 Tokens, per Tool Search (`ENABLE_TOOL_SEARCH=auto`) erst bei Bedarf |

Nach dem ersten Zug jeder neuen Sitzung fragt die Brücke Claude Codes eigene Aufteilung ab
(`getContextUsage`, Stufe „summary“, ohne Extra-Aufruf) und legt sie daneben: gesamt, Werkzeuge, Skills,
zurückgestellte Werkzeuge. Das passiert erst mit echtem Claude — hier im Pilot noch nicht gelaufen.

### Kontext-Paket auch in Claude Code (Terminal) nutzen

Nicht eingerichtet — wer es will, ergänzt in `~/.claude/settings.json` einen SessionStart-Hook:

```json
{ "hooks": { "SessionStart": [ { "hooks": [ { "type": "command",
  "command": "node /home/knut/work/werkbank-dev/web/server/context-cli.ts knut.peters@maxenergy.at" } ] } ] } }
```

Der Befehl druckt nur das Paket (lesend, gleicher Zwischenspeicher-Hash, keine Pflegefragen).



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
- „Agent ansetzen“ signiert für genau eine Anfrage einen LibreChat-Zugangstoken der angemeldeten Person
  (`JWT_SECRET`, 5 Minuten, wie LibreChats eigener) — nie gespeichert oder geloggt.
- Der MCP-Aufruf der Brücke ist nur mit dem internen Token erreichbar und lässt genau das bestätigte Werkzeug mit
  genau den bestätigten Argumenten durch; Schreiben in Dateien/Bash/Teilagenten ist in dieser Sitzung abgeschaltet.

## Konfiguration im Repo

| Datei | Inhalt |
|---|---|
| `scripts/werkbank.sh` | der eine Einstieg (up/down/restart/status/update/doctor/skills/test/e2e/bridge-mock) |
| `scripts/setup.sh`, `start.sh`, `stop.sh`, `status.sh`, `env.sh` | Einzelschritte, idempotent |
| `librechat/librechat.yaml` | Endpunkt „Claude Code“, Modell-Specs und Vorlagen, Teilen, Oberfläche, Registrierung |
| `librechat/.env` | LibreChat-Umgebung **ohne** Geheimnisse (Ports, Login-Schalter, Teilen) |
| `.env.local` | Geheimnisse + verwalteter URL-Block — erzeugt, gitignored, 600 |
| `claude-bridge/src/` | Brücke: `server.ts` (HTTP, Anhänge, Vorgaben, Nur-lesen-Modus), `sessions.ts`, `tools.ts`, `attachments.ts`, `mcpcall.ts` (ein bestätigter MCP-Aufruf, MCP-Status), `mock.ts` |
| `web/server/` | Web-App-Server (TypeScript, läuft ohne Build): `main.ts` (Routen), `auth.ts`, `creds.ts`, `crypto.ts`, `vault.ts`, `search.ts`, `jira.ts`, `jirawrite.ts` (Schreiben über MCP), `agent.ts` (auch Agent-Chat), `links.ts` (Vault ↔ Tickets), `roadmap.ts`, `sprint.ts`, `syncplan.ts`, `skills.ts`, `sharing.ts` |
| `web/src/` | Oberfläche (Vite + React), Optik wie LibreChat (Inter, hell/dunkel) |
| `templates/sprint/` | Vorlagen für neue Sprint-Zyklen (Summary, Review, Planning mit S1–S4) |

## Tests

```bash
scripts/werkbank.sh test   # Brücke (19) + Web-App (63), ohne echte Konten, ohne /vault zu ändern
scripts/werkbank.sh e2e    # Playwright, 22 Schritte, ca. 2 Minuten
scripts/werkbank.sh stream-timing   # Zeitmessung Streaming (Mock), Ergebnis auch in .runtime/e2e/stream-timing.json
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
- **Brücke** (`claude-bridge/test`): zusätzlich Anhänge, Nur-lesen-Modus, Vorlagen-Vorgabe, Kontext-Paket nur
  für neue Sitzungen, Skills-Auswahl und Zuschaltung, Einordnung der neuen Werkzeuge, Sitzungsstatus.
- **Hygiene + Kontext** (`assist.test.ts`): alle Regeln auf Fixtures, Identität über den Namen, Tagesbeginn/
  Tagesabschluss/„später“/höchstens 3, Wiener Datum, Antwort → Aktion, Paket-Inhalt und Obergrenze, Cache-Schlüssel,
  Vault-Karte unter Budget.
- **MCP** (`mcp.test.ts`): Protokoll, Suche mit Tippfehler und allen Filtern, outline/section, read_note, Links, Ordner.
- **API** zusätzlich: eine Anmeldung über LibreChats Cookie (gültig/gefälscht/nicht freigeschaltet), interne
  Schnittstelle nur mit Token, Pflegefragen nur zu Tagesbeginn, Messung, Hygiene-Antwort, Board-Filter,
  `jira_update` nur auf bestehende Tickets, Nachfrage an den Board-Agenten, forge-Platzhalter.
- **Neu (29.09.):** Streaming (Arbeitsanzeige < 1 s, Denken, Wörter einzeln), MCP-Aufruf nur mit genau den
  bestätigten Argumenten und 401 → `mcp_auth`, MCP-Status, Board-Schreiben über den (Mock-)MCP, Agent als Chat
  (läuft → wartet auf ja → fertig, Titel, geschriebene Dateien), offene Rückfrage übersteht einen zweiten Chat,
  Sub-tasks unter der Karte und kaputte Sub-tasks (`jira.test.ts`), Verknüpfungsindex/Vorschläge/`jira:`-Frontmatter
  (`links.test.ts`), Roadmap-Parser (`roadmap.test.ts`) und -API, Skill-Nutzung, Pflegefragen nur mit MCP.
  Der Mock der Brücke spielt den Atlassian-MCP gegen den Jira-Nachbau nach (`BRIDGE_MOCK_JIRA_BASE`).
- **Playwright** (`web/e2e/smoke.mjs`): alle Seiten mit zwei Testkonten, dazu echt durch LibreChat:
  **Agent-Chat vom Board** („PM-321 · …“ angelegt, ohne offenen Tab bis „wartet auf ja“, im Chat „ja“, Karte fertig),
  Sub-tasks auf-/zuklappen, kaputter Sub-task, Dokumente + Vorschlag verknüpfen, Roadmap (alle fünf Reiter, Rang-
  Vorschlag und Antwort in den Test-Vault), Jira-MCP prüfen, Anhang erreicht die Sitzung, Vorlage gibt ihre Vorgabe weiter, Chat teilen nur mit dem Teammate
  (anonym 401), Kopie weiterführen, Freigaben zurücknehmen, Kontext-Paket erreicht die Sitzung, **alle sieben
  Werkbank-Seiten in LibreChats Leiste** (eine Anmeldung, Adresszeile übersteht Neuladen, Dunkel folgt dem Chat).
  Dafür gibt `e2e` die Testkonten für die Dauer auch auf 3070 frei (`werkbank.sh restart-web`) und setzt es
  danach zurück. Bilder unter `.runtime/e2e/web/`.

**Was dabei ersetzt ist:** Jira (lokaler Nachbau), Claude (Brücke im Mock-Modus — `e2e` schaltet sie für
die Dauer um und danach zurück), der Vault (Kopie von `web/test/fixtures/vault`). Die Testkonten und alles,
was an ihnen hängt, werden danach gelöscht.

## Stand (29.09.2026, Runde 3)

**Erledigt und geprüft** (Tests + Playwright, mit Mock-Claude, Jira-Nachbau und Fixture-Vault)
- Streaming: Arbeitsanzeige nach 54 ms (Brücke) bzw. 936 ms (Browser), vorher 2,1 s bzw. 3,1 s bis zum ersten Zeichen.
- Jira-Schreiben über den Atlassian-MCP (Board, Sprint-Sync, Pflegefragen, `jira_update`), 401 → klare Meldung,
  MCP-Schritt in der Einrichtung, Pflegefragen nur mit verbundenem MCP.
- „Agent ansetzen“ als echter LibreChat-Chat „PM-123 · Titel“ — durch das echte LibreChat (v0.8.7) im e2e: Chat entsteht
  und läuft bis zur Rückfrage ohne offenen Tab, „ja“ im Chat, Karte fertig mit geschriebener Datei.
- Sub-tasks unter der Karte, kaputte Sub-tasks markiert; Dokumente an Tickets, Verknüpfungsindex, Vorschläge;
  Roadmap-Sektion mit fünf Reitern; Nutzung je Skill.
- Nur lesend gegen echte Daten geprüft: Verknüpfungsindex (872 Notizen, 201 Keys, 115 Notizen mit Key, Aufbau ~1 s),
  Vorschläge (67 Tickets), Roadmap-Parser (95 Rangzeilen, 69 Begründungen, 333 Knut-Zeilen davon 330 offen,
  43 PR-Registerzeilen), `roadmap_check.py` (12 Fehler, 58 Hinweise).

**Nicht echt geprüft**
- **Echter Claude-Zug** mit Knuts Token: die Streaming-Verbesserung vor dem ersten Token, `ENABLE_TOOL_SEARCH=true`
  (ob die MCP-Schemas wirklich zurückgestellt werden) und die Zeitwerte im Log.
- **Echter Atlassian-MCP (OAuth)**: dass `/internal/mcp-call` mit Knuts MCP-Anmeldung wirklich kommentiert/umstellt,
  wie der echte MCP bei abgelaufener Anmeldung antwortet (erkannt werden `401`, „unauthorized“, „needs-auth“,
  „authenticate“ und der Init-Status ≠ `connected`), und dass Claude den Aufruf ohne Umweg ausführt.
- Der Coder-Proxy vor LibreChat (Streaming dort, gzip) — ohne Coder-Anmeldung nicht messbar.
- Der Teilen-Dialog von LibreChat wurde per API bedient, nicht durchgeklickt.

## Einmalige Schritte für Knut

1. **Atlassian-MCP anmelden** (falls noch nicht, oder wenn die Einrichtung „nicht verbunden“ zeigt): im Terminal
   `claude` → `/mcp` → **atlassian** → **Authenticate** → im Browser mit dem Atlassian-Konto anmelden. Fehlt der
   Eintrag: `claude mcp add --transport http --scope user atlassian https://mcp.atlassian.com/v1/mcp`. Danach in der
   Werkbank **Einrichtung → „Jira-MCP prüfen“**.
2. **Einen echten Chat** schicken (irgendeine Frage) und prüfen, ob „⏳ Claude arbeitet …“ sofort kommt; die Zeiten
   stehen danach in `.runtime/logs/claude-bridge.log` (`turn end`, Feld `ms`). Unter Einrichtung → „Kontext für Claude“
   zeigt „gemessen“, ob Werkzeuge jetzt zurückgestellt sind („zurückgestellt …“).
3. **Board → eine Karte → „Agent im Chat starten“** einmal mit echtem Claude; im Chat die erste Rückfrage mit „ja“
   oder „nein“ beantworten.
4. Optional: `vault-search` und Kontext-Paket im eigenen Terminal (siehe oben) — nicht eingerichtet, weil das die
   Nutzer-Konfiguration ändern würde.

## Bekannte Grenzen

- Direkt auf 3070 braucht die Web-App ein eigenes Login; in LibreChats Leiste nicht.
- Jira-Schreiben kostet je Aktion einen kleinen Claude-Zug (Sekunden) und hängt an der MCP-Anmeldung; im Pilot ist
  das Knuts Atlassian-Anmeldung für alle freigeschalteten Konten.
- Die Roadmap-Rangliste rechnet die Werkbank nicht neu; Verschiebungen sind Vorschläge.
- Status „fertig“ eines Agent-Chats heißt: kein Zug läuft und keine Rückfrage offen — die Unterhaltung lässt sich
  weiterführen. Nach einem Neustart der Brücke fehlt die Liste der geschriebenen Dateien früherer Züge.
- Die Jira-Kopie ist für alle Werkbank-Konten gleich (gelesen mit dem Zugang des Pilot-Kontos bzw. der klickenden Person).
- **Bearbeiten/Neu generieren** älterer Nachrichten verzweigt in LibreChat, die Claude-Sitzung läuft linear weiter.
- Bei einem Neustart der Brücke gehen offene Rückfragen verloren; die Sitzung lässt sich fortsetzen.
- Bash-Befehle brauchen im Chat immer ein „ja“, auch rein lesende.
- Die Pilot-Sitzungen haben Knuts Rechte auf der VM (Dateien, Hooks, Gedächtnis, Jira).
- Hochgeladene Dateien: kein Virenscan (siehe oben).

## Forschung: was aus anderen Repos übernommen wurde

| Idee | Quelle | Stand |
|---|---|---|
| Rang-Karte unter festem Budget (PageRank-artig, Bezug zur Unterhaltung) | aider (repo map) | **gebaut** — Vault-Karte im Kontext-Paket: Backlinks + Nähe zu Sprint/Roadmap, ~260 Tokens |
| Schrittweise Offenlegung: Index → Zusammenfassung → Volltext | claude-mem, centminmod/my-claude-code-setup | **gebaut** — Paket = Index, `outline` = Mitte, `read_note`/`section` = Volltext |
| Skills je Vorlage statt aller | pmcp-Gateway-Befund, Claude Code | **gebaut** — Kern + Vorlage + Nennung; alle anderen findet Claude über das Werkzeug `skills_list` (Name + eine Zeile) |
| MCP-Werkzeuge erst bei Bedarf (Tool Search, zurückgestellte Schemas) | Claude Code Tool Search, pmcp | **gebaut, ungeprüft** — `ENABLE_TOOL_SEARCH=auto`; Wirkung zeigt erst die echte Messung |
| Ausschnitte statt ganzer Dateien | zilliztech/claude-context, basic-memory, Smart Connections | **gebaut** — `search` mit Ausschnitt, `read_note` mit `section`/`max_chars` |
| Hybride Suche mit Embeddings | zilliztech/claude-context, Smart Connections | **zurückgestellt** — bräuchte einen zweiten Anbieter oder ein lokales Modell; Knut: Vault-Inhalte nur zu Claude. Meilisearch (Stichwort + Tippfehler) reicht vorerst |
| Stabiles Präfix für Prompt-Caching | Anthropic Prompt-Caching, claude-mem | **gebaut** — Paket tagesstabil, nur bei geänderten Eingaben neu, Pflegefragen am Ende |
| Token-Messung je Sitzung in der Oberfläche | ooples/token-optimizer-mcp | **gebaut** — Schätzung (Paket, Skills, eigene Werkzeuge) + echte Aufteilung via `getContextUsage` |
| Gedächtnis über Sitzungen (Beobachtungen komprimieren) | claude-mem | **abgelehnt** — Knuts compartment-Gedächtnis gibt es schon (Nutzer-Ebene); ein zweites wäre Doppelung |
| Gateway vor allen MCP-Servern | pmcp | **zurückgestellt** — Tool Search deckt das Wichtigste; ein Gateway wäre zusätzliche Infrastruktur |
| Sitzungsliste und Fortsetzen | CloudCLI (claudecodeui) | **gebaut** — „Deine Claude-Sitzungen“ mit Link zum Fortsetzen |
| Status „läuft / wartet“ je Agent | coder/agentapi | **gebaut** — läuft / wartet auf ja / bereit; auf Karten „🤖 läuft“ |
| Agent auf Karte, Ergebnis an der Karte, Nachfrage in derselben Sitzung | Vibe Kanban, kandev | **gebaut** — Agent ansetzen (nur lesend), Verlauf, Entwurf, Nachfrage setzt fort |
| Eigener Worktree je Karten-Agent | kandev, Vibe Kanban | **abgelehnt** — Board-Agenten ändern keinen Code (nur lesend); Code-Arbeit bleibt im Chat mit Rückfrage |
| PR-Review am Board und im Chat | forge | **angebunden** (29.09.) — MCP `forge-review` aus `~/work/forge` (Zweig `werkbank-hardening`, lokal) über `WERKBANK_FORGE_MCP` in `.env.local`; Einstellungen in `~/.config/forge/review-mcp.env` (nur Pfade). Modellaufrufe mit dem **Claude-Zugang der Person**, GitHub nur lesend, Posten gesperrt, Testausführung aus (keine Sandbox auf der VM). Kosten: #171 (3 Dateien) brauchte im Modus `concerns` ~1,5 Mio. Tokens und blieb `incomplete` — Budget je Review 600k, ein unvollständiges Review wird als solches gemeldet |

## Entscheidungen (Knut, 29.09.2026) und wie sie umgesetzt sind

| # | Frage | Knut | Umsetzung |
|---|---|---|---|
| 1 | Zielstruktur S1–S4 im Skill | **Tabelle ja** (Skill macht die Hauptsitzung) | Vorlagen in `templates/sprint/` bleiben Tabellen; `olaf-sprint-planning` → v1.6 zieht die Hauptsitzung nach |
| 2 | Jira-Schreiben vom Board | **MCP** | umgesetzt: alle Schreibwege über den Atlassian-MCP der Person, Lesen weiter mit dem Lesetoken |
| 3 | Wessen Sicht speist die Jira-Kopie? | **weiter Knuts Token** | unverändert: 15-Minuten-Abgleich mit Knuts Lesetoken |
| 4 | Geteilten Chat weiterführen? | **nur als Kopie** | unverändert: „Als Kopie weiterführen“, nie die fremde Sitzung |
| 5 | Eine Anmeldung für Chat und Werkbank | **so lassen** | unverändert (Pfad-Proxy; 3070 für Health/Debug) |
| 6 | Alten Sprint-Zyklus archivieren? | **nicht automatisch** | unverändert: die Werkbank legt nur an |
| 7 | Abweichende lokale Skill-Kopien | **Hauptsitzung** | nicht angefasst; `olaf-jira-sync`/`olaf-service-cases` vergleicht die Hauptsitzung gegen den Vault |
| 8 | Virenscan für Uploads | **Pilot ohne, Team ClamAV** | Pilot ohne (Typ-Liste, nie ausführen); Team-Workspace: ClamAV vor dem Speichern — noch zu bauen |
| 9 | Aufbewahrung geteilter Dateien | **unbegrenzt** | unverändert: bis zum Löschen |
| 10 | Skill-Kern | **nach 1 Woche, Nutzung je Skill zählen** | umgesetzt: Brücke zählt Skill-Aufrufe, Skills-Seite zeigt Nutzung; Kern am/ab 06.10. mit diesen Zahlen nachschärfen |
| 11 | Uhrzeit Tagesabschluss | **16 Uhr** | unverändert (`WERKBANK_EOD_HOUR=16`) |
| 12 | Pflegefragen ohne Schreibzugang? | **nur mit verbundenem Jira-MCP, sonst Badges + einmaliger Hinweis** | umgesetzt |

## Offene Entscheidungen (Runde 3)

1. **Rang-Vorschläge zurück in `rank.py`.** Die Werkbank hält Verschiebungen nur als Zeile fest; die Werte liegen im
   Skript des Skills. *Empfehlung:* die Hauptsitzung übernimmt Vorschläge bei der nächsten Priorisierungsrunde und
   löscht die Zeilen danach.
   - Knut:
2. **Vorschläge zum Verknüpfen.** Die Trefferliste ist brauchbar, aber rauscht (z. B. allgemeine Wörter).
   *Empfehlung:* so lassen (nur Vorschlag, „passt nicht“ lernt mit) und nach einer Woche ansehen.
   - Knut:
3. **Antworten auf Knut-Zeilen durch andere.** Die Roadmap-Seite schreibt immer `- Knut:`. *Empfehlung:* nur Knut
   darf dort antworten, alle anderen bekommen eine eigene Zeile `- <Name>:` darunter.
   - Knut:
