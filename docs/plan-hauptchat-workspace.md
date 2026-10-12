# Plan 144 — OLAF Workspace: Hauptchat oben, Unter-Chats darunter

**Status:** Entwurf 12.10.2026 · Branch `feat/hauptchat-workspace` (Basis Live `release/werkbank-2026-10-11d`, `7fce7f0`) · nur lokal.
**Repo:** knut523/werkbank (privat). Bericht: `~/work/knut/review-pakete/144-hauptchat-workspace/bericht.md`.

> Knut, 12.10.2026: „Einfach OLAF Workspace als Name … und auch Leitstand ist eher confusing … im Moment habe ich das Gefühl,
> alle Chats können leitend sein, aber eigentlich brauchen wir einen Chat, der gepinnt ist und oben und führt, und dann seine
> Subs, wie du, öffnen kann.“

## 1. Befund (belegt, Stand HEAD `7fce7f0`)

- **Leitstand heute:** `startLeitstand` (`web/server/leitstand.ts:117`) legt einen normalen LibreChat-Chat „Leitstand · TT.MM.“ mit
  Lesezeichen `Leitstand` (`LEIT_TAG`, `orchestrator.ts:174`) an. Start **nur** über den internen Kanal
  `/internal/orchestrator/leitstand/start` (`main.ts:2222`) aus der CLI mit Übergabedatei; ein neuer beendet den alten
  (`leitstand.ts:129–152`). Ein Start-Knopf war in Plan 132 ausdrücklich verschoben (`docs/plan-leitstand.md:257`).
- **Stränge:** Lesezeichen `Orchestrator`, Titel „Orchestrator · …“ (`orchestrator.ts:22, :181`). Ein Strang kennt seinen
  Leitstand nicht; alle Stränge gehören der Person. Gruppierung je Lauf **gibt es schon serverseitig**:
  `groupStrands`/`overview` (`leitstand.ts:337, :378`), Seite `#/leitstand` (`web/src/pages/Leitstand.tsx`) mit
  `GET /api/leitstand/overview` (nur Admins, Feature `leitstand`, `features.ts:21`). Plan 128 ist damit inhaltlich gebaut,
  nur die Notiz `docs/plan-orchestrator-gruppen.md` steht noch auf „Idee“.
- **Statuswörter** (`statusWord`, `leitstand.ts:324`): läuft · wartet · fertig · gestoppt (+ erledigt = von Knut geprüft).
- **„Jeder Chat kann leiten“:** Vorlage `vorlage-koordinator` „Koordinator (Teilagenten)“ (`librechat/librechat.yaml:95`) — sie
  verteilt nur Teilagenten *im selben Chat*, hat keine `orch_*`-Werkzeuge (die gibt es nur im Leitstand, `claude-bridge/src/tools.ts:231`).
  Der Name klingt aber nach Leitung.
- **LibreChat v0.8.7, Seitenleiste** (`.runtime/librechat/client/src/`):
  - Chatliste = `components/UnifiedSidebar/ConversationsSection.tsx`: Lesezeichen-Filter + Suche (Z. 113–120), `FavoritesList`
    (121–125), `ProjectsSection` (126), dann die virtualisierte Liste `Conversations` (127–140). Dieselbe Komponente steckt am Handy
    in der Schublade (`UnifiedSidebar.tsx:135–175`).
  - Eingebautes **Anpinnen** gibt es (`conversation.pinned`, `api/server/routes/convos.js:206`), aber nur als Filter über die schon
    geladenen Seiten (`Conversations.tsx:213`): ein angepinnter Chat jenseits der ersten 25 fehlt, Überschrift „Angepinnt“ ist
    allgemein, Unter-Einträge gibt es nicht.
  - Navigation zu einem Chat: `useNavigateToConvo` bzw. `navigate('/c/<id>')`; aktiv = `useParams().conversationId`.
- **Patch-Mechanik:** `scripts/librechat-patch.sh` spielt `librechat/overlay/**` (neue Dateien) und `librechat/patches/*.patch`
  (git apply, idempotent, geänderte Patches setzen die Datei zurück) ein und baut den Client neu, wenn sich etwas ändert.
