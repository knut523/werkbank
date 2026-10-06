---
titel: Werkbank — Auto-Modus (P1) und mehrere Claude-Konten je Person
stand: 06.10.2026
owner: Knut
zweig: feat/auto-modus-und-konten (von dev)
quelle: review-pakete/71-werkbank-auto-multi/plan.md, Abschnitte 1, 2, 4 P1
---

# Auto-Modus und mehrere Claude-Konten

## Ziel

- **A — Auto-Modus:** In Knuts Werkbank-Chats laufen Bash und Edits **im eigenen Arbeitsordner** ohne „ja“; ein
  Klassifikator-Modell (SDK-Modus `auto`) entscheidet. Vault, Jira und GitHub bleiben wie heute (bestätigen bzw.
  gesperrt). Not-Aus: `BRIDGE_PERMISSION_MODE=default` gibt exakt das heutige Verhalten.
- **B — Mehrere Claude-Konten je Person:** Eine Person hinterlegt mehrere Claude-Konten (je ein Token aus
  `claude setup-token`) mit Namen und Reihenfolge. Ist das Kontingent des aktiven Kontos ausgeschöpft
  (`rate_limit`), übernimmt das nächste Konto **dieselbe Anfrage**, sichtbar als Statuszeile. Wie `cswap auto`.

## Entscheidungen (Knut, 06.10.2026)

| # | Frage | Entscheidung |
|---|---|---|
| E1 | Was läuft ohne „ja“? | (1) Nur Bash/Edit im eigenen Arbeitsordner → Klassifikator. Vault- und Jira-Schreiben bleiben `confirm`, GitHub-Sperren bleiben. |
| E2 | Für wen? | (1) Nur Knut: `BRIDGE_AUTO_EMAILS`, Vorgabe in `start.sh` `knut.peters@maxenergy.at`. |
| E3 | Sandbox / Unix-Nutzer | vorerst nichts (keine sudo-Installation). Auto bleibt Knut-only. |
| — | Einschalten | „switch it on automatically“: `start.sh` setzt `BRIDGE_PERMISSION_MODE` standardmäßig auf `auto`; `BRIDGE_PERMISSION_MODE=default` ist der Not-Aus. |

## Stand heute (dev, bbda5e5)

- `claude-bridge/src/sessions.ts:441` — `permissionMode: 'default'` fest.
- `sessions.ts:268-290` (`makeGuard`) — der PreToolUse-Hook entscheidet **jedes** Werkzeug selbst (`allow`/`deny`, bei
  `confirm` blockierend bis zur Antwort im Chat). Ein Klassifikator käme nie zum Zug.
- `sessions.ts:443-449` — `canUseTool` ruft denselben Wächter (zweite Sicherung).
- `sessions.ts:281` — Board-Lauf `readonly` lehnt alles Schreibende im Hook ab.
- `claude-bridge/src/tools.ts:8,34-60` — drei Klassen `read` / `confirm` / `blocked`; `BASH_BLOCKED` `:22-32`.
- `claude-bridge/src/claudehome.ts:243-257` (`ensureHome`) — verlinkt nur `CLAUDE.md` und Skills; keine `settings.json`.
- `scripts/start.sh:38-41` — Umgebung der Brücke; Knut läuft geteilt (`BRIDGE_CLAUDE_CONFIG_SHARED`).
- `sessions.ts:180` — `rate_limit` wird nur als Text gemeldet („Kontingent ausgeschöpft“), kein Wechsel.
- `sessions.ts:418` — genau ein Token je Zug: `env.CLAUDE_CODE_OAUTH_TOKEN = req.token` (aus LibreChats
  `user_provided`-Schlüssel des Endpunkts „Claude Code“, `server.ts:192-193`).
- `web/server/creds.ts:30-55` — Claude-Token liegt im LibreChat-Schlüsselspeicher (AES-CBC, `CREDS_KEY`); Jira-Token in
  `werkbank.creds`, AES-256-GCM (`seal`, `web/server/crypto.ts:185`).
- `web/src/pages/Setup.tsx:178-198` — Einrichtung: ein Claude-Token (Speichern/Ersetzen/Trennen).
- SDK 0.3.284: `PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'`
  (`sdk.d.ts:2471`); `canUseTool` bekommt `toolUseID` und `decisionReason` (`sdk.d.ts:213-300`);
  `system/permission_denied` und `result.permission_denials` (`sdk.d.ts:5444-5480`); `rate_limit_event` mit
  `resetsAt` (`sdk.d.ts:5570-5590`); Fehlerart `rate_limit` (`sdk.d.ts:3678`).

## Entwurf A — Auto-Modus

