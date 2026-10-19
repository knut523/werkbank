Empfehlung: request-changes

Danke für den Schnitt in zwei klar getrennte Commits. Bei den Banken lese ich die Entscheidung (Sitz der Bank, IBAN-Banken, Beraterstrecke, Bank-Leads nach Land wieder exakt; Faltung unter `MIN_N` nach Namen und die Berater-Regel bleiben) als stimmig. Bei Altersgruppe und Geschlecht geht die Änderung aber über „Zahlen exakt“ hinaus, und Legende und ⓘ versprechen weiter einen Schutz, den der Code nicht mehr hat. Deshalb bitte noch nicht so mergen.

### 1. Altersgruppe/Geschlecht weicht von der entschiedenen Spec und der Grundlage für die DSB-Abstimmung ab (Entscheidung nötig)

Die Spec „Feinere Altersgruppen und Geschlecht“ (Knut, 08.10.2026) hat als DoD 3: „Zellen unter 10 als „<10“, keine Kombination mit Bundesland/PLZ unter 10“. Die Abstimmung mit der DSB (DoD 1) war mit „nur aggregiert, MIN_N 10“ begründet. Hintergrund war der Council vom 29.09.: PLZ + Geburtsdatum + Geschlecht reichen zur Re-Identifikation.

Nach 9df0610 darf jedes Feld mit Altersgruppe oder Geschlecht kombiniert werden, und jede Zelle zeigt ihre genaue Zahl. Ausdrücklich getestet ist das in `src/lib/cockpit/semantic/kleinzellen.test.ts:36` (`dimension: 'bundesland', split: 'geschlecht'`). Mit Filter (Bundesland, Bank, Kanal, Zeitraum) steht damit z. B. „Burgenland · Frau · 70+: 1“ auf dem Bildschirm. Das kann eine Kommentarzeile („more caution than admins need“) nicht entscheiden. Es braucht Knuts Ok und eine Rückmeldung an die DSB, oder es bleibt bei der Spec. Bitte im PR-Text festhalten, wer das entschieden hat und ob die DSB davon weiß.

### 2. Der Drill-down öffnet jetzt Einzelzellen nach Alter und Geschlecht

`src/lib/cockpit/semantic/drill.ts:65` hat nur deshalb verweigert, weil die Zelle unterdrückt war. Diese Unterdrückung entfällt jetzt, also öffnet `POST …/chart-rows` auch eine Zelle mit einer einzigen Anmeldung. `altersgruppe`/`geschlecht` haben kein `fold` und auch sonst keine Drill-Sperre (`src/lib/cockpit/semantic/registry.ts:144-160`). Ergebnis: eine Anmeldungs-`id` samt Bundesland, Kanal, Bank und Verbrauch, die über die Zellbeschriftung mit Altersgruppe und Geschlecht verbunden ist. Die Spalten-Allowlist (`DRILL_PII`) hilft hier nicht, weil Alter und Geschlecht im Prädikat der Zelle stecken und nicht in einer Spalte. Auch wenn die Zahlen exakt bleiben sollen, würde ich den Drill auf diesen beiden Achsen sperren (oder erst ab `MIN_N` öffnen) und das testen. Einen Test für den Drill auf diesen Achsen gibt es nicht: `drillCell` ist in `kleinzellen.test.ts:7` importiert, wird aber nirgends benutzt.

### 3. Legende und ⓘ versprechen den alten Schutz (Fehler, unabhängig von 1.)

- `src/lib/cockpit/begriffe.ts:482`, Kleinmengenregel: „… nach Altersgruppe oder Geschlecht steht jede Zelle unter 10 als „<10“.“ Die Legende ist laut AGENTS.md die Definition, und der Satz stimmt nicht mehr.
- `src/lib/cockpit/widget-catalog.ts:229`, ⓘ der Karte: „jede Zelle mit weniger als 10 Anmeldungen zeigt keine Zahl, auch mit Bundesland oder anderem Filter.“ Das Gegenteil ist jetzt der Fall.
- Kommentare: `src/lib/cockpit/semantic/default-charts.ts:70` („cells under 10 read "<10"“) und `src/lib/cockpit/semantic/views.ts:106`.

Kein Test fängt das ab: `tools/cockpit-begriffe.test.tsx` vergleicht nur Begriffe, keine Sätze. Wenn 1. so entschieden wird, bitte beide Texte anpassen. Sonst bleiben sie und der Code kommt zurück.

### 4. Kleinigkeiten

- `src/lib/cockpit/semantic/kleinzellen.test.ts:25`: der Helfer `withheld` ist nach dem Umbau ungenutzt, `drillCell` (Z. 7) ebenso.
- Der Commit-Text von 9df0610 nennt die „complement protection for shares“ unverändert. `protectComplement` (`src/lib/cockpit/semantic/engine.ts:291`) greift aber nur bei `anzahl`/`summe` mit `minN` und nie bei Anteilen. Das ist nur eine Ungenauigkeit im Text, kein Fehler im Code.
- Ein unterdrückter Anteil auf diesen Achsen („n < 10“) lässt sich jetzt aus den exakten Zählern derselben Karte ausrechnen. Das ist in Ordnung, wenn Zahlen exakt sein sollen. Der Hinweis „n < 10“ schützt dort dann aber nichts mehr.

### Prüfumfang

Statisch geprüft, Tests nicht ausgeführt. Relevant sind `npm run cockpit:test` (u. a. `kleinzellen.test.ts`, `bank-*.test.ts`, `iban-bundesland.test.ts`, `numbers.test.ts`, `tools/cockpit-bank-tab.test.tsx`, `report-email.test.ts`) und `npm run cockpit:test:db` (`parity.db.test.ts`, `chart-rows.db.test.ts`, `bank-parity.db.test.ts`, `payload.db.test.ts`). Den Bank-Teil (b3ad9cf) konnte ich nur im Endstand lesen, nicht als Diff gegen die Basis. Dort habe ich keine Reste des alten „withheld“-Payloads und kein „<10“ auf der Karte mehr gefunden.
