# Plan: Review-Ablauf ohne Hänger (Budget, Auto-Post, Sichtbarkeit, Claude-Ausweich)

Knut, 09.11.2026 ~22:50, nach dem Abend, an dem vier fertig gegengeprüfte Reviews (olaf-admin#411, #414, #415,
olaf-tariff-app#256) im Abgleich an der Melious-Budget-Sperre hingen und von Hand gepostet werden mussten:

1. „ja bitte und da auch veränderbar wenn wir es runtersetzen wollen setzen wir es runter“
2. „ja passt aber den sollte er automatisiert posten“
3. „ja auch ein issue der hauptstrang ist noch nicht so powerful wie du“
4. „ja“

Grundlage: Stand `release/werkbank-2026-10-11b` @ `4626907` (live). Branch `feat/review-ablauf`.

## Ausgangslage (gemessen 09.11., 22:00–22:45)

| Review | Gegenprüfung | danach | Ursache |
|---|---|---|---|
| olaf-admin#411, #414, #415, olaf-tariff-app#256 | fertig ~22:35 | `abgleich`, Strang-Zug „wartet: Energie-Budget“ | Budget gilt für jeden Strang mit Profil voll/bauer/release, auch für reine Claude-Züge (`claude-bridge/src/sessions.ts:1597`, `kapazitaet.ts:30`) |
| olaf-admin#412, durable-func#128, #129 | nie gestartet | erster Zug „wartet: Energie-Budget“ | dito; Melious-Topf leer, kein Ausweichen auf Claude |
| olaf-admin#413 | 26 min ohne Aktivität im Haupt-Lauf | Gegenprüfung lief noch (Prüfer-Sitzungen 11–23 min still) | Wächter sieht nur den Haupt-Lauf, nicht die Gegenprüfung |

Posten nach dem Abgleich gibt es schon (`autoPost`, `web/server/prreview.ts:930`); ein hängender Abgleich wird erst nach
1 h als „kaputt“ abgeschlossen (`prreview.ts:712`) — bis dahin geht nichts hinaus.

## Entscheidungen

- **E1 (Knut, Punkt 1):** Das Melious-Budget gilt nur für Züge, die Melious-Energie verbrauchen. Die Grenze ist in der
  Oberfläche einstellbar, auch nach unten, ohne Neustart.
- **E2 (Knut, Punkt 2):** Nach der Gegenprüfung postet die Werkbank selbst — kein Knopf nötig. Wartet der Abgleich
  länger als `ABGLEICH_WARTE_MIN`, wird der gegengeprüfte Entwurf so gepostet.
- **E3 (Knut, Punkt 3):** Die Review-Liste zeigt je Review die letzte Aktivität (Haupt-Lauf **und** Gegenprüfung) und den
  Wartegrund. Zusätzlich ein Roadmap-Issue: der Hauptstrang soll Hänger selbst so diagnostizieren können wie eine
  Claude-Code-Sitzung (Sitzungen der Gegenprüfung lesen, Budget-Sperre erkennen, Ursache nennen).
- **E4 (Knut, Punkt 4):** Ist Melious leer, läuft die Gegenprüfung auf Claude statt gar nicht.
- **E5 (Knut 09.11., F1):** Ein gepostetes Review (von Hand oder automatisch) zählt als Vorgänger für Delta und Neuprüfung —
  der Ticker feuert immer, auch wenn der Record in `abgleich` stehen geblieben ist. Gebaut: `0b3ce9a`.
- **E6 (Knut 09.11., F2):** Das Melious-Budget ist keine harte Sperre mehr. Standard `BRIDGE_MELIOUS_BUDGET=weich` (zählt und zeigt an,
  sperrt nicht); `hart` = alte Sperre; `aus`. Ein echter 402 (Breaker) sperrt weiterhin. Gebaut: `aed1d4b`.
- **E7 (Knut 09.11., F7):** freigegeben („ok“).
- **E8 (Knut 09.11.):** Review-Agenten bekommen den Kontext des Repos wie die Bau-Stränge seit Plan 274 B: Ensemble-Prüfer und
  Verifizierer bekommen `AGENTS.md`/`CLAUDE.md` aus dem Wurzelordner (je höchstens 24 000 Zeichen, Rest selbst lesen), der
  Claude-Brief liest dazu `olaf-docs/AGENTS.md` und die bestätigten Review-Regeln. Gebaut: `87894bd`.

## Schnitte (je: Test zuerst rot, dann Fix)

_(wird nach der Code-Kartierung gefüllt)_

## Fertig heißt (DoD)

- Ein Review-Strang, dessen Abgleich-Zug nur Claude braucht, startet bei leerem Melious-Topf ohne „wartet: Energie-Budget“ (Test).
- Ein Melious-Zug bei leerem Topf wartet weiterhin (Test, Bestandstests grün).
- Die Budget-Grenze ist in der Oberfläche änderbar; die nächste Zulassungsentscheidung der Bridge nutzt den neuen Wert ohne Neustart (Test).
- Ein Review, dessen Abgleich länger als `ABGLEICH_WARTE_MIN` nicht beginnt, wird mit dem gegengeprüften Entwurf automatisch gepostet — nie zweimal (Test).
- Die Review-Liste zeigt letzte Aktivität und Wartegrund; ein Review in der Gegenprüfung mit aktiven Prüfern erscheint nicht als still (Test + Screenshot).
- Melious leer → Gegenprüfung läuft auf Claude, das Ergebnis trägt den Vermerk „auf Claude“ (Test).
- Roadmap-Issue „Hauptstrang diagnostiziert Hänger selbst“ angelegt.
- Volle Testsuiten Bridge und Web grün; nicht live geschaltet, nicht gepostet, nicht gemergt.
- (E5) Ein Review, das gepostet wurde, aber in `abgleich` steht, löst bei neuem Head eine Delta-Prüfung aus (Test).
- (E6) Ohne Env-Wert sperrt ein leerer Melious-Topf nicht; mit `hart` sperrt er wie bisher (Test).
- (E8) Alle Ensemble-Aufrufe enthalten AGENTS.md/CLAUDE.md der Wurzel, keine tieferen; der Claude-Brief nennt REPO-KONTEXT (Test).

## Danach (Knut 09.11., erst wenn alle Reviews von Chris' PRs draußen sind)

- Die neue Werkbank zeigt die einzelnen Schritte eines Agenten nicht (Werkzeugaufrufe, Dateien, Zwischenstände) — man sieht nicht, was er tut, und wartet blind.
- Architektur-Runde: die Werkbank ist im Moment langsam; Ablauf Bridge → Strang → Ensemble/Gegenprüfung → Abgleich → Posten neu durchdenken (Messung zuerst: wo geht die Zeit hin).
