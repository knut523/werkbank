# Plan 376 — `@fix` mit Freigabe durch den Hauptchat

Auftrag Knut, 02.11.2026 („Release 30a“): „@fix … kannst du es laufen lassen, dann geht es an dich/Hauptchat, du prüfst es und
postest dann, wenn es gut ist." Heute gibt es nur Trockenlauf (`WERKBANK_FIX_DRYRUN`, `trocknen` in prfix.ts) oder
vollautomatischen Push. Neu: ein dritter Modus mit expliziter Freigabe.

**Nachtrag Knut, 02.11.2026:** „Fixes sollten immer ok sein — besonders auf einem offenen PR — solange alle Regeln mechanisch
geprüft sind." → vierter Modus `auto`: Alles Grüne pusht und kommentiert OHNE Klick; fällt eine mechanische Prüfung, geht der
Fix in die Freigabe-Frage (statt abgelehnt zu werden). Der Hauptchat bekommt in beiden Fällen eine Meldung (Audit in
`pr_fix_audit`). Welche Regeln heute NICHT mechanisch geprüft werden, steht im Bericht (Review-Paket).

## Ziel

1. **Modus `WERKBANK_FIX_FREIGABE=on`** (Vorgabe aus): Statt des Trockenlaufs hält der Server den geprüften Stand fest
   (neu-SHA, Kopf-Zweig, PR, Gate-Ergebnis, Testergebnis, `antwort.md` ohne DRY-RUN-Kopf, `fix-diff.patch`) und meldet
   sich mit Paketpfad und klarer Frage im Hauptchat. Zustand am Fix-Doc: `freigabe_frage` (nicht in `LAEUFT`, nicht im
   fixMax-Deckel — abgeschlossene Läufe laufen nie neu an).
2. **Hauptchat-Aktionen „@fix freigeben" / „@fix ablehnen (Grund)"** als neue Werte im `github_schreiben`-Weg
   (githubaktion.ts + githubKarte in der Brücke + `/internal/lead/github-schreiben`), mit Karte + Klick wie der
   bestehende Push, Nachweis über `/internal/aktion-freigabe` (freigabe.ts der Brücke, 15 min, einmalig).
   - **Freigeben**: Synchron werden nur die billigen Bedingungen geprüft (Fix-Doc existiert, `freigabe_frage`, SHA und
     PR-Kopf passen, PR offen, Freigabe-Marke idempotent gesetzt). Den teuren Teil (Tests **neu**, Gate **neu**,
     `pushPruefung` für genau diesen SHA, Push, Delta-Review, Antwort-Kommentar) macht der nächste fixTick — derselbe
     Weg wie bei der Ticket-Kette (jirakette.ts): State-Maschine + Takt, „genau der freigegebene Stand".
   - **Ablehnen**: synchron — Audit-Eintrag, kein Push, optionaler Kommentar-Entwurf im Paket.
3. **`meldeLeitstand`-Fallback** (leitstand.ts): Wenn kein Hauptchat aktiv ist, Meldung nicht still verwerfen, sondern
   als Rückfrage in die Inbox („Braucht dich") legen — Muster `capQuestion` (Fragen in `questions()` erscheinen in der
   Inbox als Rückfrage, z. B. `q-…`, Antwort über `/internal/inbox/antwort`).
4. **`github_schreiben` push** (githubaktion.ts): Basis nicht hart `dev` — aus dem PR bzw. `origin/HEAD` bestimmen
   (BASES-Reihenfolge wie freigabe.ts `repoFakten`); Push an den PR-Kopf-Zweig binden (`zweig === pr.headRefName`)
   und prüfen, dass der PR offen ist.
5. **Test gegen Endlos-Neulaufen**: Eintrag mit Status `trocken` oder `freigabe_frage` wird von `fixTick` nie wieder
   angefasst (fixTick-Schritt 1 greift nur bei `läuft`, Schritt 2 nur bei `wartet`, Reaper nur bei `startet`/`prüft`).
6. **Schreibtoken-Prüfung** (nur lesen, nichts pushen): Hat das Schreibtoken Push-Rechte auf WirStrom1
   (`GET /repos/WirStrom1/olaf-admin` → `permissions.push`)? Ergebnis in den Bericht.

## Definition of Done (wörtlich aus dem Auftrag)

- Ablauf an einem Test-PR in einem knut523-Spielrepo end-to-end gezeigt: `@fix` → `freigabe_frage` → Freigabe im
  Hauptchat → Push + Kommentar. Screenshot der Karte.
- Suite grün (`node --test` mit sauberer Umgebung).
- Plan in `docs/plan-fix-freigabe.md` (diese Datei).
- Bericht nach `~/work/knut/review-pakete/NNN-<slug>/bericht.md` mit YAML-Kopf, Mermaid-Diagramm, Screenshots,
  offenen Entscheidungen, Schaltern für die Live-Schaltung.

## Architektur (nach Lesephase, 02.11.)

### Fix-Status-Maschine (prfix.ts)

```
wartet → startet → läuft → {trocken | freigabe_frage | fertig}   (heute: trocken | fertig, neu: freigabe_frage)
freigabe_frage → (Freigabe) → prüft → gepusht/fertig            (neuer Tick-Schritt)
freigabe_frage → (Ablehnen) → abgelehnt
```

- `fixTrocken()` (prfix.ts:28) bekommt einen Bruder `fixFreigabe(f)`: `env.WERKBANK_FIX_FREIGABE === '1'` und Fix nicht
  schon `trocken`-gelaufen. In `pruefeUndPushe` zweigt bei `fixFreigabe(f)` eine neue `frageStellen()`-Funktion (statt
  `trocknen()`) ab: schreibt `antwort.md` **ohne** DRY-RUN-Kopf, `fix-diff.patch`, Status `freigabe_frage` mit
  `frage: {neu, zweig, pr, gate, tests, at}`, Audit-Eintrag `ergebnis: 'frage'`, melde-Leitstand-Meldung mit Paketpfad
  und Frage. `push` darf wie im Trockenlauf fehlen (der Freigabe-Modus läuft auch ohne Push-Weg bis zur Frage).
- **Neuer Tick-Schritt** in `fixTickInnen` vor Schritt 1 (läuft): Status `freigabe_frage` **und** `f.freigabe` gesetzt
  (Marke der Hauptchat-Aktion; `LAEUFT`-Deckel bleibt außen vor, läuft unter `fixMax`): Claim über `status: 'prüft'`
  (kollisionsfrei, da `freigabe_frage` sonst niemand nimmt), dann `pruefeUndPushe` im Freigabe-Modus mit frischen
  Tests/Gate und geänderten Vorab-Bedingungen: `push`-Weg muss jetzt da sein, Fix-Doc SHA === freigegebener SHA
  (`f.freigabe.neu === neu`, sonst `freigabe_frage` zurücksetzen + melde „Stand hat sich geändert"), PR-Kopf seit der
  Freigabe unverändert (pr.headRefOid === f.freigabe.neu).
- Reaper: `freigabe_frage` NICHT in `LAEUFT` — wird nie reapt, läuft nie neu an (Punkt 5).
- **R30a (auto)**: `fixAuto(f)` (`WERKBANK_FIX_FREIGABE=auto` bzw. `auto`-Marke) ist der Bruder von `fixFreigabe`.
  In `pruefeUndPushe` fragt auto nur bei gefallener Prüfung (`!p.ok` → frageStellen mit den Gründen); ein grüner
  Lauf fällt in den normalen Push-Weg (Push, Audit `gepusht`, Delta-Review, Antwort-Kommentar, `fertig`) plus
  Meldung „Auto-Modus: gepusht …" an den Hauptchat. Ein fehlender Push-Weg macht den Lauf rot („push is not
  configured" → Frage), statt grün durchzufallen.

### Hauptchat-Aktionen (github_schreiben-Weg, kein neues MCP-Werkzeug)

- **Brücke (tools.ts, sessions.ts)**: `github_schreiben` bekommt zwei neue `art`-Werte: `fix_freigeben`,
  `fix_ablehnen`. `classify` bleibt wie `github_schreiben` (confirm nur `ctx.leit`, sonst blocked; orchestratorBlock
  bleibt). `githubKarte` rendert für die neuen Arten eine Karte mit Fix-Daten (Repo, PR, SHA, Punkte) und
  ANSWER_BUTTONS; bei `fix_ablehnen` optionaler Grund als Feld. `sessions.ts`: `freigabeMerken` greift weiter (Bedingung
  `tool === 'mcp__werkbank__github_schreiben' && live.leit` passt unverändert, da wir denselben Werkzeugnamen nutzen).
  Achtung: `freigabeMerken` merkt den **toolInput** — der Hash muss zur Aktion in `/internal/aktion-freigabe` passen;
  daher läuft die Freigabe-Aktion über dieselbe Route wie der Push-Nachweis (bridge server.ts:376), nicht über die
  Fix-Docs.
- **MCP (werkbank-tools.ts)**: `github_schreiben`-Schema um die beiden `art`-Werte erweitern, Parameter
  `fix` (Fix-Doc-ID) und optional `grund` (bei ablehnen). Kein Duplikat von `base` im Schema (bestehender Bug wird
  gleich mitgeschoren). Nur bei `WERKBANK_LEITSTAND === '1'` (bleibt so).
- **Web-Server (githubaktion.ts, main.ts)**: `githubAktion` bekommt für `fix_freigeben`/`fix_ablehnen` einen eigenen
  Zweig vor der bestehenden Push-Logik:
  - `fix_freigeben`: Fix-Doc laden, billige Checks (Status `freigabe_frage`, Freigabe-Marke via
    `$set: {freigabe: {...}, status: 'wartet_auf_fix_tick'}` — nein: einfacher, Fix-Doc-Feld `freigabe` setzen und
    Status bei `freigabe_frage` lassen; der Tick nimmt ihn), idempotent, `push`-Weg muss konfiguriert sein. Antwort:
    `{ok, gestartet}`. Der teure Teil läuft im fixTick.
  - `fix_ablehnen`: Fix-Doc `status: 'abgelehnt'`, `ablehnGrund`, Audit, optionaler Kommentar-Entwurf im Paket
    (`ablehnung.md`). Synchron fertig.
  - Beide brauchen den Klick-Nachweis: `nachweis`-Weg (`/internal/aktion-freigabe`) wie beim Push — prüfen, dass die
    Aktion (inkl. fix-ID und SHA) hash-gleich ist mit der Karte in der Brücke.
- **MeldeRückweg**: Wenn der fixTick nach Freigabe fertig ist (push oder Grund), meldet `meldeLeitstand` (Punkt 3
  sichert den Inbox-Fallback ab).

### Punkt 4: github_schreiben push — Basis aus dem PR/origin statt hart `dev`

- `pruefeAktion` (githubaktion.ts:45): `base` nur noch als Fallback, wenn der PR keine Basis verrät. Neuer Weg `pr` im
  Wege-Interface: liefert PR-Lage (headRefName, baseRefName, state, headRefOid) — in main.ts über `prLageVia` mit dem
  Lesetoken. Vorrang: PR-Basis (`baseRefName`) → `origin/HEAD`-Erkennung (BASES wie freigabe.ts: develop, dev, main,
  master) → Parameter `base` → 'dev'.
- `fuehreAus` push: `zweig` muss `pr.headRefName` entsprechen (sonst 409), `state` muss `OPEN` sein (sonst 409). Gate
  läuft gegen die ermittelte Basis.

### Punkt 3: meldeLeitstand-Inbox-Fallback

- `meldeLeitstand` (leitstand.ts:182-190): Bei `!leit` statt `return false` eine Rückfrage anlegen — Muster
  `capQuestion` (leitstand.ts:495-510): `questions().insertOne` mit `kind: 'leitstand-meldung'`, `title` =
  gekürzter Meldungstext, `options: [{label: 'Gelesen'}]`, `recommendation` mit Hinweis auf Paket/Strang, `strand` aus
  `d` (falls Strang-Doc, sonst null), `link` null. Höchstens eine offene je `kind` + Quelle (Vermeidung Inbox-Flut) —
  wir legen je `_id` der Quelle (`d._id`) nur eine offene an (`findOne({userId, kind, 'quelle.id': d._id, status:
  'offen'})`). Erscheint in der Inbox als `q-…`-Eintrag (Rückfrage), beantwortbar über die Buttons. Rückgabewert
  bleibt `false` („nicht zugestellt"), Caller melde ok.
- `hinweisFreigabe`/`hinweisMelious` bleiben still (nur meldeLeitstand ändern — der Auftrag nennt nur diese).

### Punkt 6: Schreibtoken-Prüfung

- GET `https://api.github.com/repos/WirStrom1/olaf-admin` mit dem Schreibtoken (Header wie `writeToken`), Auswertung
  `permissions.push`. Keine Schreibaktion, nur lesen. Ergebnis in den Bericht. (Zugangsdaten sind im Strang gesperrt —
  der Check läuft im Rahmen der isolierten Testinstanz über den Server-Code bzw. als dokumentierter Ein-zeiler für
  die Live-Umgebung.)

## Schnitte (Reihenfolge)

| Schnitt | Datei(en) | Inhalt |
|---|---|---|
| S1 | web/server/prfix.ts | `fixFreigabe`, `frageStellen`, Tick-Schritt für freigabe_frage+freigabe-Marke, `LAEUFT`-Test |
| S2 | web/server/githubaktion.ts, web/server/main.ts | Aktionen fix_freigeben/fix_ablehnen (billig synchron), Wege `pr`, Basis aus PR/origin (Punkt 4) |
| S3 | claude-bridge/src/tools.ts, sessions.ts, web/mcp/werkbank-tools.ts | Karten für fix_freigeben/fix_ablehnen, Schema, freigabeMerken unverändert |
| S4 | web/server/leitstand.ts | meldeLeitstand-Inbox-Fallback (Punkt 3) |
| S5 | web/test/*.test.ts | Tests je Schnitt + Punkt-5-Endlostest |
| S6 | E2E-Demo | isolierte Instanz, Spielrepo-PR, Screenshots, Bericht |

## Tests

- Bestehendes Muster aus `test/prfix.test.ts`: eigene Mongo-DB je Datei (`werkbank_test_fix_<hex>`), env vor dem
  dynamischen Import setzen, störende Schalter löschen, `after` drop + close + `process.exit(0)`.
- Neu: freigabe_frage-Zustand (frageStellen schreibt antwort.md ohne DRY-RUN-Kopf, fix-diff.patch, Statusfelder);
  fixTick greift freigabe_frage nur mit Marke; ohne Marke nie (Punkt 5: auch `trocken` nie); Endlostest: fixTick mit
  Einträgen in `trocken`/`freigabe_frage` → started/done bleiben 0; githubaktion: Basis aus PR, Zweig-Bindung,
  PR-offen-409; leitstand: Fallback legt question an, wenn kein aktiver Leitstand.
- Suite: `env -i HOME=$HOME PATH=$PATH … node --test test/*.test.ts`; schwere Läufe (npm ci, Build, ganze Suite) nur
  mit `flock /tmp/olaf-schwer.lock`.

## Nicht-Ziele

Kein Merge, kein Force, kein Push auf die Basis. Der @fix-Strang bekommt weiterhin kein GitHub. Kein automatisches
Live-Schalten: alle neuen Wege hinter `WERKBANK_FIX_FREIGABE` (Vorgabe aus) bzw. bestehende Schalter. Kein Verstoß
gegen die Sperrliste (GitHub push/PR, Jira/Confluence-Schreiben, Git-Config, Hooks, .claude/, .env). Der E2E-Push
läuft über die Pipeline der isolierten Instanz (pushVia mit Schreibtoken) — das ist der zu demonstrierende Ablauf,
kein manueller Push von mir.

## E2E-Demo (DoD-Punkt 1)

1. Isolierte Instanz per `scripts/isoliert.sh` — Achtung: `WERKBANK_NO_JOBS=1` unterbindet `backgroundJobs()` und
   damit den fixTick. Für die Demo die Instanz **ohne** NO_JOBS starten, damit der fixTick im 60-s-Takt läuft
   (eine Route wie `/api/leitstand/ticker/jetzt` gibt es für fix nicht).
2. Spielrepo knut523/r30-demo o. ä. mit offenem PR; `WERKBANK_FIX_ORGS` der Instanz um die Demo-Org erweitern.
3. Ablauf: `@fix`-Kommentar → fixTick → Strang → `freigabe_frage` (WERKBANK_FIX_FREIGABE=on) → Karte im Hauptchat
   (Screenshot) → „@fix freigeben" → fixTick: Tests/Gate neu → pushPruefung → Push + Kommentar (Screenshot) →
   Delta-Review eingereiht.
4. Screenshots: Karte (Freigabe-Frage), gepushter Kommentar am PR.

## Schalter für die Live-Schaltung (für den Bericht)

| Schalter | Vorgabe | Wirkung |
|---|---|---|
| `WERKBANK_FIX_FREIGABE` | `off` | `1`/`on`: `@fix` endet in `freigabe_frage` statt Trockenlauf/Push — Push erst nach „@fix freigeben". `auto` (R30a): grüner Lauf pusht und kommentiert ohne Klick; roter Lauf endet in der Freigabe-Frage statt in der Ablehnung |
| `WERKBANK_LEITSTAND` | (bestehend) | `github_schreiben`-Tool (Lead) — nötig für die Freigabe-Karte |
| `WERKBANK_HAUPTCHAT_GITHUB` | (bestehend) | github_schreiben-Route im Hauptchat |

Rangfolge: Trockenlauf (`WERKBANK_FIX_DRYRUN`) > Freigabe-Modus (`1`/`on`, bzw. `frage`-Marke am Eintrag) > Auto-Modus
(`auto`, bzw. `auto`-Marke am Eintrag) > Vorgabemodus. Die Marken setzt `queueFixes` beim Einreihen; sie zählen
weiter, wenn der Schalter während des Laufens ausgeht.

### Auto-Modus im Detail (`WERKBANK_FIX_FREIGABE=auto`, R30a — Nachtrag Knut, 02.11.2026)

- **Grüner Lauf** (pushPruefung ok): direkter Push auf den PR-Kopf-Zweig, Antwort-Kommentar, Delta-Review, Audit
  `gepusht`, Status `fertig` — derselbe Weg wie der Vorgabemodus, ganz ohne Klick. Meldung an den Hauptchat:
  „Auto-Modus: gepusht … alle mechanischen Prüfungen grün".
- **Roter Lauf** (irgendeine Prüfung fällt): `freigabe_frage` mit den Gründen statt `abgelehnt` — Knut sieht die
  Gründe (Meldung „Auto-Modus, aber … nicht freigabefähig: … — freigeben?") und kann freigeben; `freigabeLauf` prüft
  danach alles NEU (Tests/Gate/frischer PR), die Freigabe ist kein Vertrauensvorschuss auf den alten Lauf.
- **Mechanische Prüfungen** (alle aus `pushPruefung`, keine neue Logik): PR offen, kein Fork (`crossRepo`), Zweig
  nicht geschützt (`GESCHUETZT`), Kopf unverändert/Fast-forward (kein Force), Tests im Worktree grün, Pre-Push-Gate
  0 harte Befunde (`gate.hart === 0`), Git-Config des Klons unverändert (`configSicher`), kein Geheimnis im
  Antwort-Text (`GEHEIM`), Commit-Regeln über die harten Gate-Regeln (kein `next-env.d.ts`, keine `.env`).
- **Fehlender Push-Weg** im Auto-Modus: Der Strang startet trotzdem und endet mit Grund „push is not configured" in
  der Frage (nicht still übersprungen).
- Was dabei NICHT mechanisch geprüft wird (Checklisten-Punkte des Gates nur Warnung, Sprach-/Glossar-Regeln,
  Co-Authored-By-Trailer, Geheimnis-Scanner nur für Kommentar-Text, secrets in Workflows nur Warnung): Liste im
  Bericht — dort ist entschieden, was hart werden muss.

Bestehende Schalter unverändert: `WERKBANK_FIX_DRYRUN`, `WERKBANK_FIX_ORGS`, `WERKBANK_FIX_MAX`, `autoFix`,
`allow`-Liste des Tickers.
