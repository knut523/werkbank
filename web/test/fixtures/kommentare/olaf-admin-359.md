Empfehlung: request-changes

Danke für den schnellen Fix für UAT. Das Problem ist echt: Wer das Recht hat, sieht dort trotzdem eine 404. Der PR löst es aber, indem er den einzigen Schalter entfernt, der die Sammelanmeldung in Prod geschlossen hält. Plan 088 (Deploy-Tabelle und *Pilot clearance*) sowie `AGENTS.md` (Abschnitt Sammelanmeldung: „No deletion job yet — a precondition for any switch outside Dev") verlangen genau diesen Schalter.

**1 · Blocker: In Prod ist die Sammelanmeldung nach dem Deploy für jeden Superadmin offen**

- `src/lib/bulk/route-auth.ts:16`: `bulkGate` prüft jetzt nur noch Session und `hasPermission(…, 'bulkRegistration', …)`. `hasPermission` (`src/lib/permissions.ts:210`) gibt für `role === 'admin'` immer `true` zurück. „Das Recht ist das Tor" heißt in Prod also: Jeder Superadmin kann Vorgänge anlegen, IBANs und Vollmachten hochladen und Codes senden.
- Der Schalter bleibt zwar am Scheduler, aber `processBulk` läuft auch über drei Request-Pfade. Damit startet es Durchläufe zu MAXENERGY auch ohne Scheduler:
  - `src/app/api/admin/bulk-registrations/[id]/process/route.ts:19` („Status abgleichen")
  - `src/app/api/bulk-confirmation/[id]/route.ts:97` (die Kund:in bestätigt; die Route ist öffentlich)
  - `src/app/api/bulk/registration/route.ts:96`
- Plan 088 hält die Sammelanmeldung bis zur Pilotfreigabe aus allen Umgebungen außer Dev heraus. Das umfasst die Antworten von Rechtsberatung und MAXENERGY, den Löschjob für Vollmachten und Bestätigungen, den Malware-Scan des Containers `bulk-registration-poa` und den Datenschutz-Absatz. Für die Bulk-Tabellen gibt es weiterhin keinen Löschjob.

Vorschlag, je nachdem was gewollt ist:
- (a) Nur UAT soll gehen: Den Code lassen und `BULK_REGISTRATION_ENABLED=true` für UAT in olaf-umbrella setzen. Laut Plan 088 steht im Bicep heute `envClean == 'dev'`. Das ist eine Konfigurationsänderung ohne Code, und Prod sowie der Staging-Slot bleiben zu.
- (b) Seiten und Routen sollen grundsätzlich am Recht hängen: Dann braucht es weiter ein Tor je Umgebung an den Einstiegen, die schreiben oder `processBulk` starten. Zum Beispiel bleibt der Schalter dort, oder es kommt ein zweiter Schalter dazu. Außerdem müssen Plan 088 (Deploy-Tabelle, Zeile `BULK_REGISTRATION_ENABLED`: „pages, routes and the Sammel scheduler") und `AGENTS.md` in derselben Änderung nachgezogen werden.

**2 · UAT funktioniert so nur halb**

UAT hat laut Plan 088 `BULK_REGISTRATION_ENABLED=false`. Mit dem PR öffnen sich dort die Seiten, aber der Scheduler bleibt aus. Gestartete Durchläufe werden dann nicht abgeglichen, und Eingangs- und Abschluss-Mails gehen nicht raus, bis jemand „Status abgleichen" drückt. Für einen echten UAT-Test braucht es also ohnehin den Schalter auf UAT. Mit dem Schalter wäre aber der Code-Teil dieses PRs nicht nötig. Siehe 1(a).

**3 · Staging-Slot**

`src/lib/bulk/limits.ts:34–38` sagt, der Schalter halte den Staging-Slot „off". Das stimmt nur für den Scheduler. Über die Request-Pfade aus Punkt 1 schreibt ein Aufruf auf dem Staging-Slot Vorgänge in die gemeinsame Prod-Datenbank und startet Durchläufe. Andere Admin-Schreibwege tun auf dem Slot zwar dasselbe, aber hier geht es um MAXENERGY-Anmeldungen von Dritten. Bitte den Kommentar präzisieren oder das Tor aus 1(b) auch dort greifen lassen.

**4 · Tests**

`tools/bulk-registration-db.test.ts:180–185` und `tools/bulk-registration-customer-db.test.ts:137–142` setzen den Schalter auf `false` und erwarten jetzt 200. Damit prüfen sie, dass der Schalter nichts tut. Den verbleibenden Zweck, also Schalter aus → kein Scheduler, deckt kein Test ab. Wenn der Schalter wieder an Einstiegen greift (1b), sollten diese beiden Tests das wieder absichern. Sonst wäre ein kleiner Test für `startBulkRegistrationScheduler` mit Schalter aus sinnvoller als die umgedrehte Erwartung.

Ohne Befund: Mit `src/app/sammelanmeldung/layout.tsx` entfällt auch `force-dynamic`. Das ist folgenlos, weil alle drei Seiten `"use client"` sind. Die Kommentare in `src/instrumentation.ts:54` und `src/lib/bulk/scheduler.ts:6` passen zum Code.

Nicht ausgeführt, nur statisch geprüft. Relevante Läufe: `npm run bulk-registration:test`, `npm run bulk-registration:test:db` (Scratch-DB), `npm run permissions:test`.
