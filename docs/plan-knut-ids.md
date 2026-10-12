# Plan: Stabile Kennungen für Knut-Zeilen (`- Knut (<spec-slug>#K<n>):`)

Auftrag Knut, 12.10.2026 (ID-Migration „passt so wie du meinst“). Prozess v4, Abschnitt „Inbox — ein Antwortort“
(`~/work/knut/review-pakete/128-prozess-github/prozess-v4.md`): Antworten aus der Werkbank sollen später sicher in
genau die Zeile zurückfinden, zu der sie gehören — nicht über eine Zeilennummer, die sich bei jeder Vault-Änderung
verschiebt. Branch `feat/knut-ids`, Basis `release/werkbank-2026-10-11d` @ `7fce7f0`. Review-Paket 142.

## Befund (Fundstellen, die heute nur exakt `- Knut:` kennen)

| Stelle | Was sie tut | Betroffen? |
|---|---|---|
| `web/server/roadmap.ts:16` `KNUT` | `parseDecisions`, `fillDecision` (Roadmap → Entscheidungen, Ansetzen, Pre-Plan-Warnung, Heute) | ja — erkennt `- Knut (…):` nicht, Zeile verschwindet aus allen Listen |
| `web/server/fragen.ts:74,82` | Eintragsgrenzen für „Heute“ (`Knut\b`) | nein — `\b` passt auch vor ` (` |
| `web/server/sprint.ts:65` | Sprint-Review/Planning-Antwortzeilen | nein — Migration fasst Sprint-Notizen nicht an |
| `web/server/roadmap.ts:278` `specTemplate` | neue Spec mit `  - Knut:` | nein — Zeile ohne Kennung bleibt gültig, bekommt sie beim nächsten Lauf |
| `/vault/_meta/dist-skill/olaf-produkt-roadmap/scripts/roadmap_check.py:137,152` | zählt leere Knut-Zeilen (B4) | ja — Patch |
| `/vault/_meta/dist-skill/maxenergy-jira/scripts/jira-sync-plan.sh:147` | leeres Kommentarfeld `^[^:]{1,25}:$` | nicht durch die Migration (liest nur Daily/Sprint-Notizen); vorsorglich Patch |
| `/vault/_meta/dist-skill/olaf-produkt-roadmap/scripts/vault-sync-prompt.md:24` | „Knut:-Zeilen nie ausfüllen“ | ja — Satz ergänzen: Kennungen nie ändern/entfernen/neu nummerieren |
| Vorbau (`web/server/vorbau.ts`), `plan-vault-drift.py`, `rank.py`, übrige `jira-*.sh` | kein Knut-Zeilen-Parser | nein |

`~/.claude/skills/olaf-produkt-roadmap` und `~/.claude/skills/maxenergy-jira` sind Symlinks auf
`/vault/_meta/dist-skill/…` — es gibt **einen** Ort; jeder Patch wird genau einmal angewendet.

Vault-Bestand 12.10.: in den Specs (`1-Roadmap/*/{1-Backlog,2-Pre-Plan,3-Plan,4-Review}/*.md`) 208 leere
`- Knut:`-Zeilen in 82 Dateien, im Register `0-Overview/offene-fragen-roadmap-produkt-olaf.md` weitere 175. Es gibt
schon Formen wie `- Knut (29.09.):` und `- Knut (E9):` (datierte Antworten, freie Verweise) — die zählen heute nicht
als Entscheidung und dürfen es auch nachher nicht.

## Entscheidungen (Knut: „passt so wie du meinst“ — hier festgehalten; P statt E, um nicht mit v4-E1…E4 zu kollidieren)

- **P1 Beantwortete Zeilen** behalten ihr Format (keine Kennung). Die Kennung braucht nur, wer eine Antwort
  zurückschreiben will; beantwortete Zeilen sind erledigt, und menschlich geschriebene Zeilen umzuschreiben ist
  vermeidbares Risiko. Wird eine Zeile über die Werkbank beantwortet, bleibt ihre Kennung stehen.
- **P2 Kennung** = Datei-Basename (vault-weit eindeutig, `vault_check.py`) + `#K<n>` (Präfix K: Knut, 12.10.2026 — siehe P5). Strikte Form
  `[a-z0-9][a-z0-9-]*#[A-Z]\d+` — nur so wird `- Knut (…):` als Entscheidung erkannt; `(29.09.)`/`(E9)` bleiben,
  was sie sind. Dateien, deren Name nicht in diese Form passt, überspringt das Skript mit Warnung (heute keine).
  Die Parser lesen jeden Großbuchstaben als Präfix; das Skript vergibt nur K und warnt bei anderem Präfix in
  der Datei (dann bricht `--apply` ab).
