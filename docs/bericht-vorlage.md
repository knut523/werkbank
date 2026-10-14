---
status: wartet_auf_knut
offen:
  - Vorlage in Brevo umbauen (Knut)
  - Review durch Christoph
review:
  - titel: Admin-Vorschau, Einstellungen → Hardware
    url: https://3064--main--dev--knut.ws.konekto.energy/settings/hardware
    login: https://3064--main--dev--knut.ws.konekto.energy/login?next=/settings/hardware
  - screenshot: screenshots/einstellungen-800.png
  - screenshot: screenshots/einstellungen-390.png
  - pr_text: pr.md
fragen:
  - id: D1
    frage: Wer ist Ansprechperson in der Mail, wenn kein Bearbeiter gesetzt ist?
    empfehlung: die erste Zuständige der Anfrage
    antwort: ""
github:
  - repo: WirStrom1/olaf-admin
    zweig: feat/beispiel
    commit: 0123abcd
    pr_text: pr.md
---

# Titel des Strangs — Bericht

<!-- Vorlage (docs/plan-leitstand.md, Teil C). Der Kopf oben ist Pflicht und muss zum Text passen:
     status: bereit_fuer_github nur, wenn Tests grün, Review-Pässe durch und nichts offen; wartet_auf_knut, wenn Knut etwas
     ansehen oder entscheiden soll; blockiert, wenn es ohne Hilfe nicht weitergeht. offen höchstens 5 Zeilen.
     review: Coder-Vorschau mit Login-Link (die Werkbank prüft, ob sie antwortet), Screenshots (relativ im Paket), PR-Text.
     fragen: nur echte Entscheidungen, je mit Empfehlung; antwort bleibt leer, bis Knut antwortet (kommt als „Nacharbeit nach Review“).
     github: je Repo Zweig und der Commit, den Knut freigeben soll (≥ 7 Zeichen). Neuer Commit → Kopf ändern; Knuts Freigabe gilt
     nur für genau diesen Stand. -->

**Stand:** TT.MM.JJJJ · **Repo:** … · **Branch:** `…` (lokal, nicht gepusht) · **Plan:** …

## Wie es jetzt funktioniert

```mermaid
flowchart LR
  E["Einstellungen<br/>Standardtext"] --> S{"Angebot senden"}
  N["Nachricht für diesen Versand"] --> S
  S --> M["Mail an die Leasing-Adresse"]
  M --> P["Zeile im Versandprotokoll"]
```

## Ausroll-Reihenfolge

<!-- nur bei mehreren PRs oder Repos -->

```mermaid
flowchart LR
  P["Plan-PR"] -.-> A["Code-PR mit Migration"]
  A --> U["Infra-PR: Vorlage auf dev"]
  U --> T["Testsendung auf dev"]
```

## Was gebaut ist

- …

## So sieht es aus

![Einstellungen, Desktop](screenshots/einstellungen-800.png)

## Geprüft

| # | Punkt | Stand |
|---|---|---|
| 1 | Typecheck, Lint | ja |
| 2 | Tests | ja |
| 3 | GitHub-CI | nein |

## Entscheidungen

**D1 — Ansprechperson ohne Bearbeiter**
Kontext in zwei bis vier Sätzen. Optionen mit Folge. Empfehlung: die erste Zuständige.
- Knut:
