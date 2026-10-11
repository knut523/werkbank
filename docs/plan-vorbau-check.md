# Plan — G0 Prüfung vor dem Bau + täglicher Abgleich (Plan 127)

**Status:** PLAN ONLY (11.10.2026), noch kein Code. Prozess: `prozess-v3` (Council Runde 3 ausstehend).
**Freigabe Knut 11.10.:** Abgleich mit GitHub „passt“; „regelmäßig + Teil von plan-to-pr“.
**branch:** feat/vorbau-check · **Repos:** knut523/werkbank (Skript + Aufruf beim Bau-Start), olaf-produkt-roadmap-Skill (drift.py-Abschnitt).

## Warum
08.10.: Gebautes wurde neu gebaut, weil niemand vor dem Bau prüfte, ob die Spec schon auf develop oder in einem fremden PR liegt.
Ein Morgenbericht allein reicht nicht (Council R1): es braucht einen Stopp vor dem Bau.

## Schnitt
1. `scripts/vorbau-check <slug> [--plan DATEI] [--repos …]` → JSON `{ergebnis: frei|fortsetzen|treffer, belege:[…], hinweise:[…]}`.
2. Aufruf beim Werkbank-Bau-Start (`orch start --code`, Karten-Agent „Agent ansetzen“, Nachtbau). Treffer → kein Start, Rückfrage.
3. Abschnitt „Schon gebaut / baut jemand / nur lokal“ in `plan-vault-drift.py`, Cron 06:30, über alle Specs in 3-Plan/4-Review.
4. Kanal drift.py → Werkbank `questions/ask` mit Schlüssel `<slug>#G0` (+ Warteschlangendatei, max. 5/Tag).
5. Erprobung des generischen plan-to-pr-Absatzes „Phase 2.5b“ in der Werkbank-Agentenanweisung und im Skill olaf-produkt-roadmap.

## Definition of Done (Prüfsätze)
1. Fixture A: Slug, dessen Plandatei auf `origin/develop` liegt → `treffer` mit SHA.
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
13. Fehlalarme werden protokolliert (Rückfrage + gewählter Knopf).

## Vorbedingungen (Knut)
- Neues GitHub-Lesetoken in Vaultwarden (das bisherige „Github wirstrom read only“ antwortet 401).
- olaf-docs-PR für „Phase 2.5b“ in plan-to-pr: nur mit Knuts OK, Christoph als Reviewer.

## Nicht in diesem Schnitt
Inbox-Rückschreiben + ID-Migration (eigener Plan nach E3), Plannummern-Vergabe (nach E4), Jira.
