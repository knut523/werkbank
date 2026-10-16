# Plan: ETA und Tiefe je Strang (Paket 205)

Stand 16.10.2026 · Owner Knut · Auftrag: „für den Workspace wäre je Task auch ein ETA wichtig, auch sollten Aufgaben mit quick
oder regular oder deep gemacht werden … ja bau das“.

## Ziel

Jeder Unter-Chat (Orchestrator-Strang) hat eine **Tiefe** (`quick` · `regular` · `deep`, Vorgabe `regular`), die festlegt,
welche Schritte Pflicht sind, auf welchem Modell er läuft und wie viel Budget er hat — und eine **ETA**, die der Agent selbst
schätzt und nachzieht. Beides ist in `orch list`, `orch show`, im Hauptchat (`orch_list`/`orch_show`) und auf den Karten der
Übersicht sichtbar.

## Tiefe

| | quick | regular (heute) | deep |
|---|---|---|---|
| Lead-Modell | `melious:glm-5.3-flash` (wenn kein `--modell`) | wie heute: Claude, Phasen-Lead (Opus plant/prüft, Sonnet baut) | Claude, Phasen-Lead; Risiko `hoch` (kein Melious-Überlauf) |
| Ersatz, wenn Claude leer | Flash | `glm-5.3-flash` (Regel der Brücke: Unter-Stränge nie auf dem Lead-Modell `glm-5.3`) | ebenso Flash — die Regel gilt auch für deep |
| Risiko-Vorgabe | `niedrig` | wie heute (`mittel`) | `hoch` |
| Pflichtschritte | kein Council, keine Gegenprüfung, nur die Tests des Repos, kurzer Bericht | plan-to-pr wie heute; Pass C mit `challenge` (art=diff, Vorgabe glm-5.3-flash) | voller plan-to-pr: Council mit `challenge` art=council (glm-5.3), Pass A/B/C, Pass C mit `challenge` art=diff **hoch=true** (glm-5.3), Visual-Check (Screenshots) |
| Schritte je Zug | `ORCH_MAX_TURNS` | `ORCH_MAX_TURNS` | 2 × `ORCH_MAX_TURNS` |
| Deckel „automatisch weiter“ | ⌈max/3⌉ (10) | `ORCH_AUTO_WEITER_MAX` (30) | 2 × max (60) |

Explizite `--modell`/`--risiko` schlagen die Vorgabe der Tiefe. Die Brücke lässt bei `quick` den Hinweis „Gegenprüfung
STANDARDMÄSSIG“ weg (sonst widerspricht der Systemprompt dem Auftrag).

Wo gewählt: `orch start --tiefe quick|regular|deep`, Hauptchat-Werkzeug `orch_start` (Feld `tiefe`), im Web am Dialog
„Agent ansetzen“ (dort nur Pflichtschritte im Auftrag — Ticket-Agenten sind normale Chats ohne Strang-Modell).

## ETA

- Der Stand-Block jedes Strangs bekommt die Pflichtzeile `ETA: HH:MM` oder `ETA: ~N min` (vor `Status:`), bei jeder Antwort
  nachgezogen. Geparst wie `Status:` (letzte zählt); `HH:MM` = Wiener Zeit, liegt sie > 1 h vor der Meldung, gilt der nächste Tag.
- Der Status-Takt merkt sich die letzte gemeldete ETA am Strang (`eta.at`, `eta.gemeldetAt`); eine Antwort ohne ETA löscht sie nicht.
- Ohne Agentenangabe: Start + Median der Dauer (Start → „fertig“) der letzten erledigten Stränge derselben Tiefe der Person
  (mind. 3, höchstens 50, ≤ 60 Tage, Dauer ≤ 3 Tage; alte Stränge ohne Tiefe zählen als regular), sonst Vorgabe
  quick 20 / regular 60 / deep 180 min.
- Anzeige nur für nicht fertige Stränge: „fertig ca. 17:30“; vorbei → „überfällig seit 12 min“ (gedämpft markiert, kein
  Alarm, keine Meldung). Alte Stränge ohne Tiefe und ohne gemeldete ETA: „–“.
- Kein neues Env, keine Datenmigration (Felder `tiefe`, `eta` optional).

## Schnitte

1. `web/server/tiefe.ts` (rein): Tiefe, Vorgaben, Brief-Absatz, ETA-Parser, Median, Anzeige — mit Tests.
2. Orchestrator: Start (`tiefe` speichern, Modell/Risiko-Vorgabe, an die Brücke), Brief (Absatz + ETA-Zeile), Status-Takt
   (ETA festhalten), `listOrch`/`showOrch` (tiefe, eta), Auto-Deckel je Tiefe.
3. Brücke: `tiefe` bei der Anmeldung, in `orch-state`; deep = doppelte Schritte; quick ohne Gegenprüfungs-Hinweis.
4. CLI + Hauptchat-Werkzeuge: `--tiefe`, Anzeige in list/show.
5. Übersicht-Karte: Tiefe + ETA/überfällig.
6. „Agent ansetzen“: Auswahl Tiefe → Pflichtschritte im Auftrag.

## Definition of Done

- Tests Brücke + Web grün (Test-Mongo, nie die Live-Mongo); neue Tests für Parser, Fallback, Brief, Start-Vorgaben, Brücke.
- Pass A/B/C, Gegenprüfung (`challenge` art=diff) gelaufen.
- Screenshots Übersicht-Karte und `orch list`.
- Release-Skript-Entwurf für `release/werkbank-2026-10-17b`; nichts gepusht, nichts live.
