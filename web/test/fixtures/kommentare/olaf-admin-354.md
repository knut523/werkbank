Empfehlung: approve

Danke — sauber geschnitten (drei Commits, je eine Migration), additiv, und die Nebenläufigkeit ist ungewöhnlich gründlich durchdacht (Row-Locks, `updatedAt`/`baseTabs` als Versionsprüfung, Advisory-Lock beim Anlegen, Audit in derselben Transaktion). Statisch geprüft am Stand `16b073c`, Tests nicht ausgeführt. Keine blockierenden Befunde; die Punkte unten sind Nacharbeit oder Fragen.

**Geprüft und in Ordnung**
- Migrationen `20261017110000` / `…120000` / `…130000`: nur `ADD COLUMN` / `CREATE TABLE`, FK mit `ON DELETE CASCADE`, eindeutiger Name ohne Groß-/Kleinschreibung über `lower(name)` (gleiches Muster wie `20261016120000_benutzer_konzept`). Keine Append-only- oder `tariff_*`-Tabelle, die App-Rolle braucht also kein `REVOKE`.
- Rechte: alle Team-Schreibrouten laufen über `requireCockpitActor(…, 'settings', { write: true })` (CSRF/JSON + 2FA); die persönlichen Writes nehmen `refuseCrossSite`. Der Client schickt überall `Content-Type: application/json`, auch beim DELETE ohne Body.
- DSGVO: Autorenspalten und Mitglieder speichern die Benutzer-ID (E12), stehen in `OWNER_COLUMNS`/`COCKPIT_AUTHOR_COLUMNS`; `tools/cockpit-retention-db.test.ts` deckt Anonymisieren und Austragen ab. AGENTS.md ist nachgezogen.
- Eigene Charts in Team-Layouts zählen als „verwendet“ (`own-chart-usage.ts`).

**Nacharbeit (nicht blockierend)**
1. `src/lib/cockpit/team-layouts.ts:209` — `deadlock()` erkennt nur `40P01`/„deadlock detected“ im Text. Wenn der Deadlock bei einem Prisma-Model-Aufruf auftritt (z. B. `tx.cockpit_team_layouts.update` für das Quell-Layout in `replaceMembers`), kann Prisma ihn als `P2034` („write conflict or a deadlock“) melden — dann kommt eine 500 statt der vorgesehenen 409. Vorschlag: `P2034` mit aufnehmen.
2. `src/app/api/admin/cockpit/layout/route.ts:115` — der persönliche PUT liest den gespeicherten Stand und macht dann einen Upsert, ohne Transaktion. Zwei Fenster derselben Person (die Warteschlange in `Cockpit.tsx` wirkt nur in einem Tab) können sich überschreiben: ein Tab löscht einen eigenen Tab, der andere speichert gleich danach ein Layout auf altem Stand, und die Karten des gelöschten Tabs sind wieder drin. Selten und nur für die eigene Ansicht; ein `FOR UPDATE` auf die Zeile in einer Transaktion würde reichen.
3. `src/lib/cockpit/team-layouts.ts:262`, `src/app/api/admin/cockpit/layout/team/route.ts:65`, `src/app/api/admin/cockpit/settings/route.ts` (`teamTabsBase`) — ein fehlerhaftes `baseTabs` (Parse ergibt `null`) wird als 409 „inzwischen geändert — bitte neu laden“ beantwortet. Neu laden hilft da nicht. Ein 400 mit `TAB_LIST_INVALID` wäre ehrlicher.
4. `src/lib/cockpit/team-layouts.ts:292` — schlägt ein PATCH ohne `name` mit einem Unique-Verstoß fehl, lautet die Meldung „Ein Team-Layout „undefined“ gibt es schon.“ Den 409 nur werfen, wenn `name !== undefined`.
5. `src/lib/cockpit/team-layouts.ts:202` — `assertFresh` prüft nur, wenn `updatedAt` ein String ist; jeder andere Typ schaltet die Prüfung still ab. Der Editor schickt immer einen String, aber ein 400 für „mitgeschickt, aber kein String“ kostet eine Zeile.

**Fragen / zur Kenntnis**
- `src/lib/cockpit-auth.ts:51` — der Settings-PATCH (Zählregeln, KPI-Kacheln, Konversionsfenster) verlangt jetzt `twoFactorEnabled === true`, während `verifyAdminSession` `null` noch durchlässt (`!== false`). Wer `cockpit.settings` hat und `twoFactorEnabled = null` in der DB, kann diese Einstellungen ab dem Deploy nicht mehr speichern. Gewollt, so wie bei #324? Dann vor dem Ausrollen einmal zählen, wen das betrifft.
- `src/lib/cockpit/layout.ts:277` — `parseHiddenTabs` verweigert, alle sechs festen Tabs auszublenden, auch wenn das Layout eigene Tabs hat, die sichtbar bleiben würden. Ist das Absicht (DoD 3 gilt nur für feste Tabs), oder soll „mindestens ein Tab sichtbar“ auch eigene Tabs zählen?
- `src/lib/cockpit/team-layouts.ts:81` — `activeStaff()` bietet alle aktiven Benutzer zum Zuordnen an, auch solche ohne `cockpit.view`. Das schadet nicht, macht die Liste aber länger. Lieber auf Benutzer mit Cockpit-Zugang filtern?
- `src/components/cockpit/Cockpit.tsx` wächst auf rund 1500 Zeilen. Die Logik für Veröffentlichen und Tabs wäre ein Kandidat für einen eigenen Hook — eher etwas für eine eigene Änderung als für diesen PR.
