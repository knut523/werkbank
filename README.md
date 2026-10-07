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
   │       Claude Agent SDK ── eigene Claude-Konfiguration je Person (.runtime/claude/<id>: Skills ← /vault/_meta/dist-skill,
   │                           CLAUDE.md, Atlassian-OAuth), nur Werkbank-MCP (vault-search, werkbank, forge-review, atlassian)
   │
   └──► Werkbank-Web :3070 ── Einrichtung · Wissen · Board · Sprint · Roadmap · Skills · Dateien & Teilen
                │  Login = LibreChat-Konto · Vault nur lesend (Schreiben nur nach Bestätigung)
                ├── MongoDB (eigene DB „werkbank“: Jira-Kopie, Sitzungen, verschlüsselte Zugänge, Dateien)
                ├── Meilisearch (Index „werkbank_vault“: Volltextsuche im Vault)
                ├── Jira REST — nur Lesen (Kopie von PM, Übergänge) mit dem Lesetoken
                ├── claude-bridge /internal/mcp-call — Jira-Schreiben über den Atlassian-MCP der Person (nach Bestätigung)
                ├── /api/events (SSE) — jede Jira-Änderung (Board, Sprint, Chat, Abgleich) sofort an offene Board-/Sprint-Seiten
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
| `scripts/werkbank.sh skills --people` | dasselbe in jeder Claude-Konfiguration je Person (`.runtime/claude/<id>`) |
| `scripts/werkbank.sh test` | Tests der Brücke und der Web-App |
| `scripts/werkbank.sh e2e` | Playwright-Durchlauf durch alle Seiten (siehe „Tests“) |
| `scripts/werkbank.sh stream-timing` | Zeitmessung Streaming: Brücke direkt und im Browser durch LibreChat (Mock) |
| `scripts/werkbank.sh init-timing [N]` | Start einer **echten** Claude-Code-Sitzung bis „init“ — vorher / geteilt / je Person, ohne Modellaufruf (ungültiger Token) |
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
   Claude-Code-Sitzung der Person**, siehe „Jira schreiben über den MCP“. Die Seite zeigt, welche Claude-Konfiguration
   gilt (eigene / geteilt), hat den Knopf **„Im Chat bei Jira anmelden“** (einmalig, ohne Terminal, siehe „Claude-Konfiguration
   je Person“) und den Terminal-Befehl mit dem eigenen Verzeichnis. **„Jira-MCP prüfen“** liest nur den Verbindungsstatus
   (Init der Sitzung, kein Modellaufruf).
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
  (Vault, Dateien, Jira, GitHub) hält im Chat an und wartet auf **„ja“**; Merge ist gesperrt. An der Karte:
  Status **läuft / wartet auf ja / fertig** (aus der Brücke), „Im Chat öffnen“, welche Dateien der Agent
  geschrieben hat; am Board-Kärtchen „🤖 wartet auf ja“. Ein Agent je Karte und Person; eine offene Rückfrage
  bleibt stehen, auch wenn die Person inzwischen woanders chattet (höchstens 5 wartende je Person).
- **📝 Nur Entwurf** bleibt als Option: lesend im Hintergrund, Ergebnis als bearbeitbarer Kommentarentwurf,
  der erst nach „An Jira senden“ + Bestätigung gepostet wird.
- **Keine neuen Tickets** aus der Werkbank (olaf-jira: nur auf ausdrücklichen Auftrag, mit Duplikatsuche
  und Workstream) — dafür die Chat-Vorlage „Jira-Ticket anlegen“.
- **Live (Runde 4):** Jede bestätigte Jira-Änderung erscheint sofort — ohne Neuladen, auch in anderen Tabs und bei
  anderen Personen, siehe „Board live“.

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
- **Wessen Anmeldung?** Die der **Claude-Konfiguration der klickenden Person** (Runde 4): je Person
  `.runtime/claude/<id>/.credentials.json`, im Pilot für Knut weiter `~/.claude` (siehe „Claude-Konfiguration je Person“).
  Die MCP-Kurzsitzung lädt nur den Atlassian-MCP (strict, ohne Hooks) und startet damit in ~1 s statt ~6 s.
- Nach jedem bestätigten Schreiben holt die Werkbank das Ticket sofort neu in die Kopie (mit dem eigenen Lesezugang,
  sonst dem der Kopie) und schiebt die Änderung an offene Seiten.

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
  Rückfragen verfallen nach 30 Minuten. **Ausnahme Auto-Modus** (freigeschaltete Konten): Bash/Edits im eigenen
  Arbeitsordner entscheidet ein Klassifikator, siehe „Auto-Modus“.
- **GitHub (Knut, 06.10.2026):** Lesen frei (`gh api` ohne Schreib-Optionen, `gh pr view|diff|list`). **Schreiben nur
  nach „ja“**, auch im Auto-Modus: `git push`, `gh pr create|comment|review|edit…`, `gh issue …`, schreibende
  GitHub-API-Aufrufe (`-X POST|PATCH|PUT|DELETE`, `-f/-F`, GraphQL-Mutationen). **Gesperrt, auch mit „ja“:** Merge
  (`git merge`, `gh pr merge`, `…/merge(s)` über die API, GitHub-MCP-Merge), Force-Push und Push auf `main`/`master`/`develop`
  (Hook `PreToolUse` + `canUseTool`).
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
  **Ausnahme Board-Agenten (E5, Knut 07.10.2026):** nur lesende Läufe vom Board (`x-werkbank-mode: readonly` **und**
  SDK-Modus `dontAsk`, also mit `BRIDGE_PERMISSION_MODE=auto`) zählen nicht gegen diese Sperre — „Agent auf Karte“ läuft,
  während man weiterchattet, und umgekehrt. Dafür gilt eine eigene Obergrenze von **2 Board-Läufen je Person**
  (`BRIDGE_MAX_BOARD_RUNS`). Ein normaler Chat bleibt einer zur Zeit. Im Not-Aus (`default`) bleibt alles wie vorher.
- **Titel** erzeugt die Brücke aus der ersten Nachricht, ohne Claude aufzurufen.
- **Kontext-Paket** für jede **neue** Sitzung (nicht bei Fortsetzung), siehe unten.
- **MCP-Server: genau diese, sonst keine** (Runde 4, `strictMcpConfig`): `vault-search` (Vault durchsuchen, lesend),
  `werkbank` (`hygiene_list`, `hygiene_snooze`, `skills_list`, `jira_update` mit Rückfrage), `forge-review` (falls
  eingerichtet) und `atlassian` (Jira/Confluence, OAuth je Claude-Konfiguration). Nichts aus Nutzer-/Projekt-Konfiguration
  oder Plugins (vorher u. a. `compartment`, PostHog-Plugin).
- **Jira im Chat geändert → Board zieht nach:** sieht die Brücke einen erfolgreichen schreibenden `mcp__atlassian__*`-Aufruf
  mit Ticket-Schlüssel, meldet sie ihn der Web-App (siehe „Board live“).
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
| Browser durch LibreChat, jetzt | **936** (2. Lauf 1 346) | 1 381 | 2 837 | 3 154 | 6 719 | 49 |

LibreChat selbst kostet ~0,9–1,3 s bis zum ersten Stück (Anlegen des Jobs, Schlüssel, Aufbau). **Nicht gemessen:** der
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