- **Name:** „OLAF-Werkbank“/„Werkbank“ steht in Seitentiteln (`WerkbankRoute.tsx:34`, `web/index.html`), Leisten-Gruppe,
  Einrichtung, Hinweisen, Fehlermeldungen und Agenten-Vorgaben (Inventar: Abschnitt 4). E-Mails verschickt die Werkbank keine.

## 2. Varianten für „oben angepinnt, Unter-Chats darunter“

| Variante | Was | Aufwand | Risiko |
|---|---|---|---|
| **A — eigener Abschnitt über der Chatliste** | Ein Patch fügt in `ConversationsSection.tsx` **eine** Zeile ein: `<HauptchatSection toggleNav={…} />` zwischen Favoriten und Projekten (nicht bei aktiver Suche). Die Komponente liegt im Overlay und liest `/werkbank/api/leitstand/overview`. | klein–mittel (1 Patch-Zeile, 1 Overlay-Datei ~200 Z.) | gering: eine Einfügestelle; passt der Patch bei einem LibreChat-Update nicht, bricht `librechat-patch.sh` mit Hinweis ab (vorhandene Mechanik). Nicht virtualisiert → eigene Höhenbegrenzung nötig. |
| B — LibreChats eigenes Anpinnen | Der Hauptchat bekommt `pinned: true` über `/api/convos/update`. | sehr klein | erfüllt Ziel 4 nicht (keine Unter-Chats, kein Status), fehlt jenseits Seite 1, Überschrift „Angepinnt“ statt „Hauptchat“. |
| C — Workspace-Seite mit eingebettetem Chat | Neue Seite `/wb/hauptchat`: links Strangliste, rechts der Chat im iframe (`/c/<id>`). | groß | LibreChat im LibreChat-iframe (doppelte Leiste, Anmeldung, Handy unbrauchbar), Chat ist nicht mehr „in der Chat-Seitenleiste“. |

**Empfehlung: A.** Sie trifft Knuts Bild wörtlich (oben in der Chat-Seitenleiste, darunter die Subs), kostet eine Patch-Zeile
und nutzt die schon gebaute Gruppierung je Lauf.

## 3. Schnitt (was gebaut wird)

### S1 Abschnitt „Hauptchat“ in der Chat-Seitenleiste (Overlay + Patch 50)
- Neu `librechat/overlay/client/src/components/Werkbank/HauptchatSection.tsx`, neu `librechat/patches/50-client-hauptchat.patch`
  (eine Einfügung in `ConversationsSection.tsx`).
- Nur für Admins sichtbar (Antwort 403 → Abschnitt fehlt, kein Aufblitzen: bis zur ersten Antwort nichts).
- Aufbau, immer an derselben Stelle über der Chatliste:
  - **Kopfzeile „Hauptchat“** mit Zustand (bereit · läuft · wartet auf dich · Brücke nicht erreichbar) — Klick öffnet den Chat
    (im selben Fenster, Handy: Schublade schließt). Aktiv hervorgehoben wie ein normaler Chat. Rechts ein Menü „⋯“ mit
    „Neu starten…“.
  - **Kein Hauptchat aktiv:** Zeile „Hauptchat starten“ (Knopf) mit Untertitel „führt die Unter-Chats“.
  - **Unter-Chats** eingerückt darunter, je Lauf eine zuklappbare Zeile („Flex — 3 Stränge · 1 wartet“), darin je Strang
    Titel + Status-Punkt/Wort: läuft · wartet auf dich · zu prüfen · gestoppt. Gruppen mit „wartet“/„gestoppt“ sind offen, die
    übrigen zu; Auf/Zu merkt sich der Browser (localStorage). Ein Lauf mit nur einem Strang wird ohne Gruppenzeile gezeigt.
  - Ganzer Abschnitt einklappbar (Kopf-Pfeil), Zähler „n Unter-Chats“.
  - Höchstens ~45 % der Seitenleistenhöhe, darin eigener Scroll.
  - Aktualisierung alle 30 s, bei Fensterfokus und nach jedem Chatwechsel.
