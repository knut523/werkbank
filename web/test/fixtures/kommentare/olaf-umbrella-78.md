Empfehlung: request-changes

Danke, die Doku zieht sauber nach, was olaf-admin#359 im Admin ändert. Vor dem Merge ist aber eines zu klären: Dieser PR öffnet die Sammelanmeldung auf UAT **und Prod**. Er ist nicht nur Buchhaltung zu #359.

**1 · Blocker: `true` auf jeder Hauptseite hebt die Entscheidung vom 05.10. für Prod auf**

- `infra/modules/app-service.bicep:418` setzt `BULK_REGISTRATION_ENABLED` fest auf `'true'`, für jede Umgebung. Die App-Settings sind im Bicep vollständig deklariert. Deshalb schreibt jedes `azd provision --environment olaf-prod` den Wert, auch eine Routine-Provision für etwas anderes (etwa den WAF-Rollout aus #77).
- Was dann in Prod offen ist, hängt am Admin-Stand:
  - **Admin-Release mit dem Stand von `main` ohne #359:** Der Schalter öffnet in Prod Seiten, Routen und Scheduler zugleich.
  - **Mit #359:** Das Recht `bulkRegistration` ist das Tor. Das hat die Rolle `admin` immer (README Z. 242 sagt es selbst). Jeder Admin kann also in Prod Vorgänge anlegen, Vollmachten hochladen und Anmeldungen an MAXENERGY auslösen. Der Scheduler verschickt dazu Mails.
- Plan 088 hält die Sammelanmeldung bis zur Pilotfreigabe aus UAT und Prod heraus. Dazu gehören die Antworten von Rechtsberatung und MAXENERGY, der Löschjob, der Malware-Scan des Containers und der Orchestrator in Prod. `_releases/v1.6.0.md:16–20` beschränkt diese Zusage jetzt auf die Kundenroute. Eine neue Freigabe für den Admin in Prod ist im PR aber nicht belegt. Die Verlagerung des Tors (Christoph, 17.10.) ist eine technische Änderung, keine Pilotfreigabe.

Vorschlag, je nachdem, was gewollt ist:
- (a) **Nur UAT soll gehen:** `value: envClean == 'prod' ? 'false' : 'true'`, oder ein Wert über `sammelOnHere`, erweitert um UAT. Damit braucht es olaf-admin#359 für UAT gar nicht: Der Schalter öffnet dort heute schon Seiten und Routen.
- (b) **Prod ist bewusst freigegeben:** Dann bitte die Freigabe (wer, wann) in `_releases/v1.6.0.md` und im README nennen. Die Release-Notes sollten außerdem sagen, dass die nächste Prod-Provision den Admin-Teil öffnet.

**2 · README: „merging the template changes nothing live“ stimmt nur halb**

`infra/README.md:267–268`: Der Merge selbst ändert nichts. Die nächste Provision einer Umgebung setzt aber `BULK_REGISTRATION_ENABLED=true`, egal aus welchem Grund sie läuft. Die Schritte 1–4 steuern nur Container, Rolle und `BULK_POA_CONTAINER_URL`; diese hängen an `BULK_REGISTRATION_POA`. Den Schalter steuern sie nicht. Bitte so formulieren, dass klar ist: Der Admin-Schalter kommt mit jeder Provision, der Container erst mit Schritt 4. Ein Hinweis darauf, dass der Satz nur für den Container gilt, würde reichen. Ebenso wird die Zeile `uat … not set (pages 404 until olaf-admin#359)` (Z. 264) mit der ersten UAT-Provision falsch.

**3 · Scheduler an, Vollmachten-Ablage aus**

Nach einer Provision mit `BULK_REGISTRATION_POA` ungesetzt (Default `disabled`, `infra/main.parameters.json:51`) laufen UAT und Prod mit `BULK_REGISTRATION_ENABLED=true`, aber ohne `BULK_POA_CONTAINER_URL`. Der Admin meldet dann „Vollmacht storage is not connected“, und Uploads scheitern. Heute schützt die Kopplung an `envClean == 'dev'` davor. Entweder den Schalter an `effectiveBulkRegistrationPoa` koppeln (`bulkPoaContainerUrl` nicht leer), oder den Zustand im README ausdrücklich als „erwartet bis Schritt 4“ nennen.

**4 · Rollback (`infra/README.md:288–289`)**

- „`BULK_REGISTRATION_ENABLED=false` stops the scheduler (nothing is filed or mailed)“ gilt mit #359 nicht mehr ganz. `processBulk` läuft auch über Request-Pfade: Status abgleichen, Kundenbestätigung, Registrierung (siehe Review zu olaf-admin#359). Es kann also weiter etwas eingereicht werden.
- „taking the `bulkRegistration` right away closes the admin pages“ greift nicht für die Rolle `admin`, die jedes Recht hat. Für Admins gibt es damit keinen Not-Aus ohne Deploy. Bitte den Rollback ehrlich beschreiben, etwa als Revert bzw. erneutes Deployment des Admin-Releases. Besser wäre ein Schalter, der auch die schreibenden Einstiege schließt.

**Ohne Befund:** Staging-Slot bleibt `false` (`app-service.bicep:421–426`), und `BULK_REGISTRATION_ENABLED` steht weiter in `slotConfigNames` (Z. 1106, via `adminBulkStickyAppSettingNames`). Ein Swap tauscht den Wert also nicht. `SAMMELANMELDUNG_ENABLED` folgt unverändert `sammelOnHere`. Es kommt kein neues `${VAR}` in `main.parameters.json` dazu.

Nur statisch geprüft, nichts ausgeführt. Vor dem Rollout: `azd provision --preview --environment olaf-uat` bzw. `olaf-prod`, und im Diff auf die Admin-App-Settings achten.