## Schneller Start: Ursache und Messung (Runde 4)

**Knuts Messung (29.09., echter Claude, `turn end` im Log der Brücke):** `init` 6–8 s je neuer Sitzung, erster Text nach
~10 s bzw. 26 s mit Denken, Prompt ~33k Tokens. Vermutete Ursache: jede Sitzung lädt alle MCP-Server und Plugins der
Nutzer-Konfiguration.

**Befund (gemessen, nicht geschätzt):** Die MCP-Server allein sind es kaum. Den größten Teil kostet **Knuts
SessionStart-Hook** (`~/.claude/hooks/memory-recall.sh`: Vaultwarden + zwei Aufrufe an knut-agent-memory, ~4,5 s),
den Rest CLI-Start, Plugins und 231 Skills. Nur `strictMcpConfig` (Hooks weiter an) brachte 5,7–6,3 s, also nichts.

**Geändert:**
- Werkbank-Sitzungen bekommen **genau** ihre MCP-Server (`vault-search`, `werkbank`, `forge-review` falls eingerichtet,
  `atlassian`) mit `strictMcpConfig` — nichts aus Nutzer-/Projekt-Konfiguration oder Plugins.
- **Je Person eine eigene Claude-Konfiguration** (unten): keine fremden Hooks, Plugins oder Skills — nur die Vault-Skills.
- Wer (Pilot: Knut) auf der echten Konfiguration bleibt, bekommt in Werkbank-Sitzungen **Knuts Hooks nicht**
  (`disableAllHooks` über die SDK-Einstellungen; die Wächter-Hooks der Brücke laufen weiter — geprüft).
  `BRIDGE_SHARED_USER_HOOKS=on` schaltet sie wieder ein. Offene Entscheidung R4-1.
- Kern-Skills und CLAUDE.md bleiben: Skill-Auswahl wie bisher (13 Kern + Vorlage + Nennung), CLAUDE.md aus der
  jeweiligen Konfiguration (je Person: `templates/claude/CLAUDE.md`), dazu `/vault/CLAUDE.md`.

**Gemessen** mit `scripts/werkbank.sh init-timing 3` — echte CLI des Agent SDK, ungültiger Token, gemessen bis zur
Init-Nachricht (also genau der Anteil `init`), Median aus 3 Läufen, auf dieser VM:

| Variante | init (Median) | Läufe | MCP-Server | Plugins | Skills |
|---|---:|---|---|---:|---:|
| **vorher** (Nutzer-Konfiguration komplett) | **5 422 ms** | 5 431 · 5 422 · 5 384 | posthog (needs-auth), atlassian, compartment | 3 | 231 |
| **geteilt** (Knut: echte Konfiguration, strict, ohne Hooks) | **1 625 ms** | 1 625 · 3 211 · 1 345 | atlassian (verbunden) | 3 | 231 |
| **je Person** (eigenes Verzeichnis) | **1 266 ms** | 1 266 · 1 723 · 903 | atlassian (needs-auth: frisch, nicht angemeldet) | 2 | 59 |

Zum Vergleich einzeln gemessen: nur strict, Hooks an 5,7–6,3 s; strict ohne Hooks 1,3–1,4 s.

**Mit dem Mock** (`stream-timing`, misst die Brücke, nicht die CLI): „arbeitet“ nach 57–75 ms (vorher 54), erster Text
nach 2,5 s (vorher 2,1 s) — der Unterschied ist der einmalige Skills-Abgleich beim **ersten** Zug einer neuen Person
(~0,35 s, die Zeitmessung legt jedes Mal ein neues Konto an); danach läuft der Abgleich im Hintergrund.

**Nicht gemessen:** `ersterText` mit echtem Claude nach der Änderung — dafür braucht es einen echten Zug. Die Zeiten stehen
danach wie gehabt in `.runtime/logs/claude-bridge.log` (`turn end … ms`, jetzt mit `konfig` und `mcp` in `turn start`).
Erwartung: `init` ~1,5 s statt 6–8 s; der Prompt wird kleiner (keine compartment-/PostHog-Werkzeuge, keine Hook-Ausgabe
mit Gedächtnis und Team-Skills).

## Claude-Konfiguration je Person (Runde 4)

**Was „je Person“ jetzt heißt:** Jedes Werkbank-Konto bekommt ein eigenes `CLAUDE_CONFIG_DIR` unter
`.runtime/claude/<LibreChat-Nutzer-ID>/` (Rechte 0700), angelegt beim ersten Chat bzw. der ersten Jira-Aktion:

| Inhalt | Woher |
|---|---|
| `skills/` | Links auf `/vault/_meta/dist-skill/*` — derselbe Abgleich wie `werkbank.sh skills --apply` mit `CLAUDE_CONFIG_DIR`, beim ersten Mal sofort, danach alle 10 Minuten im Hintergrund (neue Vault-Skills kommen von selbst) |
| `CLAUDE.md` | Link auf `templates/claude/CLAUDE.md` (Arbeitsweise im Team; im Repo ändern) |
| `.credentials.json` | **eigene** MCP-Anmeldungen (Atlassian-OAuth) — entsteht bei der Anmeldung (unten) |
| `projects/`, `.claude.json` | Verlauf und Zustand der eigenen Claude-Code-Sitzungen |

Damit läuft niemand mehr auf Knuts Hooks, Gedächtnis, Plugins oder MCP-Anmeldungen. Der Claude-Zugang selbst kommt wie
bisher aus dem eigenen Token (`claude setup-token`, LibreChat-Schlüsselspeicher). Die Sitzungen laufen weiter als
Unix-Nutzer der VM (Dateirechte, `/vault`); das ändert erst ein eigener Unix-Nutzer je Person.

- **Pilot-Schalter:** `BRIDGE_CLAUDE_CONFIG_SHARED` (E-Mails, Komma-getrennt) — diese Konten laufen mit der
  Konfiguration des VM-Nutzers (`~/.claude`). **Vorgabe im Code: leer = alle je Person.** `scripts/start.sh` setzt im
  Pilot `knut.peters@maxenergy.at`, damit Knuts vorhandene Atlassian-Anmeldung weiter gilt. `BRIDGE_CLAUDE_CONFIG_SHARED=`
  (leer) schaltet auch Knut auf „je Person“ (dann einmal anmelden, unten). `BRIDGE_CLAUDE_CONFIG=shared` = alle geteilt (alter Stand).
- **Atlassian ohne Nutzer-Registrierung:** Claude Code legt die OAuth-Anmeldung unter
  `atlassian|sha256({type,url,headers})[:16]` ab. Die Werkbank übergibt den Server mit genau Name, Typ und URL der
  üblichen Registrierung (`claude mcp add --transport http --scope user atlassian https://mcp.atlassian.com/v1/mcp`) —
  gemessen: in der geteilten Konfiguration ist `atlassian` damit **verbunden**, ohne dass die Werkbank die
  Nutzer-Registrierung braucht. Eine Registrierung auf Nutzer-Ebene ist also nicht nötig.
- **Fortsetzen** einer Unterhaltung nur in derselben Konfiguration (dort liegt ihr Verlauf); wechselt sie (Schalter
  umgestellt), beginnt eine neue Sitzung mit dem Verlauf aus LibreChat.
