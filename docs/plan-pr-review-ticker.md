---
title: "Plan — Workspace: PR-Ticker und automatisches Deep-Review bei @review, schaltbar"
nummer: 157
status: in-arbeit
basis: release/werkbank-2026-10-13 (0dfc538, Live seit 13.10.2026)
created: 2026-10-13
owner: Knut
---

# Plan — Workspace: PR-Ticker und automatisches Deep-Review bei @review

> Knut, 13.10.2026: „Wir hatten mal den Monitor für PR-Reviews, der automatisch gecheckt hat, ob was neu ist — bau das
> für den Workspace: Ticker, der dann automatisch deep reviewed (wenn @review getaggt wird), ein- und ausschaltbar.“

## 1. Befund (belegt am Code, Basis 0dfc538)

- **Es gibt schon einen PR-Abruf:** `web/server/github.ts` holt alle 5 Minuten die **offenen** PRs von `WirStrom1` über
  GraphQL (`PR_QUERY`) und speichert sie in `github_prs` (Roadmap „PR-Review live“). Er kennt weder Kommentare noch
  `knut523/werkbank` noch geschlossene PRs. Es gibt keine Ereignisse („was ist neu“), nur den Zustand.
- **Nur lesend ist schon gebaut:** `graphql()` weist jede Mutation ab, bevor etwas gesendet wird. Der Token kommt aus
  `creds.githubReadToken()` (`WERKBANK_GITHUB_TOKEN` oder Vaultwarden „View only github API“) und bleibt im Server.
- **Stränge können GitHub nicht erreichen:** Die Brücke sperrt in Orchestrator-Strängen `api.github.com` und
  `github.com/….git` (`claude-bridge/src/tools.ts`, `ORCH_BASH_BLOCK`) und setzt eine Git-Umgebung ohne Zugangsdaten
  (`orchGitEnv`). Ein Review-Strang kann den PR also **nicht selbst holen**. Der Web-Server muss ihn vorbereiten.
- **Review-Ansicht (Plan 154, Zusatz C):** `freigabe.ts` `reviewDetail` zeigt Bericht, PR-Texte (`pr*.md` im Paket),
  Entscheidungen und die Freigabe je Repo. Für einen Kommentar-Entwurf an einen fremden PR gibt es kein Feld.
- **Hauptchat-Meldung:** `leitstand.ts` `strandEvent` meldet `review_ready` als Ereignis `review` („meldet review_ready“).
  Die Meldungen gehen gebündelt an den Hauptchat (`wakeText`).
- **Checks:** Mit dem Lesetoken sind Check-Runs/Statuses nicht lesbar (403). Der Ticker fragt sie deshalb gar nicht ab.
  Den CI-Stand prüft das Review selbst über die Tests im Worktree.
- **Echte API-Antworten aufzeichnen:** In diesem Strang gesperrt (Brücke, „GitHub direkt ansprechen“). Darum gibt es
  `scripts/pr-ticker-fixtures.sh`: Knut oder der Hauptchat zeichnet damit einmal echte Antworten auf, und der Test
  `prticker.test.ts` spielt jede Datei unter `web/test/fixtures/github/` ab, die er dort findet.

## 2. Grilling — Entscheidungen (Rückfrage an Knut; gebaut ist jeweils die Empfehlung)

Der Strang darf keine Rückfragen stellen. Jede Frage ist mit der Empfehlung umgesetzt, und Knut kann sie umdrehen.

