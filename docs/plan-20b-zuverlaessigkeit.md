# Plan 274 — Release 20b: Zuverlässigkeit + Tempo (Knut 20.10.2026)

Ausgangslage: Am 20.10. liefen mehrere Unter-Chats gleichzeitig. Dabei: zwei Stränge im selben Worktree, dreimal „Nachricht
ist nach 3 Minuten nicht bei der Brücke angekommen“ (e422ab42) mit einem Durchlauf in die falsche Richtung, drei Budget-Pausen,
die wie Abbrüche aussahen, ein Strang mit dem Bericht eines fremden Pakets (ce076bec → Paket 242) und „failed“, obwohl der
Agent „fertig“ gemeldet hatte. Dazu zwei Arbeitsweisen, die Knut freigegeben hat: Live-Modus für UI-Feedback und Tests zuerst
bei Rechner-/Geldlogik.

## Ursachen (aus den Live-Daten, nur gelesen)

| Vorfall | Ursache im Code |
|---|---|
| „Nachricht nicht angekommen“ (e422ab42, 16:13:57) | `sendOrch` setzt `lastSentAt` erst **nach** dem Warten auf die gespeicherte Nachricht (bis 5 s). Zugbeginn 16:13:57.458, `lastSentAt` 16:14:02.574 → 5,1 s > Toleranz 5 s → nach dem Zugende gilt die Nachricht als verloren. |
| Durchlauf in falscher Richtung | Der Hauptchat hat die „verlorene“ Nachricht neu geschickt bzw. in den laufenden Zug nachgereicht; `lastInject` hält nur die **letzte** Nachreichung (15:27 überschrieb 15:06), und „unbekannt“ (Brücke neu gestartet) wird nie nachgesendet. |
| Zwei Stränge im selben Worktree (b9b968af, 4c836b73) | Die Sperre vergleicht nur `cwd`. 4c836b73 hatte den Paketordner als `cwd` und schrieb in den Repo-Worktree, den b9b968af als `cwd` bekam. |
| Fremder Bericht (ce076bec → 242, 8fdd44b6 → 257, b95d9cdd → 254, e422ab42 → 256) | `findBericht`/`findPaket` nehmen den **ersten** Paketpfad im Auftrag — meist die Vorarbeit. Einmal gesetzt, wird nie korrigiert. |
| „Abbrüche“ durch Budget (b95d9cdd, 8fdd44b6, e422ab42) | Kein harter Abbruch im Zug, aber: Budget-Stopp legt `autoStopped` an → `orch list` zeigt **failed**, auch wenn der Agent 40 s vorher „fertig“ gemeldet hat (b95d9cdd) oder der Zug noch sauber endet (e422ab42). Keine Nachricht an den laufenden Zug. |
| „failed/blockiert“ trotz „fertig“ | `orchStatus` wertet den Ausgang des Zuges (error/aborted/rate_limit/…) vor der Status-Marke der gespeicherten Antwort. |

## Schnitte

1. **Live-Modus** (Tiefe `live`): quick am laufenden Dev-Server, kein Council/Pass C je Runde; `orch gruendlich <id>`,
   MCP `orch_gruendlich`, Knopf „Jetzt gründlich“ in Arbeit › Unter-Chats → einmal der volle Durchlauf vor dem Push.
2. **Rechner-Regel** im Strang-Brief: Geld/Summen → zuerst rote Tests für die Grundregeln.
3. **Ein Strang je Worktree**: Schlüssel = Git-Wurzel des `cwd` plus die Wurzeln der Dateien, die ein offener Strang
   geschrieben hat. `start` lehnt ab (409, mit Strang und Ausweg), `send`/automatisches „weiter“ warten, solange ein anderer
   Strang im selben Worktree läuft. Zweite Schicht in der Brücke: Write/Edit in einen Worktree, in dem gerade ein anderer
   Strang läuft → abgelehnt.
4. **Zustellung mit Bestätigung + Wiederholung**: Sendezeit vor dem Senden; `send` wartet kurz auf die Bestätigung der Brücke
   und meldet „angekommen“/„in der Schlange“/„nicht bestätigt — wird wiederholt“; „nicht angekommen“ schickt **denselben Text**
   noch einmal statt „weiter“; alle Nachreichungen werden verfolgt, ungelesene und unbekannte nach dem Zug nachgesendet.
5. **Budget**: 80 % Meldung (wie bisher). 100 %: kein Abbruch; läuft der Zug, bekommt er „Schritt sauber beenden, Stand
   sichern, mit ‚braucht Antwort‘ enden“; danach Pause mit Rückfrage. Schon fertig → keine Pause, nur Vermerk.
6. **Bericht-Zuordnung**: eigenes Paket aus `cwd` (unter review-pakete), sonst ausdrücklich „Paket …“, sonst `auftrag.md`,
   sonst nur bei genau einem genannten Paket; falsche Zuordnung heilt der Status-Takt selbst.
7. **Status ehrlich**: Antwort mit „Status: fertig“ nach der letzten Nachricht schlägt technische Zugenden und den Deckel →
   „fertig (danach abgebrochen: Grund)“; Budget-Pause → „wartet“, nicht „failed“.
8. Learnings-Datei, Release-Skript `release-live-21b.sh`, Bericht.

## Definition of Done (wörtlich aus dem Auftrag)

- [ ] D1 Live-Modus: Strang-Variante „live“ = Tiefe quick am laufenden Dev-Server, kein Council/Pass C pro Runde; gründlicher
      Durchlauf (Pass C, Gegenprüfung) nur einmal vor dem Push (Knopf/Befehl „jetzt gründlich“). In orch (`--tiefe live`) und
      Strang-Anweisung.
- [ ] D2 plan-to-pr-Regel: bei Rechner-/Geld-/Summenlogik zuerst Tests für Grundregeln (Summe = Summe der gezeigten Posten,
      Vorzeichen, netto/brutto-Beschriftung) – in der Strang-Systemanweisung.
- [ ] D4a Sperre: höchstens EIN Strang pro Arbeitsordner (cwd/Worktree) – orch start/send lehnt ab oder reiht ein.
- [ ] D4b Nachrichtenzustellung mit Bestätigung + Wiederholung.
- [ ] D5 Budget: bei 80 % Meldung, bei 100 % NICHT mitten im Zug abbrechen, sondern den laufenden Schritt sauber zu Ende
      bringen, Stand sichern und mit Meldung pausieren.
- [ ] D7 Ticker-Fix eingemergt – Tests/Build im 20b-Stand grün.
- [ ] D8 „orch ordnet einem Strang den Bericht eines anderen Pakets zu“ – Ursache, Test, Fix.
- [ ] D9 Statusanzeige ehrlich – „fertig (danach abgebrochen: Grund)“ statt „failed/blockiert“, wenn der Agent „fertig“ meldet.
- [ ] D10 `docs/learnings-2026-10-20.md`: Vorfälle + Regel/Test, der jeden verhindert.
- [ ] D11 Tests zuerst (rot), Build grün, Gegenprüfung (`challenge` art=diff), Visual Review der sichtbaren Teile, Bericht +
      Release-Skript (nach Muster 20a). Nicht in 20b: git merge/fetch in Strängen, Web-Push.