- **P3 Nummerierung** je Datei K1…Kn in Dateireihenfolge beim ersten Lauf; danach max+1, wobei „max“ der höchste je
  vergebene Wert ist (Höchststand je Datei in `~/.cache/vault-sync/knut-ids-stand.json`) — eine gelöschte oder
  umgehängte Kennung wird nie neu vergeben. Nie umnummerieren; idempotent. Code-Blöcke werden übersprungen.
- **P4 Register** (`offene-fragen-*`) bekommt **keine** Kennungen (Prozess v4 Z. 55: nur Anzeige). Seine 175
  Antwortzeilen in die Spec umzuhängen oder in Verweise umzuschreiben ist ein eigener Schritt — das ist keine
  mechanische Umformung. Das Skript zeigt nur die Zahl. **Knut, 12.10.2026 (q-0052d5 → a):** nach dem `--apply`
  schlägt ein Agent je Register-Eintrag „in Spec umhängen“ oder „Verweis → `<slug>#K<n>`“ vor; Knut gibt den
  Stapel frei, erst dann wird geschrieben.
- **P5 Präfix K** statt E — **Knut, 12.10.2026 (q-a7ddeb → b).** 14 Specs mit offenen Zeilen nummerieren ihre
  Entscheidungen schon selbst mit „E1…“; `…#E3` hätte dort nicht „E3“ im Text bedeutet.

## Schnitt

1. **Parser** (`web/server/roadmap.ts`): `KNUT` akzeptiert `- Knut:` und `- Knut (<id>):`; `Decision` bekommt
   `knutId: string | null` (nicht `id` — das trägt in `fragen.ts` schon die Register-ID A1/F3 …); `fillDecision`
   behält die Kennung beim Füllen. Tests in `web/test/roadmap.test.ts` und `web/test/fragen.test.ts`.
2. **Migrationsskript** `scripts/knut-ids-migration.py`: `--dry-run` (Standard; je Datei Anzahl + Diff, schreibt
   nichts) und `--apply`. `--apply` bricht ab (nichts geschrieben), wenn
   - der Probelauf Warnungen hat (fremde/doppelte Kennung, ungeeigneter Dateiname),
   - die laufende Werkbank (`~/work/werkbank-dev/web/server/roadmap.ts`, Marker `knutId`) oder `roadmap_check.py`
     (Marker `KNUT_EMPTY`) die Form mit Kennung noch nicht kennen — erzwingt die Reihenfolge,
   - der Sperr-Ordner fehlt oder die Vault-Sync-Sperre (`~/.cache/vault-sync/.lock`) 30 s belegt bleibt.
   Sonst: Sicherungskopie aller zu ändernden Dateien, je Datei tmp+rename nur bei unverändertem Hash, Höchststand
   fortschreiben. Pfadprüfung nach `realpath`. `--root`, `--stand`, `--pruef-*` für Tests.
   Test: `web/test/knut-ids.test.ts` (Wegwerf-Verzeichnis, Gleichlauf mit `parseDecisions`).
3. **Patches** unter `~/work/knut/review-pakete/142-knut-ids/patches/` (roadmap_check.py, jira-sync-plan.sh,
   vault-sync-prompt.md), anzuwenden mit `patch -p1 -d /vault/_meta/dist-skill`.
4. **Probelauf** `--dry-run` gegen den echten Vault → Bericht. **Nicht anwenden** (spielt die Hauptsitzung ein).
5. **Teil 2 nur als Plan** (Abschnitt unten).

Reihenfolge beim Einspielen: Werkbank mit neuem Parser live **und** Skill-Patches eingespielt → Vault-Stand sichern
(Kopie oder Commit) → `--apply`. Das Skript prüft die ersten beiden Bedingungen selbst.

Keine Oberflächen-Änderung: die Kennung wird geparst, aber nicht angezeigt; Frage- und Antworttext bleiben gleich.
Deshalb keine Screenshots und keine UX-Rolle im Council.

## Definition of Done (Prüfsätze)

(Die Parser-Prüfsätze 1–3 nutzen bewusst `#E…`: der Parser liest jedes Präfix; das Skript vergibt K.)

1. `parseDecisions` liefert für `- Knut (x-spec#E3):` eine offene Entscheidung mit `knutId = 'x-spec#E3'`, für
   `- Knut (x-spec#E3): ja` eine beantwortete mit `answer = 'ja'`. (`roadmap.test.ts`)