- `forge-review` bekommt das `CLAUDE_CONFIG_DIR` der Person mit.

### Einmalig je Person

1. **Eigenen Claude-Token** erzeugen: `claude setup-token` (auf dem eigenen Rechner oder im Terminal der Workspace) →
   in der Werkbank unter **Einrichtung → Claude verbinden** einfügen.
2. **Atlassian-MCP anmelden** — geht **ohne Terminal, headless im Chat:** Einrichtung → **„Im Chat bei Jira anmelden“**.
   Die Sitzung hat den Atlassian-MCP im Zustand `needs-auth`; Claude Code bietet dann die Werkzeuge
   `mcp__atlassian__authenticate` / `mcp__atlassian__complete_authentication` an (laufen ohne „ja“, sie schreiben nur die
   eigene Anmeldung). Claude gibt einen Link aus → im Browser mit dem eigenen Atlassian-Konto anmelden → der Browser landet
   auf `http://localhost:<port>/callback?code=…` und zeigt einen **Verbindungsfehler (das ist so)** → die **komplette
   Adresse** aus der Adresszeile in den Chat kopieren → Claude schließt ab. Der Token liegt danach in
   `.runtime/claude/<id>/.credentials.json`. Dann **„Jira-MCP prüfen“**.
   *Oder im Terminal der Workspace* (der Befehl mit dem richtigen Verzeichnis steht in der Einrichtung):
   `CLAUDE_CONFIG_DIR=.runtime/claude/<id> claude --strict-mcp-config --mcp-config '{"mcpServers":{"atlassian":{"type":"http","url":"https://mcp.atlassian.com/v1/mcp"}}}'`
   → `/mcp` → **atlassian** → **Authenticate** (auch hier: Adresse der Fehlerseite zurückkopieren, wenn der Browser nicht
   auf der VM läuft).

## Auto-Modus (06.10.2026)

Knut, 06.10.2026: „switch it on automatically“ — Plan `docs/plan-auto-modus-und-konten.md` (Quelle: Plan 71 P1).

**Was er tut:** Für freigeschaltete Konten läuft die Sitzung im SDK-Modus `auto`. Bash-Befehle und Datei-Änderungen
(`Write`/`Edit`/`MultiEdit`/`NotebookEdit`) **im eigenen Arbeitsordner** (`.runtime/bridge/scratch/<person>`) entscheidet
ein Klassifikator-Modell statt des „ja“ im Chat. Jede automatische Freigabe steht als Statuszeile im Chat
(**„🤖 automatisch erlaubt: 💻 Befehl: …“**) und im Log (`auto erlaubt`, nur der Werkzeugname). Lehnt der Klassifikator ab:
**„🛑 Auto-Modus hat abgelehnt: …“**, Log `auto abgelehnt`, und `turn end` führt die abgelehnten Werkzeuge
(`denials`, aus `result.permission_denials`, ohne Argumente). Ist er unsicher, eskaliert er: dann kommt die gewohnte
Rückfrage im Chat, eingeleitet mit „Der Auto-Modus fragt nach: <Grund>“.

**Was bleibt wie heute (Knuts Entscheidung E1):**

| | im Auto-Modus |
|---|---|
| Lesen, Suchen, Skills, Teilagenten | frei (wie bisher) |
| Bash/Edit im eigenen Arbeitsordner | **Klassifikator** |
| Edits außerhalb des Arbeitsordners, unter `/vault` oder über einen Symlink dorthin | Rückfrage („ja“) |
| Bash, der den Vault, `.runtime`, `.claude`, `.env`, `~/.ssh`, `~/.config/vw`, `bw`, `sudo` oder Jira/Atlassian nennt | Rückfrage („ja“) |
| Jira-Schreiben (Atlassian-MCP, `jira_update`) | Rückfrage („ja“) |
| GitHub lesen (`gh api` ohne Schreib-Optionen, `gh pr view/diff`) | Klassifikator |
| `git push`, PR anlegen/kommentieren, GitHub-API schreiben | Rückfrage („ja“) — nie automatisch |
| Merge, Force-Push, Push auf `main`/`master`/`develop` | gesperrt, auch mit „ja“ |
| Board-Agent „nur lesen“ | lehnt alles Schreibende ab (Wächter) — zusätzlich SDK-Modus `dontAsk` |

**Schalter (scripts/start.sh):**

- `BRIDGE_PERMISSION_MODE` — Vorgabe in `start.sh`: **`auto`**. **Not-Aus:** `BRIDGE_PERMISSION_MODE=default
  scripts/werkbank.sh restart` → exakt das bisherige Verhalten (Modus `default`, keine zusätzlichen Regeln, auch der
  Board-Agent wie bisher). Im Code ist die Vorgabe `default`: wer die Brücke ohne `start.sh` startet, bekommt nichts Neues.
- `BRIDGE_AUTO_EMAILS` — wer den Auto-Modus bekommt. Vorgabe in `start.sh`: `knut.peters@maxenergy.at` (E2: nur Knut,
  solange es keine Unix-Trennung oder Sandbox gibt, E3). Alle anderen bleiben im Modus `default`.

**Leitplanken im Auto-Modus:**

- Der Wächter (PreToolUse-Hook) gibt für die Klasse `auto` **keine Entscheidung** zurück — nur dann kommt der Klassifikator
  zum Zug. Alle anderen Klassen entscheidet er wie bisher selbst.
- Deny-Regeln als Flag-Settings je Zug (`AUTO_DENY` in `claude-bridge/src/tools.ts`, plus Lesen von `.credentials.json` und
  Schreiben unter `.runtime/claude/`): `git merge`, `gh pr merge`, `bw`, `~/.ssh`, `~/.config/vw`,
  `~/.claude/.credentials.json`, `.env*`, `disableBypassPermissionsMode`. Deny schlägt auch ein „ja“ — deshalb gibt es
  **keine** Deny-Regel für Vault, Jira, `git push` oder `gh api` — die fragen über den Wächter (GitHub-Schreiben) bzw. sind frei
  (GitHub-Lesen, Knut 06.10.2026).
- `templates/claude/settings.json` (wird wie `CLAUDE.md` in jede Konfiguration je Person verlinkt, eine eigene
  `settings.json` bleibt unangetastet): `autoMode.hard_deny` (Jira/Vault nur über die Rückfrage, fremde Konfigurationen,
  Vaultwarden, GitHub schreiben), `soft_deny`, `environment`. Außerhalb des Auto-Modus wirkungslos.
- **Knut läuft mit der geteilten Konfiguration** (`~/.claude`): dort gilt seine eigene `autoMode`-Konfiguration; die
  Vorlage greift nicht. Vorschlag (nicht angewendet): die `hard_deny`- und `environment`-Zeilen aus
  `templates/claude/settings.json` in `~/.claude/settings.json` ergänzen.

**Risiken:**

- **Abo/Modell ohne Auto-Modus:** Kann das Konto oder Modell auf der VM keinen Auto-Modus, meldet die CLI einen Fehler
  oder fragt wieder. **Den ersten echten Zug prüfen:** Log `turn start … "permissionMode":"auto"`, im Chat erscheint bei
  `ls` „🤖 automatisch erlaubt“. Sonst Not-Aus.
- Bash-Umgehungen der Regexe (Skript, das pusht; `curl` mit Token) fängt nur der Klassifikator plus Deny/`hard_deny`.
  Ohne eigenen Unix-Nutzer oder Sandbox läuft Bash mit den Rechten des VM-Nutzers — darum nur Knut.
- Der Klassifikator ist ein zusätzlicher kleiner Modellaufruf je Bash/Edit auf dem Abo der Person.

## Mehrere Claude-Konten je Person (06.10.2026)

Knut, 06.10.2026: mehrere Claude-Konten je Person mit automatischem Wechsel, „wie `cswap auto`“. Plan:
`docs/plan-auto-modus-und-konten.md`.

- **Einrichtung → Eigenes Claude verbinden → „Weitere Claude-Konten“:** Name (z. B. „Firma“, „Privat“) + Token aus
  `claude setup-token` hinzufügen, Reihenfolge mit ↑/↓, **Testen** (ein sehr kleiner Modellaufruf auf genau diesem Konto),
  Entfernen. Der bisherige Schlüssel aus dem Chat-Modellmenü ist das Konto **„Chat-Schlüssel“** und bleibt Pflicht
  (LibreChat schickt ohne ihn keine Anfrage); ohne weitere Konten ändert sich nichts. Höchstens 5 weitere Konten.
- **Wechsel:** Meldet Claude `rate_limit` (Kontingent ausgeschöpft), vermerkt die Brücke das Konto bis zum Reset (aus dem
  `rate_limit_event`, sonst 1 Stunde) und wiederholt **dieselbe Anfrage** mit dem nächsten Konto. Im Chat:
  **„↻ Konto „Privat“ übernimmt (Kontingent von „Firma“ ausgeschöpft)“**. War schon etwas passiert (Text, Werkzeuge),
  setzt das nächste Konto die Sitzung mit „mach genau dort weiter“ fort, statt von vorn zu beginnen. Sind alle erschöpft:
  die bisherige Meldung „Dein Claude-Kontingent ist gerade ausgeschöpft“. Bei `overloaded` wird **nicht** gewechselt
  (Server-Engpass, ein anderes Konto hilft nicht).
- **Gemerkt:** Bis zum Reset beginnt jeder neue Zug auf dem ersten Konto, das noch geht (Zustand ohne Geheimnisse in
  `.runtime/bridge/claude-accounts.json`, übersteht Neustarts; ein ersetzter Token zählt als neues Konto). Die Einrichtung
  zeigt je Konto „aktiv“ / „bereit“ / „ausgeschöpft bis …“.
- **Speicher und Weg der Tokens:** weitere Konten in `werkbank.creds` (`claudeAccounts`, AES-256-GCM mit
  `WERKBANK_CREDS_KEY`, wie der Jira-Token; `claudeOrder`). Der Browser bekommt nur Name und die letzten 4 Zeichen. Die
  Brücke holt die Liste je Zug über den internen Kanal (`POST /internal/claude-accounts`, `WERKBANK_INTERNAL_TOKEN`, nur
  127.0.0.1); antwortet die Werkbank nicht, läuft der Zug wie bisher mit dem einen Schlüssel. Tokens stehen nie im Log
  (die Brücke schwärzt alle Konten-Tokens auch in SDK-Fehlerzeilen).
- **Eine Konfiguration für alle Konten:** alle Konten einer Person teilen `.runtime/claude/<id>` (Skills, `CLAUDE.md`,
  Atlassian-Anmeldung, Sitzungsverläufe — nur so kann das nächste Konto eine Sitzung fortsetzen). Es unterscheidet sich nur
  `CLAUDE_CODE_OAUTH_TOKEN` (auch für `forge-review`).
- Brücke: `claude-bridge/src/accounts.ts` (Auswahl, Zustand, Kontotest), `/internal/account-test`,
  `/internal/accounts-state` (beide nur mit internem Token).

## Board live (Runde 4)

Knut: „auch instant update des board wenn etwas geändert geschrieben wird mit jira“.

- **Quelle der Wahrheit bleibt die Jira-Kopie.** Jedes `refreshIssue` (ein Ticket neu aus Jira) und jeder Abgleich meldet
  die geänderten Schlüssel an einen kleinen Ereignisbus in der Web-App (`web/server/events.ts`).
- **Wann nachgezogen wird:**
  - nach **jedem bestätigten Schreiben über den MCP** — Board (Kommentar, Status, Fälligkeit), Entwurf senden, Sprint-Sync,
    Pflegefragen und `jira_update` aus dem Chat: sofort `refreshIssue` (eigener Lesezugang, sonst der der Kopie);
  - nach **Jira-Schreiben im Chat über den Atlassian-MCP** (Kommentar, Übergang, Bearbeiten, Anlegen, Worklog, Verknüpfung):
    die Brücke merkt sich jeden schreibenden `mcp__atlassian__*`-Aufruf und meldet nach **erfolgreichem** Ergebnis die
    Schlüssel (aus den Argumenten, beim Anlegen aus der Antwort; abgelehnte oder fehlgeschlagene Aufrufe nicht) an
    `/internal/jira-touched`; die Web-App holt genau diese Tickets (nur Projekt PM, höchstens 10) in die Kopie;
  - nach jedem Abgleich (15 Minuten / Knopf) → „alles“.
- **Wie es auf die Seite kommt:** Server-Sent Events `GET /api/events` (nur angemeldet; `Cache-Control: no-transform`,
  `X-Accel-Buffering: no`, Ping alle 20 s). Board lädt still nach (ohne Ladeanzeige) und lässt geänderte Karten kurz
  **aufleuchten**; ein offenes Ticket-Detail und die Sprint-Seite laden ebenso nach. Nach einem Verbindungsabbruch
  verbindet sich die Seite selbst neu und lädt einmal alles. Der Strom trägt nur Schlüssel, keine Inhalte.

## Runde 5 (30.09.2026): Sync, Board, PR-Review live, Roadmap, Ziele & Sprint, Mein Tag

### Jira-Abgleich
- **Vollabgleich** alle 15 min (`WERKBANK_JIRA_SYNC_MIN`), **inkrementell** jede Minute (`WERKBANK_JIRA_INC_MIN`, 0 = aus;
  JQL `project = PM AND updated >= -2m`, löscht nie, rechnet Workstreams nach).
- **Löschschutz:** der Vollabgleich löscht nur, wenn Jira vollständig geblättert hat und mindestens 80 % der Tickets
  des letzten Laufs liefert — sonst nichts gelöscht und Fehler in `meta.jira_sync` (rot am Board).
- Fehlender Zugang im Hintergrund (Vaultwarden-Sitzung weg) steht als Fehler am Board statt still auszufallen.
- Karten zeigen „seit X Tagen in <Status>“ (`statuscategorychangedate`) und „⛔ blockiert von …“ (`issuelinks`, nur offene Blocker).

### Board
- Bahnen für **alle** Workstreams (auch leere), im Kopf Status, Owner, Datum. `Ongoing` = wiederkehrend: nie überfällig,
  kein „ohne Datum“. Tickets ohne Parent sind rot mit Hinweis „in Jira Parent setzen“.