- „Erledigt“ (von Knut geprüft) erscheint in der Seitenleiste nicht; dafür der Link „Alle Unter-Chats“ → Workspace-Seite.
- Eingeklappte Desktop-Leiste: Hauptchat-Symbol oben im Icon-Streifen (`WerkbankNav`, nur Admins, nur wenn aktiv) — Council B6.
- Zeilen sind echte Links (`href="/c/<id>"`, Klick über den Router, Strg-Klick = neuer Tab), Gruppen Knöpfe mit
  `aria-expanded`; Status = Punkt + Wort; Leerzustand „Noch keine Unter-Chats — der Hauptchat startet sie“; Fehlerzustand
  „Stand gerade nicht abrufbar“ mit „Erneut“ — Council B5.

### S2 Start/Neustart in der Oberfläche
- Neu `GET /api/leitstand/handover` → automatisch erzeugte Übergabe aus offenen Strängen (Titel, Status, Ordner, letzter Stand-
  Auszug) und offenen Rückfragen (`listQuestions`), im Aufbau von `docs/leitstand-uebergabe-vorlage.md`, plus Register und
  Regeln aus der Vorlage. Nur Admins.
- Neu `POST /api/leitstand/start` `{ handoverText }` → derselbe `startLeitstand` wie der interne Kanal (Admin-Prüfung, CSRF-Header
  `x-werkbank`, 40 000 Zeichen). Die CLI bleibt unverändert.
- Dialog auf der Workspace-Seite `#/leitstand?start=1` (Knopf aus der Seitenleiste führt dorthin): Textfeld mit der erzeugten
  Übergabe (bearbeitbar), Hinweis „Der bisherige Hauptchat wird beendet und bleibt lesbar“, Knopf „Hauptchat starten“. Nach dem
  Start öffnet sich der neue Hauptchat.
- Übergabe-Text wird vor dem Einzäunen entschärft (`<<<ÜBERGABE`/`ÜBERGABE>>>` gebrochen) — gilt auch für die CLI; die
  automatische Übergabe enthält keine Strang-Auszüge (Council B1). Nach dem Start: `werkbank-open` an LibreChat (neuer Chat im
  selben Fenster) und Ereignis `werkbank-hauptchat` → Seitenleiste lädt sofort neu (B7).
- Kein Dialog-Nachbau im LibreChat-Client (weniger Overlay-Code, gleiche Komponenten wie die übrige Workspace-Seite).

### S3 Namen
- **„OLAF Workspace“** statt „Werkbank“/„OLAF-Werkbank“ in allem, was Menschen sehen: Seitentitel, Leistengruppe, Seitentexte,
  Hinweise, Fehlermeldungen der API, Einrichtung, Texte, die in Chats landen (Statuszeilen, Vorgaben an Agenten), Fußzeile,
  `librechat.yaml`-Texte. **Bleiben:** Pfade (`/werkbank/`, `/wb/`), Repo-/Ordnernamen, Env-Variablen (`WERKBANK_*`), Header
  (`x-werkbank`), Kennungen (`werkbank-antwort:`, `#leitstand-`), Test-IDs, Log-Zeilen, Skriptnamen.
- **„Hauptchat“** statt „Leitstand“ in Oberfläche und Texten: Titel neuer Hauptchats „Hauptchat · TT.MM.“, Lesezeichen
  `Hauptchat` für neue (alte Chats behalten ihr Lesezeichen), Meldung „🛰️ Hauptchat-Meldung (automatisch …)“, Seite „Hauptchat &
  Unter-Chats“, Funktionsname in der Freigabe. Interne Bezeichner (`kind: 'leitstand'`, `/api/leitstand/*`, Dateinamen) bleiben.
- README/Doku: ein Satz „OLAF Workspace (früher: OLAF-Werkbank); Hauptchat (früher: Leitstand)“.

### S4 Nur der Hauptchat führt
- Vorlage „Koordinator (Teilagenten)“ → **„Teilagenten in diesem Chat“** mit Beschreibung „verteilt Recherche auf Teilagenten in
  *diesem* Chat — startet keine Unter-Chats; das macht nur der Hauptchat“; `modelLabel` „Teilagenten“. (Alternative Entfernen →
  Entscheidung K2.)
- Hinweistext in `librechat.yaml` (interface) erwähnt „Koordinator“ nicht mehr.
- Im Abschnitt S1 Untertitel „führt die Unter-Chats“; in normalen Chats ändert sich nichts (keine `orch_*`-Werkzeuge, wie heute).

