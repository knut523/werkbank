Empfehlung: comment

## Review of c00ec85 (static, nothing executed)

No blocker found in the places checked. The migration, the Plan-114 read paths for IBAN and bank code, the client-import guard and the layout `known` fix look sound. Two points, and one caveat on coverage.

### Findings

1. **Without PII keys the cockpit does not load, but the description says it does.** `src/lib/cockpit/iban-bundesland-load.ts:20-26` catches only `PiiDecryptError`. Its own comment says "Missing keys still throw", and `open()` throws `PiiKeyUnavailableError` when the keys are not ready (`src/lib/pii-crypto.ts:136`). The error goes up to `src/app/api/admin/cockpit/route.ts:89-93`, which returns a 500 for the whole cockpit. The Infra note ("Without them sealed IBANs count as 'nicht lesbar', the cockpit still loads") and manual steps 0.3 and 2.3 describe something different. This is not a regression: the base already opens `date_of_birth` in the same route. Please either fix the description and test plan, or count `PiiKeyUnavailableError` as "nicht lesbar" if the claim is meant.
2. **Every cockpit GET decrypts in the process (plausible, not measured).** `src/app/api/admin/cockpit/route.ts:670` loads `payment_details` for every contract in the window and opens each IBAN. `src/lib/cockpit/bank-tab-load.ts:20-46,83` opens the prefill body of every Bank-Lead, for all time and not only the window. Both run on every load, whichever tab is open. For long windows this costs CPU and memory on each request. It is worth a measurement on dev data, or a note under D2 (stored BLZ column).

3. **A pass abandoned mid-way can read "Läuft" in the Protokoll indefinitely.** Expired `link_audit` rows are reaped only by the link-audit GET (`src/app/api/admin/joules-link-audit/route.ts:246`) and by the next pass start (`src/lib/joules/scheduler.ts:267`). The sync-log GET never reaps. The claim "abgebrochen after 30 min" therefore holds only in the tab, not in the Protokoll. Reaping the logged kinds in the sync-log GET, or showing `claimed_until < now()` as abandoned, would close this.
4. **A client-side page failure leaves the pass "Läuft" for up to 30 min** (`src/components/sync-log/LinkAuditTab.tsx:186-191`). Only server-side page failures are closed at once (`failRun`, `route.ts:218`). The page POST also has no offset check (`route.ts:205-225`): if the same page arrives twice it is counted twice. The UI sends pages one after another without retry, so this is a nit.

### Checked, nothing to report
- Datenabgleich: a pass is one run, and `reapExpired` filters by kind, so other runs are never marked aborted. The page reply carries counts only (`route.ts:237-238`). POST and GET require `dataSync.modify`, and 2FA is enforced for `/api` routes.
- Migration `20261017100000_in_belieferung_one_definition`: it is additive. A second run writes no second audit row, a negative-listed status is skipped, and the revert can be rebuilt from its audit rows. The test `src/lib/cockpit/in-belieferung-migration.db.test.ts` covers two runs.
- `bankTabPromise.catch(() => undefined)` (`route.ts:146`) does not swallow errors. It only marks the promise as handled, and the promise is awaited at `route.ts:736`.
- `contracts.external_details` is not sealed (`src/lib/pii-fields.ts:99`), so the raw `external_details->'partner'` SQL in `bank-tab-load.ts` reads plain codes.
- The client-import guard now also refuses `@/lib/pii-crypto` and `node:` imports, through transitive imports too (`tools/cockpit-client-imports.test.ts`).

### Coverage caveat
This pass did not cover access control per changed route (team layout and KPI defaults, `cockpit.advisors` on export and report), small-cell suppression in the age and gender charts, or the Rechner card's error handling. A second pass should look at these before approval.