- **Ziehen:** Spalte = Statuswechsel (nur Übergänge, die Jira für das Ticket anbietet; andere Spalten sind beim Ziehen
  gesperrt), Bahn = Parent-Wechsel (nur Tasks; Sub-tasks bleiben an ihrem Task). Die Karte bewegt sich sofort, dann
  „bestätigen / rückgängig“. Einstellung je Person „Verschieben bestätigen“ (Vorgabe an). Schlägt Jira fehl, springt die
  Karte zurück. Tastatur/Mobil: ⇄ auf der Karte → „Verschieben nach …“.
- Filter „🎯 nur aktueller Sprint“ (Label `sprint-JJJJ-MM-TT`), Ziel-Chip 🎯 auf Karten.

### Jira schreiben: schneller Weg
Die Brücke ruft den Atlassian-MCP **direkt als MCP-Client** auf (kein Modell), mit dem OAuth-Zugang, den Claude Code für
die Person gespeichert hat. Der Zugang wird nur gelesen, nie erneuert; ist er abgelaufen oder fehlt, läuft der
bisherige Weg über eine Claude-Sitzung (die ihn erneuert). Gemessen: bisher 10–18 s je Aktion (Median 12,4 s), direkt
0,2–1,4 s. `BRIDGE_MCP_DIRECT=off` schaltet ab.

### PR-Review live
Offene PRs aller Repos von `WirStrom1` über die GitHub-GraphQL-API, alle 5 min (`WERKBANK_GITHUB_MIN`), Cache in Mongo
(`github_prs`), SSE an offene Seiten. Zeigt Konflikt, Entwurf, offene Threads, Alter, Ziel-Branch (≠ develop wird
markiert) und **wer dran ist** (aus Entwurf/Konflikt/Review-Entscheidung/Threads/angefragten Reviewern, nicht hart).
Nur lesende Abfragen — `graphql()` weist Mutationen ab, bevor etwas gesendet wird. Token: `WERKBANK_GITHUB_TOKEN`, sonst
(Pilot) Vaultwarden-Element `WERKBANK_GITHUB_BW_ITEM` (Vorgabe „View only github API“); nie im Frontend oder Log.
Namen: `WERKBANK_GITHUB_NAMES="login=Name,…"` (Vorgabe knut523=Knut, bizarrochris=Christoph). Das PR-Register im
Vault bleibt Quelle für Spec ↔ PR und Deploy-Gates.

### Roadmap
„Priorisierung“ nach Thema, innerhalb nach Rang, „noch nicht priorisiert“ unten je Thema. „Zustände“: Swimlanes
Thema × (Backlog, Pre-Plan, Plan, Review, Live), Karten nach Rang, mit Rang-Chip, Jira-Status und PR-Live-Zustand.
Oben „Als Nächstes“: Top 5 mit höchstem Rang, noch nicht in Arbeit (kein Review/Live, kein Ticket In Progress/Done);
Specs mit Ticket im aktuellen Sprint zuerst. „Konsistenz“: Spec 4-Review/5-Live vs. Ticket offen und umgekehrt,
Specs ohne `jira:` im Frontmatter.

### Ziele & Sprint
Quelle (nur lesen): `olaf/1-Projects/ziele-olaf.md` (`WERKBANK_GOALS_FILE`). Format (von Knut festgelegt):

| Abschnitt | Spalten |
|---|---|
| `## Ziele` | ID \| Ebene \| Ergebnis \| Messgröße \| Baseline \| Ziel \| Stichtag \| Owner \| Eltern-ID \| Beleg |
| `## Bewertung` | ID \| Datum \| Ist \| Bewertung ✅/🟡/❌ \| Beleg \| Warum |

Ebenen `Gate | Ziel | KR | Monat | Sprint`; IDs `GATE-<JJMM>`, `Z-<kürzel>`, `KR<n>`, `M<MM>-<n>`, `S<MMTT>-<n>`; die
Eltern-ID baut den Baum. Lücken `‹… fehlt – Quelle: …›` werden grau/kursiv gezeigt und nie als Wert gezählt. Fehlt die
Datei oder eine Gate-Zeile: „Stage Gate nicht definiert“. Sprintziele im Planning: neu `S<MMTT>-<n>` mit Eltern-ID,
alt `S1`–`S4` (→ `S<MMTT des Sprints>-<n>`); Anker `<!--k:…-->` bleiben erhalten und verknüpfen Tickets.

**Jira-Labels** (Empfehlung, noch nicht final bestätigt — konfigurierbar): Sprint `sprint-JJJJ-MM-TT`
(`WERKBANK_SPRINT_LABEL_PREFIX`), Ziel = ID kleingeschrieben mit Präfix: `ziel-kr1`, `ziel-s0928-1`
(`WERKBANK_GOAL_LABEL_PREFIX`). Fortschritt je Ziel = erledigte / zugeordnete Tickets (Label oder in der Zeile genannt).
Sprint-Seite: Zielbaum, Sprintziele mit Fortschritt, „Im Sprint“ nach Ziel (Rest „ohne Ziel“), „Kandidaten – nicht im
Sprint“ (Mitnahme, Ziel-Tickets, überfällig, Top-10-Specs); Knöpfe „in Sprint nehmen / rausnehmen / Ziel zuordnen“
ändern nur Sprint-/Ziel-Labels, nach Bestätigung, über den MCP (`editJiraIssue`, Labels frisch gelesen).

### ⏱️ Mein Tag (Timebox)
Persönlicher Tagesplan 07–20 Uhr im 15-min-Raster, Tag- und Wochenansicht. Im Raster ziehen = Block anlegen, Block
ziehen = verschieben, unterer Rand = Länge. Blöcke frei betitelt oder an ein Ticket gebunden (Seitenleiste „Meine
offenen Tickets“, sortiert Sprint → Fälligkeit → Ziel; ziehen oder „+ heute“). Je Block erledigt/verschoben,
„Unerledigtes auf morgen“, Tagessumme geplant/erledigt und Anteil Ziele vs. ohne Ziel. Privat je Person (Mongo
`timebox`, jede Abfrage mit der eigenen userId), kein Kalender, kein Jira-Schreiben.

### Trockenlauf (Vorschau)
`WERKBANK_DRYRUN=1` (oder einzeln `WERKBANK_JIRA_DRYRUN` / `WERKBANK_VAULT_DRYRUN`): Jira-Schreibwege zeigen nur, was
geschrieben würde (Werkzeug + Argumente, gespeichert in `jira_dryrun`, `GET /api/dryrun`), Vault-Schreibwege schreiben
nichts, Agenten/Chats sind aus.

### Runde 6 (30.09.2026): jedes Ticket ein Ziel, Ziel-Deep-Dive, Mein Tag bearbeiten, Spec-Ordnung
- **Jedes Ticket ein Ziel:** Offene Tickets ohne gültiges Ziel-Label bekommen „ohne Ziel – genauer anschauen“. Gezählt wird das eigene Label oder das des Parents (ein Sub-task erbt vom Task). Labels auf Ziele, die es nicht mehr gibt, zählen nicht. Der Hinweis erscheint auf dem Board (mit Zähler und Filter), auf der Sprint-Seite, in „Mein Tag“ und als Pflege-Frage.
  - Ausnahme: `ziel-keins` (`WERKBANK_GOAL_EXEMPT_LABEL`), nur mit Begründung; die Begründung kommt vor dem Label als Kommentar.
  - Zuordnung unter `#/ziele/zuordnen`: Liste, Dropdown, Mehrfachauswahl und Sammelaktion mit Bestätigung. Ersetzt wird nur das Label derselben Ebene, berechnet aus der frisch gelesenen Label-Liste.
  - Vorschläge kommen aus `WERKBANK_GOAL_PROPOSALS` (JSON `[{key, ziel, begruendung, sicherheit}]`) und sind vorausgewählt.