### Nicht in diesem Schnitt
- Hauptchat und Stränge aus der normalen Chatliste ausblenden (bräuchte einen zweiten Patch in `Conversations.tsx`) → K3.
- Strang ↔ Hauptchat-Verknüpfung in der Datenbank (alle offenen Stränge der Person hängen unter dem einen Hauptchat).
- Mehr als ein Hauptchat je Person, Hauptchat für Nicht-Admins, Ausrollen auf Live.

## 4. Inventar der sichtbaren Texte

Inventar vor dem Bau (Lese-Agent, ≈150 sichtbare Zeilen): `web/index.html`, `web/src/**` (≈50), `web/server/**` (≈60),
`web/mcp/werkbank-tools.ts` (6), `claude-bridge/src/**` (≈25), `librechat.yaml` + Overlay (≈10), `templates/claude/**` (8),
Skripte (≈12). **Keine E-Mails, keine Push-Benachrichtigungen** — „Benachrichtigung“ heißt hier: Heute-Zähler, Rückfragen,
Weck-Meldungen im Hauptchat. Regeln für den Bau:

| Art | Umgang |
|---|---|
| Oberfläche, Seitentitel, Fehlermeldungen, Statuszeilen der Brücke, Fußzeile, Begrüßung | umbenennen |
| Vorgaben an Agenten (`SYSTEM_APPEND`, Strang-Vorgabe, Teilagenten, `templates/claude/**`, MCP-Beschreibungen) | umbenennen — Agenten sprechen Knut sonst mit dem alten Namen an |
| Vom Mock erkannte Vorgabe-Sätze (`claude-bridge/src/mock.ts:90, :184`) | Mock erkennt alt **und** neu |
| Marker, nach denen Code sucht: Vault-Überschriften `## Vorschläge aus der Werkbank`, `## Projekte (Werkbank)`, `## Werkbank — Stand`, Kontext-Überschrift `## Werkbank-Kontext`, gespeicherte Werte `via: 'Werkbank'`, `by: 'Werkbank (automatisch)'` | **bleiben** (sonst zweite Abschnitte in alten Notizen / Datenbruch); in der Oberfläche wird `via: 'Werkbank'` als „OLAF Workspace“ angezeigt |
| Text, den die Werkbank nach Jira schreibt („Werkbank-Review“, „Angelegt über die Werkbank“) | bleibt in diesem Schnitt (nach außen sichtbar, Team kennt den alten Namen) → K5 |
| Lesezeichen `Leitstand` alter Chats | bleibt an alten Chats; neue bekommen `Hauptchat`; Code erkennt beide |
| CLI-/Skriptausgaben | umbenennen, wo sie Bedienhinweise sind; Pfade/Befehle bleiben |

## 5. DoD (Prüfsätze)

1. Als Admin steht über der Chatliste ein Abschnitt „Hauptchat“, bei jedem Chat, jeder Workspace-Seite und nach Neuladen an
   derselben Stelle (Desktop und Handy-Schublade). (Screenshot + e2e)
2. Ist ein Hauptchat aktiv, öffnet ein Klick auf „Hauptchat“ genau diesen Chat ohne Neuladen; er ist dann hervorgehoben. (e2e)
3. Ist keiner aktiv, zeigt der Abschnitt „Hauptchat starten“; der Knopf führt zum Start-Dialog. (e2e)
4. Der Start-Dialog ist mit einer erzeugten Übergabe vorbefüllt, die jeden offenen Strang (Titel, Status, Ordner) und jede offene
   Rückfrage nennt. (Test)
5. „Hauptchat starten“ legt einen Chat „Hauptchat · TT.MM.“ mit Lesezeichen `Hauptchat` an, beendet den bisherigen und öffnet den
   neuen. (Test + e2e)
6. `POST /api/leitstand/start` ohne Admin → 403, ohne `x-werkbank` → 403, ohne Text → 400, über 40 000 Zeichen → 400. (Test)
7. Unter dem Hauptchat stehen alle offenen Unter-Chats eingerückt, je Lauf gruppiert, mit Statuswort aus {läuft, wartet auf dich,
   zu prüfen, gestoppt}; ein Klick öffnet den Strang. (e2e)
