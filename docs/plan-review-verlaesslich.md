# Plan: Auto-Reviews verlässlich und gut (Paket 223)

Knut, 19.10.2026: „Lass uns die Reviews verlässlich und gut machen.“ Ziel: Jedes `@review` / `@review deep` von knut523
oder bizarrochris endet **ohne manuelles Zutun** in einem englischen Kommentar am PR innerhalb der ETA — oder in einer
klaren Meldung an Knut, warum nicht. Und die Reviews finden, was ein guter menschlicher Reviewer findet.

Grundlage: `web/server/prticker.ts` (Ticker, Warteschlange), `web/server/prreview.ts` (Start, Abschluss, Gegenprüfung,
Posten), `web/server/reviewexec.ts` (deep: Tests). Stand 17c11.

## Ausgangslage (gemessen am Review-Log, 15.–19.10.)

19 Einträge in `pr_reviews`: 16 fertig, 1 fehler, 2 übersprungen. 11 der 16 fertigen automatisch gepostet (69 %), Median
Tag → Kommentar 19 min. Nicht gepostet:

| Fall | Grund | heute noch? |
|---|---|---|
| olaf-admin#354, #356 (2. Stand) | Verweis `#324` / `#353` „nicht geprüft“ | nein — seit 17c wird geprüft, ob es die Nummer gibt |
| olaf-umbrella#78 | `#359` meint olaf-admin#359, im umbrella-Repo gibt es die Nummer nicht | **ja** |
| wirstrom-flowtest#2 (deep) | `#23–#26` sind Testfall-Nummern, keine Issues | **ja** |
| olaf-admin#357 (2. Stand) | PR in den 6 min des Reviews gemergt | korrekt, aber die Statuszeile sagt „wartet auf Knut“ |
| olaf-tariff-app#207 | kein `kommentar.md` → fehler, kein Nachfass | **ja** |

Dazu: der Entwurf zu #354 war **deutsch** (wäre ohne Verweis-Sperre deutsch gepostet worden); #364 kam nach einem
„addressed“-Kommentar mit neuem Commit nicht zur Nachprüfung; der Tag an #364 vom 18.10. 17:49 wurde erst am 19.10. 07:54
gesehen (Web-App lief laut Log vom 17.10. ~14 Uhr bis 19.10. 07:07 nicht — niemand wurde gewarnt); die Gegenprüfung
startet nach jedem Neustart neu und kann bei häufigen Neustarts endlos neu anlaufen.

## Schnitte (je: Test zuerst rot, dann Fix)

**S1 Nachbessern statt Liegenlassen (a, b, c).** Neuer Zustand `nachbessern` wie `abgleich`: verletzt der Entwurf eine
Textregel oder fehlt `kommentar.md`/die Empfehlungszeile, bekommt der noch lebende Strang **einen** Nachfass-Zug mit
der genauen Liste (Nummern, die es im Repo nicht gibt → `owner/repo#N` schreiben oder umformulieren; lokaler Pfad;
nicht englisch; Format). Vorher deterministisch: `#N`, das im PR-Kontext als `owner/repo#N` oder GitHub-Link eines
anderen Repos vorkommt, wird so qualifiziert. Neue Regel „nicht englisch“. Scheitert der Nachfass: `fertig` ohne Posten
**und** Meldung an Knut im Hauptchat mit Link auf die Review-Ansicht („Kommentar posten“ dort, neuer Knopf „Verwerfen“).
Empfehlungszeile toleranter lesen (`**Empfehlung:**`, „request changes“). deep postet wie regular als COMMENT; der
Auftrag sagt ausdrücklich: Empfehlung selbst wählen, keine Rückfrage an Knut. Statuszeile bei „gemergt/neuer Stand“
ehrlich („skipped — PR merged“) statt „wartet auf Knut“.

**S2 Nachprüfung ohne Tag (d).** Der Ticker meldet zusätzlich Kommentare/Review-Texte des **PR-Autors** (auf der
Liste) mit „addressed/fixed/done/resolved/erledigt/behoben“. Gibt es ein fertiges Review dieses PRs an einem älteren
Kopf und ist der Kopf jetzt neu → Eintrag `trigger: nachpruefung` (Delta-Review gegen das letzte Review, wie `@review`
mit Delta-Material). Gleicher Kopf → nichts (Kennung PR@Kopf).

**S3 deep-Umgebung aus dem Workflow (e).** `ciUmgebung(wt)` liest `.github/workflows/*.yml` (Paket `yaml`): je
`npm run X` die `env` von Workflow, Job, Schritt und Inline-`VAR=wert` davor. `${{ secrets.N }}` → Suite „übersprungen:
braucht Secret N“; andere `${{ … }}` fallen weg; Postgres-URLs auf localhost → die Review-DB; `NODE_OPTIONS`, `PATH`,
`HOME` werden nie übernommen. Ohne Review-DB gilt jede Suite mit Postgres-URL als DB-Suite (übersprungen).

**S4 Wache (f).** Im Review-Takt: jedes Review, das `createdAt + ETA + 15 min` überschritten hat und nicht gepostet
ist (auch `fertig` ohne Posten, `fehler`), meldet sich **einmal** im Hauptchat mit Grund, Zustand und Link auf den
Ticker („Jetzt reviewen“). Dazu: Ticker seit 15 min ohne erfolgreichen Lauf (Token/GitHub) → eine Meldung. Die
Gegenprüfung startet nach Neustart höchstens zweimal neu, danach Abschluss ohne sie (Zähler `gpVersuche`).
Was sie nicht kann: einen ausgefallenen Web-Prozess melden (D3).

**S5 Qualität (g), nur was der Eval-Satz trägt.** Kandidaten aus Paket 213: #4 jeder Befund mit Widerlegungsversuch
(REFUTE) gegen Fehlalarme, #5 feste Sorgeklassen als Pflicht-Abdeckung (security, data_integrity, cross_file,
idempotency, pii, access_control) gegen Lücken, #14 frühere Review-Kommentare zu denselben Dateien. Übernommen wird nur,
was im Eval vorher/nachher den Recall hebt oder Fehlalarme senkt. #9 (Befundfelder) und #11 (Posten per Hash) bleiben
draußen, solange der Eval keinen Nutzen zeigt — #11 ist heute schon erfüllt (gepostet wird der beim Abschluss gelesene
Text, der Klick in der Review-Ansicht prüft den gezeigten Text).

## Eval-Satz (Regressionsmaßstab)

`docs/review-eval/faelle.json`: 5 Fälle (olaf-admin #356, #353, #364, #331, olaf-tariff-app #202) am damaligen Kopf,
Kontext nur bis zur Stichzeit, bekannte echte Befunde (gold) und Scheinbefunde. `scripts/review-eval vorbereiten |
richter | auswerten`: derselbe Auftrag wie live (`reviewPrompt`), Replay-Zusatz (nichts posten), Richter glm-5.3,
Stichprobe von Hand. Kennzahlen: Recall ohne Nits, gewichteter Recall, Blocker/Major getroffen, Fehlalarme.

## Nicht in diesem Paket

Externe Überwachung des Web-Prozesses (D3), dauerhafte Warteschlange für die Gegenprüfung in einem eigenen Prozess (D4),
Isolation der deep-Tests (Paket 213, D4 dort).