- **Ziel-Deep-Dive:** `#/ziele/<ID>` (z. B. `#/ziele/KR1`, teilbar). Enthält:
  - die Felder mit Lücken und den Bewertungsverlauf,
  - die Kindziele,
  - die Tickets direkt und über Kindziele, nach Status; nur in der Zielzeile genannte Tickets sind als „Beleg“ markiert,
  - Specs (`ziel:` im Frontmatter oder über Tickets) mit PR-Live-Status,
  - Fortschritt, Tickets je Workstream und Risiken.
- **Mein Tag:** Ein Klick auf einen Ticket-Block oder ein Ticket in der Seitenleiste öffnet die Board-Detailansicht. Dort lassen sich Status, Fälligkeit, Kommentar, Owner, Ziel und Jira-Priorität ändern, jeweils mit Bestätigung.
  - Tagespriorität Muss/Soll/Kann je Block und je Ticket, privat. Eine ausdrücklich gesetzte Ticket-Priorität gewinnt vor der des Blocks.
  - Die Seitenleiste sortiert nach Tagesprio, Sprint, Fälligkeit, Ziel.
- **Spec-Ordnung:** Roadmap-Tab „Ordnung“ mit Regel-Check je Spec:
  - Frontmatter nach Vault-Schema plus `domain`/`lifecycle` gegen Ordner und Thema,
  - `jira:`, Ziel, DoD, offene Knut-Zeilen, Rang, Zustand gegen Ticket/PR, Eintrag in der Themen-Übersicht, Alter.
  - **Zustandswechsel nur als Kopiertext:** Laut Skill betrifft ein Wechsel Hub-Zahlen, Kreuztabelle, Prosa und rank.py; dafür gibt es keinen sauberen automatischen Schreibweg, deshalb schreibt die Werkbank dort nie.
  - **Neue Spec aus Vorlage:** mit Vorschau und Bestätigung, im Trockenlauf nicht.

### Runde 7 (30.09.2026, Knuts Entscheidung): Zuordnung in der Werkbank, nicht in Jira
- **Ticket → Ziel** steht in Mongo, nicht in Jira:
  - `goal_assignments` hält den aktuellen Stand je Key {key, kind: ticket|spec, ziel, begruendung, by, at};
  - `goal_assignments_log` ist der append-only-Verlauf.
  - `ziel` ist eine Ziel-ID, `KEINS` (bewusst ohne, nur mit Begründung) oder `null` (lokal entfernt; ein altes Jira-Label zählt dann nicht mehr).
  - Jira-Labels `ziel-*` werden weiter gelesen, als Fallback bzw. Import; die Werkbank-Zuordnung gewinnt. Sub-tasks erben vom Task.
- **Sprint-Mitgliedschaft** genauso: `sprint_members` {key, sprint, in, by, at} plus `sprint_members_log`. `in: false` schlägt ein altes Label `sprint-*`.
- Zuordnungsseite, Sammelaktion, „in Sprint nehmen / rausnehmen“, das Ziel im Ticket-Detail und „Vorschlag übernehmen (alle mit Sicherheit hoch)“ bzw. einzeln schreiben **nur lokal**, mit Bestätigung. Das gilt auch in der Vorschau: dort landet es in deren eigener Mongo.
- Specs lassen sich lokal einem Ziel zuordnen (`goal_assignments`, key = Spec-Pfad). Reihenfolge der Quellen: Werkbank → Frontmatter `ziel:` → über Tickets. `jira:` ist kein Mangel mehr, nur Anzeige.
- Der Label-Schreibweg nach Jira bleibt im Code, ist aber aus; `WERKBANK_GOALS_TO_JIRA=labels` schaltet ihn zusätzlich ein.
- „Neue Spec“ ist standardmäßig aus und nur noch Kopiertext; `WERKBANK_SPEC_CREATE=on` schaltet das Anlegen ein.
- **Übernahme ohne Migration:** Die Collections entstehen beim Start der Werkbank (Indizes in `db.ts`) bzw. beim ersten Schreiben in der Werkbank-DB (live: `werkbank`). Bestehende Jira-Labels wirken sofort als Fallback. Vorschau-Daten (27117) werden nicht übernommen.

### Tests ohne Live-Mongo
`MONGO_URI_WERKBANK=mongodb://127.0.0.1:<eigener Port> WERKBANK_TEST_PORT=3171 WERKBANK_TEST_BRIDGE_PORT=3196 npm test`
— mit eigenem `mongod --dbpath <scratch> --port <Port>`; nicht gegen die Live-Mongo auf 27017.

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
- Claude-Konfigurationen je Person liegen unter `.runtime/claude/<id>` (0700, gitignored) — darin die eigene
  Atlassian-OAuth-Anmeldung im Klartext-Format von Claude Code (`.credentials.json`, 0600), wie `~/.claude` auch.
  Alle Verzeichnisse gehören dem Unix-Nutzer der VM; gegeneinander abgeschottet sind sie erst mit eigenen Unix-Nutzern.
- In Werkbank-Sitzungen laufen keine Hooks der Nutzer-Konfiguration mehr — damit gehen auch keine Werkbank-Verläufe
  mehr über Knuts Stop-Hook an knut-agent-memory (vorher: nach jedem Zug die letzten bis zu 40 Nachrichten).
- Weitere Claude-Konten: AES-256-GCM in `werkbank.creds`, zum Browser nur Name + letzte 4 Zeichen, zur Brücke nur über
  den internen Kanal; Zustand der Konten ohne Geheimnisse.
- Der Live-Strom (`/api/events`) braucht eine Werkbank-Sitzung und trägt nur Ticket-Schlüssel; `/internal/jira-touched`
  nur mit internem Token, nur Schlüssel aus PM, höchstens 10 je Aufruf.

## Konfiguration im Repo

