# Plan — G0 Prüfung vor dem Bau + täglicher Abgleich (Plan 127)

**Status:** PLAN ONLY (11.10.2026), noch kein Code. Prozess v4 — Council Runde 4: **PASS (0,75)**, 11.10.2026; Bedingungen = DoD 20–26.
**Freigabe Knut 11.10.:** Abgleich mit GitHub „passt“; „regelmäßig + Teil von plan-to-pr“.
**branch:** feat/vorbau-check · **Repos/Orte:** knut523/werkbank (Skript + Aufruf beim Bau-Start + Nachtbau), Vault-Team-Skill olaf-produkt-roadmap (`/vault/_meta/dist-skill/…/plan-vault-drift.py`, Cron 06:45 → 06:30), `~/bin/dienste` (Ziel `daily-debrief/morgen-<datum>.md`), `~/bin/git-credential-vaultwarden` (`ITEM_READ`).

## Warum
08.10.: Gebautes wurde neu gebaut, weil niemand vor dem Bau prüfte, ob die Spec schon auf develop oder in einem fremden PR liegt.
Ein Morgenbericht allein reicht nicht (Council R1): es braucht einen Stopp vor dem Bau.

## Schnitt
1. `scripts/vorbau-check <slug> [--plan DATEI] [--repos …]` → JSON `{ergebnis: frei|fortsetzen|treffer, belege:[…], hinweise:[…]}`.
2. Aufruf beim Werkbank-Bau-Start (`orch start --code`, Karten-Agent „Agent ansetzen“) und im Nachtbau (Aufrufer: der Nachtlauf, der approved Items startet — im Bau benennen; neuer Strang-Zustand `blocked_g0`). Treffer → kein Start, Rückfrage.
3. Abschnitt „Schon gebaut / baut jemand / nur lokal“ in `plan-vault-drift.py`, Cron 06:30, über alle Specs in 3-Plan/4-Review.
4. Kanal drift.py → Werkbank `questions/ask` mit neuem Feld `key` (`<slug>#G0`); Server lehnt offene oder beantwortete Schlüssel ab (+ Warteschlangendatei, max. 5/Tag).
5. Erprobung des generischen plan-to-pr-Absatzes „Phase 2.5b“ in der Werkbank-Agentenanweisung und im Skill olaf-produkt-roadmap.

## Definition of Done (Prüfsätze)
1. Fixture A: gemergter fremder Code-PR mit Head-Branch = `branch:` des Plans auf `origin/HEAD` des Repos → `treffer` mit SHA.
2. Fixture B: Slug als Branch eines offenen fremden PRs → `treffer` mit PR-Link.
3. Fixture C: frischer Slug → `frei`.
4. Fixture D: eigener Branch = `branch:` im Plan-Frontmatter mit eigenem PR → `fortsetzen`, kein Treffer.
5. Teilstring (`bank` in `cockpit-tab-bank-partner`) löst keinen Treffer aus; Slugs mit < 2 Segmenten werden abgelehnt.
6. ≥ 50 %-Dateiregel (mind. 3 Plandateien, ohne package*.json/Lockfiles/schema.prisma/i18n) erzeugt nur einen Hinweis.
7. Fetch scheitert → Stopp; nur PR-API fehlt → Stopp mit Knopf „ohne PR-Prüfung bauen“, protokolliert.
8. G0 nutzt nur das Lesetoken; ein Test belegt, dass das Push-Token nie gelesen wird.
9. Nachtbau mit Treffer → Strang `blocked_g0`, nächstes Item startet, Treffer erscheint morgens in „Heute“.
10. Zwei drift-Läufe hintereinander legen dieselbe Rückfrage genau einmal an; beantwortete Schlüssel werden nicht neu angelegt; > 5 neue pro Tag werden gekappt.
11. drift.py liest den Integrationsstand per `git ls-tree origin/<integ>`, nicht den Arbeitsbaum.
12. Cron steht auf 06:30; drift- und dienste-Bericht landen im selben Morgenort.
13. Fehlalarme (Rückfrage + gewählter Knopf) und Fehltreffer (nachträglich entdeckter Doppelbau) werden protokolliert; Bilanz nach 4 Wochen.
14. Fixture E spielt den Vorfall vom 08.10. mit echten SHAs nach (Spec-, Plan- und Branch-Slug verschieden; Treffer über `spec:` bzw. `**Spec:**`) → `treffer`.
15. Fixture F: eigener gemergter Plan-PR ohne Code → `fortsetzen`; Plandatei mit fremdem `branch:` → `treffer (geplant von anderem)`.
16. Fixture G: fremder PR mit gleichem Branch-Namen (anderer Autor, Head-SHA nicht lokal) → `treffer`.
17. Fetch-Pfad nutzt `GIT_VW_READ=1`; ohne Lesetoken → Stopp ohne Knopf, Nachtbau aus; nachts nicht prüfbar → genau ein Morgeneintrag.
18. drift.py ohne installiertes `vorbau-check` → Abschnitt übersprungen mit Hinweiszeile, kein Fehler.
19. Pläne ohne `spec:`/`branch:` (Altpläne) → Kopfzeile `**Spec:**` wird gelesen; fehlt auch die → Hinweis „Identität unbekannt“, kein stilles `frei`.

20. Geplant von anderem zählt über `spec:`-Feld **oder** `branch:` **oder** Pfad. Fixture F2: fremder Plan mit abweichendem Dateinamen und passendem `spec:` → `treffer`.
21. Fetch **und** PR-Abfrage nutzen das Lesetoken (`GIT_VW_READ=1 git credential fill`); Test belegt, dass das Push-Item für beide nie gelesen wird.
22. Das neue Lesetoken ersetzt das Item „Github wirstrom read only“ (oder `ITEM_READ` wird angepasst): `GIT_VW_READ=1 git ls-remote https://github.com/WirStrom1/olaf-docs` endet mit 0.
23. `questions/ask` mit `key`: zweiter Aufruf mit offenem oder beantwortetem Schlüssel wird vom Server abgelehnt (API-Test).
24. Nachtbau-Aufrufer benannt, `blocked_g0` als Strang-Zustand sichtbar in „Heute“.
25. Fehlalarme durch das Kriterium „anderer Autor“ werden gesondert gezählt; > 1 bei eigenem `branch:` in 4 Wochen → Kriterium entfällt.
26. Cron drift 06:30 und `dienste --bericht` nach `daily-debrief/morgen-<datum>.md` sind umgestellt (`crontab -l` belegt).

## Wer besitzt was
- `scripts/vorbau-check` + Aufruf beim Bau-Start: `knut523/werkbank` (Knut, privat).
- drift.py-Abschnitt: Team-Skill olaf-produkt-roadmap (`/vault/_meta/dist-skill/…/plan-vault-drift.py`), ruft vorbau-check nur, wenn vorhanden.
- Morgenort: drift 06:30 + `~/bin/dienste --bericht` 06:50 schreiben nach `daily-debrief/morgen-<datum>.md`.

## Vorbedingungen (Knut)
- Neues GitHub-Lesetoken in Vaultwarden (das bisherige „Github wirstrom read only“ antwortet 401).
- olaf-docs-PR für „Phase 2.5b“ in plan-to-pr: nur mit Knuts OK, Christoph als Reviewer.

## Nicht in diesem Schnitt
Inbox-Rückschreiben + ID-Migration (eigener Plan nach E3), Plannummern-Vergabe (nach E4), Jira.