1. `tools.ts`: neue Klasse **`auto`**. `classify(tool, input, { workDir })`:
   - `Write`/`Edit`/`MultiEdit`/`NotebookEdit`: `auto`, wenn der Pfad (relativ zum Arbeitsordner aufgelöst, **mit
     realpath** des tiefsten existierenden Vorfahren — ein Symlink im Arbeitsordner auf `/vault` zählt als Vault) im
     Arbeitsordner liegt und nicht unter `/vault`. Sonst `confirm`.
   - `Bash`: `BASH_BLOCKED` gewinnt (`blocked`). Sonst `auto`, außer der Befehl nennt den Vault, `.runtime`,
     `.config/vw`, `.ssh`, `.credentials`, `bw`, `sudo`, Atlassian/Jira — dann `confirm` (Heuristik; die eigentliche
     Grenze bleibt der Klassifikator plus `hard_deny`).
   - Ohne `workDir` (Not-Aus, nicht freigeschaltet, alle bisherigen Aufrufer): nie `auto` → heutiges Verhalten.
2. `sessions.ts`: `autoFor(req)` → `'auto'`, wenn `BRIDGE_PERMISSION_MODE=auto`, die E-Mail in `BRIDGE_AUTO_EMAILS`
   steht und es kein `readonly`-Lauf ist; `readonly` → `'dontAsk'` (nur wenn `BRIDGE_PERMISSION_MODE=auto`); sonst
   `'default'`.
   - **Entscheidung `dontAsk`:** Der Wächter lehnt im `readonly`-Lauf weiterhin alles Schreibende selbst ab und erlaubt
     Lesendes ausdrücklich (Hook-`allow`). `dontAsk` ist nur die zweite Schicht: Was den Hook ohne Entscheidung passiert,
     wird abgelehnt statt erfragt. Im Not-Aus (`default`) bleibt der Board-Lauf exakt wie heute.
   - `makeGuard`: Klasse `auto` im Auto-Modus → **keine Entscheidung** (`{}`), der Klassifikator entscheidet.
     Eskaliert er, ruft das SDK `canUseTool` → der Wächter behandelt den Aufruf als `confirm` und stellt die
     Rückfrage im Chat, mit dem Grund des Klassifikators („Der Auto-Modus fragt nach: …“).
   - Statuszeile **„🤖 automatisch erlaubt: …“** beim Ergebnis eines automatisch erlaubten Aufrufs (Chat + Log
     `auto erlaubt`); **„🛑 Auto-Modus hat abgelehnt: …“** bei `system/permission_denied`; `result.permission_denials`
     (nur Werkzeugnamen, keine Argumente) ins Log `turn end`.
   - Flag-Settings nur im Auto-Modus: `permissions.deny` (Push/Merge/`gh pr`/`gh api`/`bw`, Lesen fremder
     Konfigurationen und `.credentials.json`, `.env*`, `~/.ssh`, `~/.config/vw`) und
     `disableBypassPermissionsMode`. **Keine** Deny-Regel für den Vault — Deny schlägt Hook-„allow“, sonst ginge
     Vault-Schreiben auch nach „ja“ nicht mehr.
3. `templates/claude/settings.json` mit `permissions.deny` und `autoMode` (`hard_deny`, `soft_deny`, `environment`);
   `ensureHome` verlinkt sie wie `CLAUDE.md`, **ohne** eine vorhandene Datei zu überschreiben. Gilt für Konfigurationen
   je Person. Knuts geteilte Konfiguration (`~/.claude/settings.json`) wird nicht angefasst — Vorschlag im README.
4. `scripts/start.sh`: `BRIDGE_PERMISSION_MODE="${BRIDGE_PERMISSION_MODE-auto}"`,
   `BRIDGE_AUTO_EMAILS="${BRIDGE_AUTO_EMAILS-knut.peters@maxenergy.at}"`. Im Code ist die Vorgabe `default` bzw. leer
   (wer die Brücke ohne `start.sh` startet, bekommt das heutige Verhalten).
5. README-Abschnitt „Auto-Modus“.

## Entwurf B — mehrere Claude-Konten

- **Speicher** (Web, Mongo `werkbank.creds`, ein Dokument je Person): `claudeAccounts: [{ id, label, token: seal(…),
  last4, addedAt }]` (AES-256-GCM wie der Jira-Token) und `claudeOrder: [ids]`. Der bestehende LibreChat-Schlüssel
  ist der Eintrag **`chat`** („Chat-Schlüssel“) — er bleibt, wo er ist, und ist ohne weitere Konten das einzige Konto
  (nichts ändert sich für bestehende Nutzer). Höchstens 5 weitere Konten.