| Datei | Inhalt |
|---|---|
| `scripts/werkbank.sh` | der eine Einstieg (up/down/restart/status/update/doctor/skills/test/e2e/bridge-mock) |
| `scripts/setup.sh`, `start.sh`, `stop.sh`, `status.sh`, `env.sh` | Einzelschritte, idempotent |
| `librechat/librechat.yaml` | Endpunkt „Claude Code“, Modell-Specs und Vorlagen, Teilen, Oberfläche, Registrierung |
| `librechat/.env` | LibreChat-Umgebung **ohne** Geheimnisse (Ports, Login-Schalter, Teilen) |
| `.env.local` | Geheimnisse + verwalteter URL-Block — erzeugt, gitignored, 600 |
| `claude-bridge/src/` | Brücke: `server.ts` (HTTP, Anhänge, Vorgaben, Nur-lesen-Modus, MCP-Auswahl), `sessions.ts` (auch Auto-Modus und Kontowechsel), `accounts.ts` (mehrere Claude-Konten), `tools.ts` (auch: welche Atlassian-Aufrufe Jira ändern), `claudehome.ts` (Claude-Konfiguration je Person, strict MCP, Hooks), `attachments.ts`, `mcpcall.ts` (ein bestätigter MCP-Aufruf, MCP-Status), `init-timing.ts`, `mock.ts` |
| `web/server/` | Web-App-Server (TypeScript, läuft ohne Build): `main.ts` (Routen), `auth.ts`, `creds.ts`, `crypto.ts`, `vault.ts`, `search.ts`, `jira.ts`, `jirawrite.ts` (Schreiben über MCP), `events.ts` (Live-Strom), `agent.ts` (auch Agent-Chat), `links.ts` (Vault ↔ Tickets), `roadmap.ts`, `sprint.ts`, `syncplan.ts`, `skills.ts`, `sharing.ts` |
| `web/src/` | Oberfläche (Vite + React), Optik wie LibreChat (Inter, hell/dunkel) |
| `templates/sprint/` | Vorlagen für neue Sprint-Zyklen (Summary, Review, Planning mit S1–S4) |
| `templates/claude/CLAUDE.md` | Arbeitsweise für die Claude-Konfiguration je Person (verlinkt, nicht kopiert) |
| `templates/claude/settings.json` | `autoMode`-Regeln für den Auto-Modus (verlinkt in jede Konfiguration je Person) |

## Tests

