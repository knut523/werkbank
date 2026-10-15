# Bericht 154 (Auszug „Offene Entscheidungen“, Stand 13.10.2026)

## Offene Entscheidungen

Gebaut ist jeweils die Empfehlung. Format wie in der neuen Review-Ansicht: Dort lassen sie sich direkt beantworten.

**D1 — Offene Rückfragen bremsen das Auto-weiter nicht mehr (G8)**
- a) nie (gebaut). Anhalten geht ausdrücklich mit „Anhalten“/`orch review`.
- b) nur Fragen, die nach der letzten Nachricht an den Strang angelegt wurden
- c) wie vorher (jede offene Frage hält an — so standen am 12.10. vier Stränge still)
- Empfehlung: a
  - Knut:

**D2 — Modell der strang-leser (Pull, Z7)**
- a) wie der Hauptchat (gebaut)
- b) `haiku` (billig)
- c) `sonnet`
- Empfehlung: a. Nach einer Woche den Verbrauch im Brücken-Log (`teilagenten`) ansehen.
  - Knut:

**D3 — Themen-Gruppen auch für die normalen Chats in LibreChats Liste? (G4)**
- a) nein, nur die Unter-Chats (gebaut)
- b) ja, als eigener Patch an LibreChats virtualisierter Liste
- Empfehlung: a
  - Knut:

**D4 — Thema von Hand auch per Menü in der Seitenleiste? (G7)**
- a) nur `orch thema` bzw. der Hauptchat (gebaut)
- b) Menü je Zeile
- Empfehlung: a, bis Knut es oft braucht
  - Knut:

**D5 — „gemergt“ unter „Fertig“ (Z10)**
- a) später, mit PR-Stand am Strang
- b) jetzt aus GitHub lesen
- Empfehlung: a
  - Knut:

**D6 — pre-push-Hook in die OLAF-Repos einbauen (Zusatz C)**
- a) ja, in olaf-admin, olaf-tariff-app, olaf-bot, olaf-docs, olaf-durable-func (Knut, einmal je Repo)
- b) erst in einem Repo ausprobieren
- c) nein, Freigabe bleibt eine Regel
- Empfehlung: b, dann a. Ohne Hook ist die Freigabe nicht durchgesetzt.
  - Knut:

**D7 — Notausgang im Hook (`WERKBANK_PUSH_OHNE_FREIGABE=1`, mit Protokollzeile)**
- a) behalten (gebaut)
- b) entfernen (dann nur noch Hook ausbauen)
- Empfehlung: a — ein Hotfix darf nicht an der Werkbank hängen, die Spur bleibt.
  - Knut:

**D8 — Freigabe gilt nach Rebase weiter, wenn der Patch gleich ist**
- a) ja (gebaut, `git patch-id --stable` gegen dieselbe Basis)
- b) nein, jeder neue SHA braucht eine neue Freigabe
- Empfehlung: a — die Push-Checkliste rebased fast immer; ein anderer Inhalt fällt trotzdem durch.
  - Knut:

**D9 — Mehrere Repos je Strang (Plan-PR olaf-docs, umbrella, gestapelte PRs)**
- a) Folgeplan: `review_ready` bekommt `repos[]` (Pfad unter ~/work, Branch aus git), Freigabe je Repo mit Reihenfolge
- b) so lassen (ein Strang = sein Worktree)
- Empfehlung: a, und die Plannummer vor dem Review vergeben, damit die Checkliste den Plan-PR nicht mehr ändert
  - Knut:

**D10 — Vorschau-Datenbanken (Flex-Admin kann seine Migration nicht einspielen)**
- a) je Vorschau eine eigene DB-Kopie aus einer Vorlage (`createdb -T`), Migrationen des Branches beim Start durch den
  Starter, Kopie beim Stopp weg, im Dienste-Register als `db:` vermerkt (eigener Strang, außerhalb der Werkbank)
- b) Migrationen weiter von Hand
- Befund: Die Vorschauen haben schon eigene DBs (:55433). Es scheitert daran, dass `prisma migrate deploy` DB-Zugangsdaten
  aus `.env` braucht, die Stränge nicht lesen dürfen. Der Starter (Hauptsitzung) hat sie.
- Empfehlung: a, als eigener Strang mit Knuts Freigabe für den Zugriff auf die Zugangsdaten
  - Knut:

**D11 — Push durch einen eigenen Push-Agenten statt die Hauptsitzung**
- a) später, als eigener Plan (Push-Recht nur für freigegebene SHAs, Zugangsdaten nur dort)
- b) nie
- Empfehlung: a — erst wenn Freigabe und Hook eine Weile laufen
  - Knut:

## Bekannte Grenzen