- **API** (Sitzung + CSRF-Header wie alle Einrichtungsrouten): `GET /api/setup/claude-accounts` (nur Name, `••••` +
  letzte 4 Zeichen, Herkunft, Zustand aus der Brücke), `POST` (hinzufügen, Formatprüfung wie heute),
  `DELETE /:id`, `PUT /order`, `POST /:id/test`. Tokens kommen nie zurück zum Browser, nie ins Log.
- **Brücke ↔ Web:** `POST /internal/claude-accounts` (interner Token, wie `session-start`) liefert der Brücke die Konten
  in Reihenfolge mit Klartext-Token; `chat` ohne Token (die Brücke nimmt den von LibreChat gesendeten). Fällt das aus,
  läuft der Zug wie heute mit dem einen Token.
- **Wechsel** (`sessions.ts`): erstes Konto, das nicht als erschöpft vermerkt ist. Meldet ein Versuch `rate_limit`
  (Fehlerart der Assistenz-Nachricht oder 429/„rate limit“ im Abbruch), wird das Konto bis `resetsAt` aus dem
  `rate_limit_event` (sonst 1 h) als erschöpft vermerkt und dieselbe Anfrage mit dem nächsten Konto wiederholt:
  - noch nichts passiert (kein Text, kein Werkzeug) → derselbe Prompt, dieselbe Ausgangslage (`resume` wie zuvor);
  - schon mitten im Zug → Fortsetzen der Sitzung mit „mach genau dort weiter“ (keine Werkzeuge doppelt).
  - Statuszeile **„↻ Konto „Privat“ übernimmt (Kontingent von „Firma“ ausgeschöpft)“**. Alle erschöpft → die
    heutige `rate_limit`-Meldung. Sind alle als erschöpft vermerkt, wird das mit dem frühesten Reset einmal versucht.
  - `overloaded` wechselt **nicht** (Server-Engpass, ein anderes Konto hilft nicht).
  - Zustand je Person (Konto-ID → erschöpft bis) in `.runtime/bridge/claude-accounts.json`, ohne Geheimnisse,
    übersteht Neustarts. Der nächste Zug beginnt auf dem funktionierenden Konto.
- **Konfigurationsverzeichnis:** alle Konten einer Person teilen `.runtime/claude/<id>` (Skills, `CLAUDE.md`,
  Atlassian-OAuth, Sitzungsverläufe — Fortsetzen mit dem anderen Konto geht nur so). Es unterscheidet sich nur
  `CLAUDE_CODE_OAUTH_TOKEN`.
- **Testen:** `POST /internal/account-test` in der Brücke: ein Minimalzug (`maxTurns: 1`, keine Werkzeuge, keine
  MCP-Server) mit genau diesem Token → `ok` / `rate_limit` / `auth` / Fehler. Kostet einen winzigen Modellaufruf auf
  dem Konto.

## Scheiben

1. Plan (diese Datei).
2. A1 `tools.ts` Klasse `auto` + Unit-Tests (rot zuerst).
3. A2 `sessions.ts` `autoFor`, Hook-Durchreichen, Eskalation, Statuszeilen, Denials im Log; Mock spielt den
   SDK-Rechteweg (Hook → Modus → Klassifikator → `canUseTool`) nach; Tests.
4. A3 `templates/claude/settings.json` + `ensureHome`; Flag-Settings; `start.sh`; README.
5. B1 Brücke: Kontenliste über den internen Kanal, Wechsel bei `rate_limit`, Zustand, Kontotest; Tests.
6. B2 Web: Speicher, API, interner Endpunkt; Tests.
7. B3 Einrichtung (Setup.tsx): Konten hinzufügen/entfernen/umsortieren/testen; Build.
8. README, Gates.

## DoD (wörtlich abzuhaken)

A — Auto-Modus
- [x] Im Mock erscheint bei `ls` und bei einem Edit im Arbeitsordner keine Rückfrage; stattdessen „🤖 automatisch erlaubt: …“ im Chat.
- [x] Vault-Edit fragt weiter nach (Test).
- [x] Jira-Kommentar fragt weiter nach (Test).
- [x] `git push` bleibt gesperrt (Test).
- [x] Eskalation des Klassifikators → Rückfrage im Chat mit Grund; Ablehnung → „🛑 Auto-Modus hat abgelehnt“ (Test).
- [x] Ein Symlink im Arbeitsordner auf den Vault zählt als Vault (Test).
- [x] Mit `BRIDGE_PERMISSION_MODE=default` ist das Verhalten exakt wie heute (Test: Modus `default`, Rückfrage bei `ls`).
- [x] Nicht freigeschaltete Personen bleiben im Modus `default` (alle bisherigen Brückentests grün, Test).
- [x] Board-`readonly` lehnt weiter alles ab (Test, auch im Auto-Modus).
- [x] `permission_denials` stehen im Log.
- [x] `templates/claude/settings.json` wird verlinkt, eine vorhandene Datei bleibt unangetastet (Test).
- [x] `start.sh` setzt `BRIDGE_PERMISSION_MODE` (Vorgabe `auto`) und `BRIDGE_AUTO_EMAILS` (Vorgabe Knut).
- [x] README-Abschnitt „Auto-Modus“ inkl. Risiko „Abo/Modell ohne Auto-Modus → ersten echten Zug prüfen“.