8. Lauf-Gruppen und der ganze Abschnitt lassen sich auf- und zuklappen; der Zustand übersteht ein Neuladen. (e2e)
9. Als Nicht-Admin gibt es keinen Abschnitt und keinen Netzwerkfehler in der Konsole außer der einen 403-Antwort. (e2e)
10. Bei aktiver Suche ist der Abschnitt ausgeblendet (die Suche zeigt nur Treffer). (e2e)
11. Kein sichtbarer Text der Oberfläche (Workspace-Seiten, Leiste, LibreChat-Overlay, Seitentitel, `librechat.yaml`-Texte) enthält
    noch „Werkbank“ oder „Leitstand“; ausgenommen sind Fundstellen, die im Inventar als „bleibt (intern)“ markiert sind. (grep-Probe
    im Bericht + e2e-Textprobe)
12. Pfade, Env-Variablen, Header, Kennungen (`/werkbank/`, `WERKBANK_*`, `x-werkbank`, `werkbank-antwort:`, `#leitstand-`) sind
    unverändert; alle bisherigen Tests (Brücke, Web) grün. (Testlauf)
13. Die Vorlage „Koordinator“ heißt nicht mehr so; ihr Text sagt, dass sie keine Unter-Chats startet. (yaml-Probe)
14. `librechat-patch.sh` spielt Patch 50 auf einen frischen v0.8.7-Baum ein, ein zweiter Lauf ist ein No-op, der Client baut. (Probe)
15. Screenshots vorher/nachher, Desktop 1440 und Handy 390, liegen im Review-Paket. (Bilder)
16. Tests laufen nur gegen eigene Test-Mongo/Ports, nie gegen Live (3070/3080/3090/27017). (Bericht)

## 6. Offene Entscheidungen für Knut

- **K1 Name genau:** „OLAF Workspace“ (so verstanden) — auch in Agenten-Vorgaben („Du läufst im OLAF Workspace“)? Empfehlung: ja,
  überall, wo es Menschen oder Agenten lesen.
- **K2 Koordinator:** umbenennen in „Teilagenten in diesem Chat“ (Empfehlung, nichts geht verloren) oder ganz entfernen.
- **K3 Doppelte Einträge:** Hauptchat und Unter-Chats stehen zusätzlich in der normalen Chatliste. Ausblenden kostet einen zweiten
  Patch an LibreChat. Empfehlung: erst einmal so lassen, nach einer Woche entscheiden.
- **K4 Titelpräfix der Stränge** „Orchestrator · …“ → „Unter-Chat · …“? Empfehlung: ja, für neue Stränge (die Seitenleiste zeigt
  sie ohnehin unter dem Hauptchat).
- **K5 Texte nach Jira** („Werkbank-Review“, „Angelegt über die Werkbank“): bleiben vorerst (das Team sieht sie). Empfehlung:
  mit dem Team-Onboarding umstellen.

## 7. Council

### Runde 1 (Plan-Entwurf) — HOLD 0,75

Rollen: Befürworter (eigener Lese-Agent, anderes Modell); Technik/Sicherheit, Advocatus und UX hat die Sitzung selbst
nacheinander im Code geprüft, weil der Werkbank-Hook höchstens 4 Teilagenten je Nachricht zulässt (das Inventar und die
Code-Erkundung hatten sie schon verbraucht). Befürworter: Variante A trifft Knuts Bild wörtlich, Backend ist fast fertig,
Rückbau jederzeit.

Befunde (Technik/Advocatus/UX):
- **Zaun der Übergabe:** Bisher kam die Übergabe aus Knuts Datei (vertrauenswürdig). Die automatische Übergabe enthält Titel
  und Rückfragen, die Agenten geschrieben haben; `neutral()` (`leitstand.ts:71`) entschärft nur `werkbank-antwort` und
  `#leitstand-`, nicht `ÜBERGABE>>>` → ein Titel könnte den Zaun schließen und Anweisungen in Knuts Stimme anhängen.
- **Start-Endpunkt:** Cookie-Anmeldung + `x-werkbank`-Header (kein CORS, `main.ts:87`) + `needAdmin` + Brückenprüfung
  `LEITSTAND_EMAILS` (`claude-bridge/src/server.ts:331`) — kein Rückschritt gegenüber dem internen Kanal, solange dieselbe
  Funktion `startLeitstand` genutzt wird. Ein Admin ohne Eintrag in `LEITSTAND_EMAILS` bekommt 403 von der Brücke → muss als
  lesbare Meldung ankommen.
