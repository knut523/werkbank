# Plan 286 — `@fix` im Workspace

Auftrag Knut, 21.10.2026: „Ein @fix von Christoph soll dich beauftragen, einen Fix zu machen … und dann auch auf GitHub zu
spielen – halt nur auf dev." Gemeint: auf den Zweig des PRs (Basis bleibt unberührt), nie mergen, nie neue PRs.

## Ablauf

1. **Ticker** (`prticker.ts`): `@fix` (eigene Regex `FIX_TAG`, Wortgrenze wie `@review`) in PR-Kommentaren, Review-Texten
   und Inline-Kommentaren von Personen auf der Erlaubtliste, PR offen → Ereignis `fix:<id>`. Der Text nach `@fix` ist der
   Auftrag (bei Inline-Kommentaren mit Datei:Zeile); ohne Text = alle offenen Punkte des letzten Reviews dieser Person.
2. **Warteschlange** `pr_fixes` (eine Kennung je Kommentar), nur mit Schalter „@fix erlaubt" (`autoFix`, Vorgabe an), Besitzer
   des Auto-Reviews und Repo in `WERKBANK_FIX_ORGS` (Vorgabe `WirStrom1`).
3. **Fix-Takt** (`prfix.ts`, neben dem Review-Takt, eigener Deckel `WERKBANK_FIX_MAX`, Vorgabe 1):
   - Vorab: PR offen, nicht aus einem Fork, Kopf-Zweig nicht geschützt — sonst gar kein Strang.
   - Worktree vom PR-Kopf im Review-Klon, Paket `NNN-fix-<repo>-<n>` mit Kontext, Diff und Auftrag; Strang (Profil bauer,
     ohne GitHub): Tests zuerst, Fix, je Punkt ein Commit, `fix.json` mit Punkt/Stand/Commit/Beleg.
   - Danach prüft der **Server** selbst: Tests im Worktree (Adapter der Deep-Reviews, leere Umgebung), Pre-Push-Gate
     (`$WERKBANK_REGEL_DIR/pre-push-gate.sh`, 0 harte Befunde), lokale Git-Config unverändert, Fast-forward.
4. **Push nur, wenn alles stimmt** (`pushPruefung`, rein): Ziel = Kopf-Zweig des PRs · Fast-forward und Kopf seit dem Start
   unverändert · Zweig nicht main/master/develop/dev/release/* und nicht die Basis · PR offen, kein Fork · Repo erlaubt ·
   Gate grün · Tests grün · mindestens ein Commit · Schalter an · Auftraggeber auf der Liste. Push ohne Force mit dem
   Schreibtoken (Credential-Helper ohne `GIT_VW_READ`) über einen Helper, der nur `github.com/<repo>.git` bedient. Sonst:
   Status-Kommentar mit Grund + Hauptchat-Meldung.
5. **Danach**: Antwort-Kommentar (englisch, Punkt für Punkt mit SHAs aus dem gepushten Bereich), Delta-Review eingereiht
   (`trigger: 'fix'`), Audit-Eintrag `pr_fix_audit` je Push-Entscheidung (wer, PR, SHAs, Gate, Tests, Gründe).

## Nachgeschärft nach der Gegenprüfung (Pass C)

Config des Klons unmittelbar vor dem Push erneut prüfen und `http.proxy`/`sslVerify` beim Push festnageln; `extensions.worktreeConfig`
nicht mehr erlaubt; geschützte Zweige um `releases/*`, `release-*`, `development`, `trunk` erweitert; Gate verlangt zusätzlich 0 harte
Befunde auch bei Exit 0; Erwähnungen in allen Texten aus dem PR/Strang entschärft; eigene Workspace-Kommentare lösen nie aus;
Übergang `startet → läuft` nur aus `startet`; „schon gepusht“ wird vor dem Antwort-Kommentar vermerkt; ohne Push-Weg, Gate oder
Testausführung startet gar kein Strang.

## Nicht-Ziele

Kein Merge, kein Push auf die Basis, keine neuen PRs, kein Force, keine Forks. Der Strang selbst bekommt kein GitHub.

## Tests

`test/prfix.test.ts`: Regex, Ereignisse, Einreihen, alle Verbots-Fälle der Push-Prüfung rot, Status-Zeilen, Antwort-Kommentar,
Ende-zu-Ende mit Fake-GitHub (lokales Bare-Repo als Remote, Fake-Strang, Fake-API).