B — mehrere Konten
- [x] Wechsel auf das nächste Konto bei `rate_limit` innerhalb derselben Anfrage, mit Statuszeile (Test).
- [x] Alle erschöpft → heutige `rate_limit`-Meldung (Test).
- [x] Das aktive Konto wird gemerkt: der nächste Zug beginnt auf dem funktionierenden Konto (Test).
- [x] Tokens nie im Log und nie in Antworten an den Browser (Tests: Log der Brücke, API-Antworten).
- [x] Einrichtungs-API: hinzufügen, auflisten (maskiert), entfernen, umsortieren, testen (Tests).
- [x] Interner Endpunkt nur mit internem Token (Test).
- [x] Bestehende Nutzer mit nur dem LibreChat-Schlüssel: unverändert (Liste zeigt nur `chat`, Brückentests grün).
- [x] Einrichtung zeigt die Konten (Build grün).

Gates
- [x] `scripts/werkbank.sh test` bzw. beide Testsuiten grün, `vite build` grün.
- [x] README nachgezogen.

## Risiken

- **Abo/Modell ohne Auto-Modus:** Kann Knuts Konto oder Modell auf der VM keinen Auto-Modus, meldet die CLI einen
  Modus-Fehler oder fällt auf Rückfragen zurück. **Beim ersten echten Zug prüfen** (Statuszeilen „🤖“ erscheinen?
  Log `turn start … permissionMode: auto`). Not-Aus: `BRIDGE_PERMISSION_MODE=default scripts/werkbank.sh restart`.
- **Bash-Umgehungen** der Regexe (Skript, das pusht; `curl` mit Token) fängt nur der Klassifikator plus `deny`/
  `hard_deny`. Ohne Unix-Trennung (E3) bleibt das Restrisiko beim VM-Eigentümer — darum nur Knut.
- **Geteilte Konfiguration (Knut):** Die Vorlage `settings.json` greift nur für Konfigurationen je Person. Für Knut
  gelten die Flag-Settings der Brücke (`permissions.deny`) und seine eigene `~/.claude/settings.json` (`autoMode`).
- **Kontowechsel mitten im Zug:** Wiederaufnahme mit „mach dort weiter“ — das Modell kann einen Schritt doppelt
  ansetzen; Schreibendes läuft dabei wieder durch den Wächter.
- **Mehrere Konten = mehrere Abos einer Person:** Die Nutzungsbedingungen der Konten liegen bei der Person.
- **Klartext-Token über den internen Kanal** (nur 127.0.0.1, interner Token) — wie heute LibreChat → Brücke.

## Stand (06.10.2026, abends)

Alles oben gebaut und abgehakt, lokal auf `feat/auto-modus-und-konten`, nichts gepusht, nichts auf der laufenden
Werkbank. Abweichungen vom Entwurf:

- **Deny-Regeln nicht in `templates/claude/settings.json`**, sondern als Flag-Settings je Zug nur im Auto-Modus
  (`AUTO_DENY` in `tools.ts`): Nutzer-Settings gälten auch im Not-Aus und für Personen ohne Auto-Modus — das hätte den
  Not-Aus „exakt wie heute“ gebrochen (z. B. `gh api` auch nach „ja“ gesperrt). Die Vorlage trägt nur `autoMode` und
  `disableBypassPermissionsMode` (beide außerhalb des Auto-Modus wirkungslos).
- Fehlt der Chat-Schlüssel in der Kontenliste der Werkbank, hängt die Brücke ihn **hinten** an (nicht vorn).
- Nebenbei: `web/test/jira-mock.ts` PM-331 fällig 2099 statt 2026-10-02 — der Board-Filter-Test war seit 03.10. rot.
- Offen / beim ersten echten Zug prüfen: Auto-Modus mit Knuts Abo und Modell auf der VM (Log `permissionMode: auto`,
  Statuszeile „🤖“); Kontowechsel mit echten Konten (die Fehlerform `rate_limit` ist aus den SDK-Typen, nicht aus einem
  echten Lauf).
