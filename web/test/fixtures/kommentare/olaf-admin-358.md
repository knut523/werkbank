Empfehlung: comment

Kleine, saubere Änderung: eine Datei (`src/app/sammelanmeldung/page.tsx`, +16/−1). Es gibt keine Migration, kein neues Recht und keine neuen Personendaten. Die Links nutzen die bestehende Route `GET /api/admin/bulk-registrations/template`. Sie prüft serverseitig `bulkRegistration.view` (`bulkGate`), also dasselbe Recht wie der `PermissionGate` der Seite. Ist das Feature aus, liefert die Seite schon über `layout.tsx` 404. Die Schlüssel von `KIND_LABEL` (`buendel`, `hausverwaltung`) passen zu dem, was die Route versteht. Von mir aus kann das so rein. Zwei Punkte würde ich vorher noch ansehen:

**1. Eine stehengelassene Beispielzeile wird als echter Zählpunkt importiert** (`src/lib/bulk/columns.ts:107`, `src/lib/bulk/validate.ts:224`)
Bisher kam die Vorlage nur im Vorgang zum Team. Jetzt ist sie ausdrücklich dafür gedacht, sie an Kund:innen weiterzugeben. Die Beispielzeile besteht aber jede Prüfung in `validate.ts`:
- Der Zählpunkt `AT0010000000000000001000004711234` hat 33 Zeichen, das Kürzel `AT001000` ist bekannt, an der 9. Stelle steht eine 0.
- Nichts im Import erkennt die Zeile als Beispiel.

Liefert eine Kund:in die Liste mit der Zeile zurück, landet „Ringstraße 4, Eisenstadt, 3500 kWh“ als gültige Zeile im Vorgang. Hält auch die Bestätigung sie nicht auf, wird sie bei MAXENERGY angemeldet.
Vorschlag: In `validate.ts` den Beispiel-Zählpunkt als `fehler` markieren („Beispielzeile aus der Vorlage — bitte löschen“). Er ist als Konstante aus `columns.ts` greifbar, und der Test in `tools/bulk-registration.test.ts` deckt ihn mit einer Zeile ab. Das Risiko gab es vorher schon, durch diesen PR wird es aber deutlich wahrscheinlicher.

**2. Kleinigkeiten (kein Muss)**
- `page.tsx:26`: Die Liste sagt „Beispieldatei …“, die Detailansicht für dieselbe Datei „Vorlage Excel“ (`src/components/bulk/BulkDetailView.tsx:227`), und der Dateiname heißt `Vorlage-Sammelanmeldung….xlsx`. Ein Wort für beide Stellen wäre besser, z. B. „Vorlage (Excel): Hausverwaltung“.
- „Beispieldatei Mehrere eigene Zählpunkte“ ist recht lang. Mit `wrapActions` rutschen die drei Buttons auf schmalen Breiten in eine zweite Zeile. Das ist so gewollt, aber der Kommentar in `src/components/AdminShell.tsx:196` nennt `wrapActions` noch „die Ausnahme (Cockpit)“. Den Kommentar würde ich nachziehen.
- `src/components/bulk/shared.ts:5`: `KIND_LABEL` ist `Record<string, string>`. Bekommt die Liste einen dritten Typ und die Route nicht, liefert sie für den neuen Link still die Bündel-Vorlage (`route.ts:11`). Mit `Record<BulkKind, string>` würde das schon beim Kompilieren auffallen.
- Die Zeile `info` an derselben `AdminPage` hat noch das Schrägstrich-Paar „die Kundin / der Kunde“, die Zeile `description` das ausgeschriebene Paar „Kundinnen und Kunden“. Laut Stilregel werden beide beim Anfassen ersetzt („die Kund:in“, „Kund:innen“). Optional, weil die Zeilen selbst nicht geändert sind.

Tests: Statisch geprüft, nichts ausgeführt. Für den neuen Code gibt es keinen eigenen Test. `bulk-registration:test` deckt `templateCsv`/`templateXlsx` ab, `nav:test` (`ui-rules`) die Schriftgrößen-Regel, an die sich der Diff hält.