- **Eingeklappte Leiste (Desktop):** Dann ist nur der Icon-Streifen sichtbar (`Sidebar.tsx:237`); der Hauptchat wäre zwei Klicks
  entfernt — widerspricht „immer an derselben Stelle“.
- **Wortwahl:** Seite und Gruppenzeile sagen „Stränge“, der Abschnitt „Unter-Chats“; `groupLine` geht auch in die
  Weck-Meldungen (`leitstand.test.ts:324`).
- **UX:** Status nie nur Farbe; Zeilenhöhe wie `Convo` (h-12 Handy / h-9 Desktop); Gruppen als Knöpfe mit `aria-expanded`;
  Einträge als echte Links (`href="/c/…"`, Strg-Klick = neuer Tab) mit `aria-current`; Leer- und Fehlerzustand; Höhe begrenzen.
- **Nach dem Start:** Die Seitenleiste darf nicht 30 s auf den neuen Hauptchat warten.

Bindende Bedingungen:
1. [must-fix] Übergabe-Text (CLI und Oberfläche) wird vor dem Einzäunen entschärft: `<<<ÜBERGABE`/`ÜBERGABE>>>` im Text werden
   gebrochen; die automatische Übergabe enthält keine Strang-Auszüge (nur ID, Titel, Lauf, Status, Ordner; Rückfragen nur Titel
   und Empfehlung). Test mit einem Titel, der `ÜBERGABE>>>` enthält.
2. [must-fix] `POST /api/leitstand/start` nutzt `startLeitstand` unverändert; Tests: Team-Konto 403, ohne Header 403, leer 400,
   zu lang 400, Brücke 403 → Meldung kommt im Dialog an.
3. [must-fix] Neue Hauptchats: Titel „Hauptchat · TT.MM.“, Lesezeichen `Hauptchat`; Erkennung bleibt über `kind: 'leitstand'`;
   alte Lesezeichen bleiben; Brückentext „beendet — der aktuelle steht oben in der Seitenleiste unter Hauptchat“.
4. [must-fix] Mock erkennt alte und neue Vorgabe-Sätze; Brücke- und Web-Tests vollständig grün.
5. [must-fix] UX-Regeln aus den Befunden oben im Bau umgesetzt (Status = Punkt + Wort, Zeilenhöhen, Links mit `aria-current`,
   Gruppenknöpfe mit `aria-expanded`/`aria-controls`, sichtbarer Fokus, Leer- und Fehlerzustand, max. 40 % Höhe mit Scroll).
6. [must-fix] Eingeklappte Desktop-Leiste: Hauptchat-Symbol im Icon-Streifen (nur Admins, nur wenn aktiv), ein Klick öffnet ihn.
7. [must-fix] Nach erfolgreichem Start öffnet sich der neue Hauptchat im selben Fenster und die Seitenleiste lädt sofort neu
   (Ereignis statt Warten auf den Takt).
8. [must-fix] Sichtbar überall „Unter-Chats“ statt „Stränge“ (Abschnitt, Seite, `groupLine`), Tests angepasst.
9. [verify] Bilder vorher/nachher Desktop 1440 + Handy 390: aktiver Hauptchat mit Gruppen, kein Hauptchat, Team-Konto,
   eingeklappte Leiste, Start-Dialog.
10. [verify] Patch 50 auf frischem v0.8.7-Baum: erster Lauf wendet an, zweiter No-op, Client-Build grün.

Stärkster Einwand (bleibt sichtbar): Hauptchat und Unter-Chats stehen weiterhin auch in der normalen Liste (K3) — das Gefühl
„jeder Chat ist gleich“ verschwindet erst ganz, wenn sie dort ausgeblendet sind.

### Runde 2 (Plan nach Einarbeitung) — PASS 0,8

Die Bedingungen 1–10 stehen jetzt im Schnitt (S1/S2) und gelten zusätzlich als DoD 17–26 (in dieser Reihenfolge). Offen
bleiben nur Knuts Entscheidungen K1–K5; gebaut wird mit den Empfehlungen, jede ist mit einer Zeile rückbaubar. Rest-Einwand:
K3 (Doppelte Einträge) — bewusst vertagt.