```bash
scripts/werkbank.sh test   # Brücke (48) + Web-App (110), ohne echte Konten, ohne /vault zu ändern
scripts/werkbank.sh e2e    # Playwright, 23 Schritte, ca. 2 Minuten
scripts/werkbank.sh stream-timing   # Zeitmessung Streaming (Mock), Ergebnis auch in .runtime/e2e/stream-timing.json
scripts/werkbank.sh init-timing 3   # Start der echten CLI bis „init“ (ohne Modellaufruf), .runtime/e2e/init-timing.json
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
- **Neu (Runde 4):** Brücke — eigene Claude-Konfiguration je Person (Verzeichnis 0700, Skills verlinkt, CLAUDE.md-Link,
  `strictMcpConfig`, genau vault-search/werkbank/atlassian), Pilot-Konto geteilt ohne Nutzer-Hooks und ohne eigenes
  Verzeichnis, MCP-Status meldet die Konfiguration, Fortsetzen nur in derselben Konfiguration, Jira-Schreiben im Chat
  → `/internal/jira-touched` erst nach „ja“ und nur bei Erfolg (abgelehnt → nichts), welche Atlassian-Aufrufe Jira ändern
  und welche Schlüssel (auch Anlegen/Verknüpfen), MCP-Anmeldung ohne Rückfrage. Web — SSE nur angemeldet und mit
  `no-transform`, Board-Schreiben erscheint bei einer anderen Person, `/internal/jira-touched` zieht nur PM-Schlüssel nach,
  der ganze Weg Chat (Mock-Brücke) → Jira → Kopie → Board-Strom; Einrichtung zeigt Konfiguration, Chat-Anmeldung und
  Terminal-Befehl. Playwright — Karte leuchtet auf und zählt Kommentare hoch ohne Neuladen (anderer Tab; Jira-Schreiben im
  Chat), `hello` des Live-Stroms kommt durch LibreChats `/werkbank`-Proxy sofort an.
- **Neu (06.10.2026):** Auto-Modus (`claude-bridge/test/auto.test.ts`: Klasse `auto` nur im Arbeitsordner, Symlink auf den
  Vault, keine Rückfrage bei `ls`/Edit, Vault-Edit und Jira-Kommentar fragen, `git push` gesperrt, Eskalation und Ablehnung
  des Klassifikators, nur freigeschaltete Personen, Board-readonly, Not-Aus, `settings.json`-Link). Mehrere Konten
  (`claude-bridge/test/accounts.test.ts`: Wechsel bei `rate_limit`, mitten im Zug fortsetzen, gemerkt, alle erschöpft,
  einzelner Schlüssel unverändert, Kontotest, keine Tokens im Log; `web/test/api.test.ts`: Einrichtungs-API maskiert,
  verschlüsselt, Umsortieren, Testen, Entfernen, fremde Konten, interner Kanal).
- **Neu (07.10.2026):** Live-Anzeige (`bridge.test.ts`, Gedanken/Werkzeugbeginn/Lebenszeichen mit Ankunftszeit) und E5
  (`auto.test.ts`: Board-Lauf neben Chat und umgekehrt, zweiter Chat weiter gesperrt, höchstens 2 Board-Läufe, andere
  Person unberührt, Not-Aus unverändert).
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

## Stand (29.09.2026, Runde 4)

**Erledigt und geprüft (Runde 4)** (Tests + Playwright mit Mock-Claude und Jira-Nachbau; Startzeiten mit der echten CLI)
- **Schneller:** nur Werkbank-MCP (strict), Claude-Konfiguration je Person, Knuts Hooks aus → `init` der echten CLI
  **5,4 s → 1,3 s (je Person) bzw. 1,6 s (Knut, geteilt)**, siehe „Schneller Start“.
- **Je Person eine Claude-Konfiguration** unter `.runtime/claude/<id>` mit Vault-Skills und CLAUDE.md; Pilot-Schalter
  für Knut; Atlassian-OAuth greift ohne Nutzer-Registrierung (geteilt: verbunden gemessen); Anmeldung im Chat möglich.
- **Board live:** bestätigtes Schreiben (Board, Sprint, Pflegefragen, `jira_update`) und Jira-Schreiben im Chat über den
  Atlassian-MCP ziehen das Ticket sofort in die Kopie und erscheinen per SSE auf offenen Board-/Sprint-Seiten.

**Aus Runde 3, weiter gültig:** Streaming (Arbeitsanzeige sofort), Jira-Schreiben über den MCP, „Agent ansetzen“ als
echter Chat, Sub-tasks, Dokumente an Tickets, Roadmap-Sektion, Nutzung je Skill; nur lesend gegen echte Daten geprüft:
Verknüpfungsindex, Vorschläge, Roadmap-Parser, `roadmap_check.py`.

**Nicht mit echten Konten geprüft**
- **Echter Claude-Zug** nach Runde 4: `ersterText` und die Prompt-Größe (erwartet kleiner als 33k), `init` im Log der Brücke.
  Gemessen ist nur die CLI bis `init` mit ungültigem Token.
- **Atlassian-Anmeldung im Chat** (`authenticate` → Link → Adresse der Fehlerseite → `complete_authentication`) mit einem
  echten Atlassian-Konto in einer frischen Konfiguration — die Werkzeuge und ihre Texte stehen so in der CLI 2.1.284,
  durchgespielt ist der Ablauf nicht. Ebenso der Terminal-Weg mit `CLAUDE_CONFIG_DIR`.
- **Echte Jira-Schreibaufrufe** über den MCP (aus Runde 3 offen) und damit, welche Antwortform `createJiraIssue` wirklich
  hat (der Schlüssel wird aus dem Antworttext gelesen).
- **Knut auf „je Person“**: nicht umgestellt (Pilot-Schalter), also nicht ausprobiert, ob seine Chats danach wie gewohnt
  laufen (andere CLAUDE.md, ohne compartment).
- Der Coder-Proxy vor LibreChat (Streaming und SSE dort) — ohne Coder-Anmeldung nicht messbar.

## Einmalige Schritte für Knut

1. **Nichts Pflicht.** Knut bleibt im Pilot auf seiner echten Konfiguration (`BRIDGE_CLAUDE_CONFIG_SHARED` in
   `scripts/start.sh`); seine Atlassian-Anmeldung gilt weiter. Einrichtung → **„Jira-MCP prüfen“** zeigt „geteilt“ und „verbunden“.
2. **Einen echten Chat** schicken — danach stehen `init` und `ersterText` in `.runtime/logs/claude-bridge.log`
   (`turn end`); in `turn start` stehen `konfig` und die MCP-Liste. Vergleich mit 6–8 s / ~10 s vom Vormittag.
3. **Im Chat eine Jira-Änderung** machen lassen (z. B. „kommentiere PM-… mit …“, dann „ja“) und dabei das Board offen
   lassen: die Karte sollte ohne Neuladen aufleuchten.
4. Optional auf „je Person“ wechseln: `BRIDGE_CLAUDE_CONFIG_SHARED=` in die Umgebung von `start.sh` (bzw. die Zeile dort
   leeren), `scripts/werkbank.sh restart`, dann Einrichtung → **„Im Chat bei Jira anmelden“**.
5. Entscheidungen R4-1 bis R4-3 unten.

## Einmalige Schritte für jede weitere Person (Team)

Siehe „Claude-Konfiguration je Person → Einmalig je Person“: eigener `claude setup-token` in der Einrichtung, dann
**„Im Chat bei Jira anmelden“** (headless, Adresse der Fehlerseite zurückkopieren). Vorher muss Knut sie freischalten
(`BRIDGE_ALLOWED_EMAILS` / `WERKBANK_ALLOWED_EMAILS`) — die Sitzungen laufen weiter als Unix-Nutzer der VM.

## Bekannte Grenzen

- Direkt auf 3070 braucht die Web-App ein eigenes Login; in LibreChats Leiste nicht.
- Jira-Schreiben kostet je Aktion einen kleinen Claude-Zug (Sekunden) und hängt an der MCP-Anmeldung der eigenen
  Claude-Konfiguration (Knut im Pilot: seine echte).
- Die Roadmap-Rangliste rechnet die Werkbank nicht neu; Verschiebungen sind Vorschläge.
- Status „fertig“ eines Agent-Chats heißt: kein Zug läuft und keine Rückfrage offen — die Unterhaltung lässt sich
  weiterführen. Nach einem Neustart der Brücke fehlt die Liste der geschriebenen Dateien früherer Züge.
- Die Jira-Kopie ist für alle Werkbank-Konten gleich (gelesen mit dem Zugang des Pilot-Kontos bzw. der klickenden Person).
- **Bearbeiten/Neu generieren** älterer Nachrichten verzweigt in LibreChat, die Claude-Sitzung läuft linear weiter.
- Bei einem Neustart der Brücke gehen offene Rückfragen verloren; die Sitzung lässt sich fortsetzen.
- Bash-Befehle brauchen im Chat immer ein „ja“, auch rein lesende.
- Die Sitzungen laufen als Unix-Nutzer der VM (Dateirechte, `/vault`, Bash). Hooks, Gedächtnis, Plugins und
  MCP-Anmeldungen sind je Person getrennt (Runde 4), die Dateirechte nicht — das bräuchte eigene Unix-Nutzer.
- Live-Aktualisierung: Änderungen, die jemand **direkt in Jira** (Browser) macht, kommen weiter erst mit dem
  15-Minuten-Abgleich (kein Jira-Webhook auf die VM).
- Die Chat-Erkennung von Jira-Schreiben kennt die Schlüssel nur aus Argumenten bzw. beim Anlegen aus der Antwort;
  schreibt Claude über einen anderen Weg (z. B. `curl` in Bash), zieht das Board erst beim Abgleich nach.
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
| Gateway vor allen MCP-Servern | pmcp | **anders gelöst** (Runde 4) — feste, kleine MCP-Auswahl je Werkbank-Sitzung mit `strictMcpConfig`; ein Gateway wäre zusätzliche Infrastruktur |
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

### Runde 4 (Knut, 29.09.2026)

| # | Auftrag | Stand |
|---|---|---|
| R4-a | **Schneller:** explizite, kleine MCP-Auswahl (`mcpServers` + `strictMcpConfig`) statt der ganzen Nutzer-Konfiguration; Skills-Kern und CLAUDE.md behalten; Atlassian-OAuth prüfen; vorher/nachher messen | **erledigt** — strict + Konfiguration je Person + ohne Knuts Hooks; `init` 5,4 s → 1,3/1,6 s (echte CLI); OAuth greift ohne Nutzer-Registrierung; `ersterText` mit echtem Claude noch offen |
| R4-b | **Team-fähig:** `CLAUDE_CONFIG_DIR` je Person unter `.runtime/claude/<id>`, Skills hineinverlinkt, Knuts Pilot-Konto optional auf seiner Konfiguration (Vorgabe je Person), einmalige Schritte dokumentiert | **erledigt** — siehe „Claude-Konfiguration je Person“; Anmeldung headless im Chat |
| R4-c | **Board sofort aktuell** nach jedem bestätigten Jira-Schreiben und nach Jira-Schreiben im Chat | **erledigt** — `refreshIssue` + SSE, Chat-Erkennung in der Brücke, getestet (Unit, API, Playwright) |
| R4-d | README: erledigt markieren, offene Entscheidungen aktuell | **erledigt** (dieser Abschnitt, unten R4-1 … R4-3) |

## Offene Entscheidungen

### Neu aus Runde 4

1. **R4-1 — Knuts Hooks in Werkbank-Sitzungen.** Sie sind jetzt aus (auch für Knuts geteilte Konfiguration): der
   SessionStart-Hook kostet ~4,5 s je Sitzung, und der Stop-Hook (`memory-capture.sh`) schickte bisher nach jedem Zug
   die **letzten bis zu 40 Nachrichten** jeder Werkbank-Sitzung an knut-agent-memory (TDAI) — auch Service-Fälle. Die Brücke hat eigene Wächter (Merge/Push gesperrt).
   *Empfehlung:* aus lassen. Zurück: `BRIDGE_SHARED_USER_HOOKS=on`.
   - Knut:
2. **R4-2 — Knut selbst auf „je Person“?** Dann gleiche Bedingungen wie das Team (schnellster Start, keine
   Plugins/compartment, Team-CLAUDE.md statt der eigenen), einmal im Chat bei Jira anmelden. *Empfehlung:* nach einem
   echten Chat mit den neuen Zeiten umstellen, damit der Pilot zeigt, was das Team bekommt.
   - Knut:
3. **R4-3 — Eigene Unix-Nutzer je Person im Team-Workspace.** `CLAUDE_CONFIG_DIR` trennt Anmeldungen, Hooks und
   Gedächtnis, aber nicht Dateirechte (alle Verzeichnisse gehören dem VM-Nutzer; Bash läuft mit dessen Rechten, nach „ja“).
   *Empfehlung:* für den Team-Workspace ja (ein Nutzer je Person, Brücke startet die CLI per `sudo -u`); bis dahin nur
   Personen freischalten, denen man die VM-Rechte zutraut.
   - Knut:

### Aus Runde 3 (noch offen)

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