| # | Frage | Optionen | Empfehlung (gebaut) |
|---|---|---|---|
| T1 | Wo steht der Ticker? | a) Hauptchat-Seite (`#/leitstand`), oben · b) „Heute“ · c) LibreChat-Seitenleiste | **a**. Nur Admins sehen diese Seite, und die Ereignisse betreffen Knuts PRs. „Heute“ ist fürs Team, die Seitenleiste ist ein Client-Patch. |
| T2 | Welche Repos? | a) `org:WirStrom1` + `repo:knut523/werkbank` (eine GitHub-Suche) · b) nur WirStrom1 | **a**, über `WERKBANK_TICKER_SCOPE` änderbar. Sieht das Lesetoken `knut523/werkbank` nicht, bleibt der Teil leer. Das steht dann im Ticker. |
| T3 | Was ist ein Ticker-Eintrag? | neuer PR · neuer Stand (Kopf-SHA) · gemergt/geschlossen · Review oder Kommentar auf **unseren** PRs (Autor `knut523`) · Review-Anfrage an `knut523` · `@review` | **so**. Eigene Aktionen von `knut523` zählen nicht. Dedupliziert wird über eine feste Kennung je Ereignis (`_id` in `pr_ticker`). |
| T4 | Was löst das Auto-Review aus? | a) nur ein `@review`-Kommentar (oder Review-Text) von einer Person auf der Liste · b) zusätzlich jede Review-Anfrage an `knut523` | **a**. b ist ein Schalter in den Einstellungen, Standard aus. Liste: `knut523`, `bizarrochris`, in der Oberfläche änderbar. |
| T5 | Was passiert mit Altem beim Einschalten? | a) erster Lauf merkt sich den Stand und meldet nichts · b) letzte 24 h nachholen | **a**. Ein Auto-Review gibt es nur für `@review` nach dem Einschalten (sonst startet beim ersten Lauf eine Lawine). |
| T6 | Wie kommt der Strang an den Code? | a) Server holt `pull/N/head` mit dem Lesetoken in einen eigenen Klon und legt einen frischen Worktree an, der Strang arbeitet offline · b) Strang holt selbst | **a**. b geht nicht (Befund) und hieße, einem Strang Zugangsdaten zu geben. |
| T7 | Was liefert der Strang? | `kommentar.md` im Review-Paket: erste Zeile `Empfehlung: approve | request-changes | comment`, darunter der Kommentar-Entwurf; `bericht.md` mit Pre-Checks, Pass A/B/C und Tests; `review_ready` | **so** |
| T8 | „Kommentar posten“: wie kommt der Text auf GitHub? | a) Knopf postet über einen eng begrenzten Schreibweg (nur `POST …/issues/{n}/comments` auf genau diesen PR, Text an den gezeigten Entwurf gebunden, nur Admin), mit dem Schreibtoken aus Vaultwarden, nur wenn `WERKBANK_GITHUB_KOMMENTAR=on` · b) nur „Text kopieren + PR öffnen“, Knut postet selbst | **a gebaut, aber aus**. Damit bekommt der Web-Server zum ersten Mal ein Schreibrecht auf GitHub. Bis Knut das bestätigt, gilt b. Approve/Request-Changes gibt es nie automatisch, nur als Text-Empfehlung. |
| T9 | Deckel | max. 5 automatische Reviews je Tag (Wiener Datum), max. 2 gleichzeitig; darüber: Eintrag „wartet (Deckel)“, startet am nächsten Tag nicht von selbst | **so**, beides in den Einstellungen. Was liegen bleibt, startet Knut mit „Jetzt reviewen“. |
| T10 | Gleicher PR noch einmal getaggt | a) neues Review nur, wenn sich der Kopf-SHA geändert hat · b) immer | **a**. Sonst steht „schon reviewt für diesen Stand“ im Ticker. |
| T11 | PR geschlossen/gemergt oder neuer Stand, während das Review läuft | Review läuft zu Ende. Die Review-Ansicht zeigt den Hinweis, und Posten ist gesperrt, solange der Kopf-SHA nicht mehr dem reviewten entspricht oder der PR zu ist. | **so** |
| T12 | Wem gehört der Auto-Review-Strang? | der Person, die das Auto-Review eingeschaltet hat (Admin) | **so**. Der Schaltvorgang wird mit Person und Zeit protokolliert. |

## 3. Architektur

- **`web/server/prticker.ts`** (neu):
  - `tickerSettings`/`setTickerSettings` in `meta` (`_id: pr_ticker_settings`) mit Protokoll (`log[]`: wer, wann, was).
  - `TICKER_QUERY`: zwei GraphQL-`search`-Abfragen (`is:pr <scope> updated:>=<since>`), je PR: Kopf-SHA, Zustand, Autor,
    letzte Kommentare und Reviews (`id`, `author`, `body`, `createdAt`, `url`), offene Review-Anfragen. Nur `query`, über `graphql()`.
  - `deriveEvents(prs, state, cfg)` (rein, getestet) → Ticker-Einträge mit fester Kennung + Auslöser fürs Auto-Review.
  - `tickerTick()`: Abruf → `pr_ticker` (insert, doppelte Kennung = schon gesehen) → `pr_reviews` (Warteschlange).
  - `reviewTick()`: Deckel prüfen → Klon/Worktree vorbereiten (`git fetch origin pull/N/head` mit `GIT_VW_READ=1`) →
    `startOrch` mit dem Review-Auftrag (Phase 4 von plan-to-pr) → Strang-ID am Eintrag.
  - `postKommentar()`: nur bei `WERKBANK_GITHUB_KOMMENTAR=on`, siehe T8.
- **`main.ts`**: Routen `GET /api/leitstand/ticker`, `POST /api/leitstand/ticker/einstellungen`,
  `POST /api/leitstand/ticker/review` (von Hand starten), `POST /api/review/:id/kommentar`; Takt im Hintergrund.
- **Oberfläche** (`Leitstand.tsx`): Karte „PR-Ticker“ mit zwei Schaltern, Deckel, Liste; in der Review-Ansicht der
  Abschnitt „PR-Review-Entwurf“ mit Empfehlung, Text und „Kommentar posten“ bzw. „Text kopieren + PR öffnen“.
- **Hauptchat:** `strandEvent` schreibt für Auto-Review-Stränge „Neues Review fertig: repo#n — Empfehlung …“.

## 4. Schnitte (je ein Commit)

1. Plan (diese Datei).
2. Ticker: Einstellungen, Abfrage, Ereignisse, Speicher, Takt, Routen, Karte + Schalter (`prticker.test.ts`).
3. Auto-Review: Warteschlange, Deckel, Worktree-Vorbereitung, Strang-Start, Hauptchat-Text.
4. Review-Ergebnis: Entwurf in der Review-Ansicht, „Kommentar posten“ (aus), „Text kopieren + PR öffnen“.
5. Aufzeichnungs-Skript für echte Fixtures + Browser-Aufnahmen.

## 5. Rückweg

- Alles ist zusätzlich: neue Sammlungen `pr_ticker`, `pr_reviews`, `meta.pr_ticker_settings`. Standard ist **aus**: Ohne
  Schalter läuft nichts, und es wird nichts abgefragt.
- Abschalten ohne Release: beide Schalter in der Oberfläche aus, oder `WERKBANK_PR_TICKER=off` (Neustart).
- Code zurück: Release-Zweig auf den vorigen Stand (0dfc538) und `scripts/werkbank.sh update`. Die Sammlungen können
  bleiben, ein alter Stand liest sie nicht.

## 6. Verlauf

- 13.10.2026: Plan, Grilling T1–T12 mit Empfehlung (gebaut ist die Empfehlung).