2. `- Knut (29.09.): …` und `- Knut (E9):` werden nicht als Entscheidung erkannt (wie heute). (`roadmap.test.ts`)
3. `fillDecision` auf eine Zeile mit Kennung ergibt `- Knut (x-spec#E3): <Antwort>` (Kennung und Callout-Präfix bleiben). (`roadmap.test.ts`)
4. „Heute“ (`todayQuestions`) liefert mit Kennungen dieselbe bereinigte Liste wie ohne; die Register-ID bleibt in `id`. (`fragen.test.ts`)
5. `--dry-run` (und ohne Schalter) schreibt nichts (Inhalt und mtime unverändert, kein Höchststand) und gibt je Datei Anzahl und Diff aus. (`knut-ids.test.ts`)
6. `--apply` ändert nur leere `- Knut:`-Zeilen in Spec-Dateien der Zustände 1–4, nummeriert K1…Kn in Dateireihenfolge,
   legt vorher eine Sicherungskopie an, und ein zweiter Lauf ändert nichts. (`knut-ids.test.ts`)
7. Neue leere Zeile → max+1; nach Löschen der höchsten Kennung wird diese nicht neu vergeben. (`knut-ids.test.ts`)
8. Register, 5-Live, Themen-Übersichten, Priorisierung, Sprint-Notizen und Code-Blöcke bleiben unberührt. (`knut-ids.test.ts`)
9. `--apply` schreibt nichts bei Warnungen, fehlender Vorbedingung (Werkbank/roadmap_check) oder belegter Sperre. (`knut-ids.test.ts`)
10. Nach der Migration einer Vault-Kopie: `parseDecisions` je Datei gleich (außer `knutId`), „Heute“ gleich, und der
    gepatchte `roadmap_check.py` meldet auf der Kopie genau das, was der ungepatchte auf dem Original meldet. (Bericht, Gleichlauf-Lauf)
11. `npm test` (web) mit eigener Test-Mongo grün.

## Teil 2 (nur Plan, nicht gebaut): Rückschreiben aus „Heute“

Freigabe an **v4-E3** gebunden (Prozess v4 Z. 57: bis dahin liest die Werkbank Knut-Zeilen nur). Bis dahin aus.

- **Ersetzt die bestehende Route** `POST /api/roadmap/answer` (`web/server/main.ts:1509`): die schreibt heute mit
  `writeFileSync`, ohne Sperre, ohne tmp+rename, über Zeilennummer + Datei-Hash. Ab Teil 2 gibt es genau einen
  Schreibweg; die Roadmap-Seite „Entscheidungen“ nutzt ihn mit. Bis v4-E3 wird die alte Route hinter denselben
  Schalter gelegt (aus) — Teil 2a, eigener kleiner PR, mit Knuts Ja.
- Schalter `WERKBANK_KNUT_WRITEBACK=1` (Standard aus).
- Ziel der Antwort ist die **Kennung**: Anfrage `{ path, knutId, expect: { line, question } }` — `line` die Zeile,
  wie Knut sie gesehen hat (leer + Kennung), `question` der Fragetext aus `parseDecisions`. Server: genau eine Zeile
  mit dieser Kennung (0 oder >1 → Konflikt), Zeile noch byte-gleich `expect.line` **und** Fragetext gleich (schützt
  zusätzlich gegen eine wiederverwendete Kennung, falls der Höchststand je verloren geht) — sonst Konflikt.
  Andere Änderungen der Datei stören nicht (der Gewinn gegenüber dem Datei-Hash heute).
- Schreiben unter `flock ~/.cache/vault-sync/.lock` (`-w 15`), tmp im selben Ordner + `rename`, danach erneut lesen
  und prüfen. **Konfliktanzeige nach dem Muster `roadmapauto.ts`** (sichtbar in „Heute“ mit vorher/jetzt und den
  Knöpfen „neu laden“ / „trotzdem nicht schreiben“), nicht nur ein 409.
- Zeilen **ohne** Kennung (neu angelegt seit dem letzten Lauf): in „Heute“ sichtbar, aber ohne Antwortknopf
  („Kennung fehlt — kommt mit dem nächsten Vault-Sync“).
- **Kennungen für neue Fragen:** `vault-sync.sh` ruft am Ende, noch unter seiner Sperre, `knut-ids-migration.py
  --apply` auf (Skill-Patch, Teil 2). Dazu bekommt das Skript einen Schalter `--unter-sperre` (Sperre nicht selbst
  holen). Alternative ohne Skill-Änderung: Werkbank-Takt ruft es — schlechter, weil die Sperre dann zweimal geholt wird.
- Protokoll in Mongo (`roadmap_answers`: wer, wann, Kennung, vorher/nachher) und Index-Invalidierung wie heute.
- Register (P4): erst nach Knuts Ja zur Register-Umstellung; bis dahin antwortet „Heute“ nur in Specs.
