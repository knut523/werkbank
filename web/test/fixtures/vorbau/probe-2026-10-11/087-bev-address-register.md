# Plan 087 — The BEV Adressregister: address search in the forms, geocoding without a third party

**Status:** built 2026-10-06, all three as draft PRs: S1 olaf-admin#267 (§12), S2 olaf-tariff-app#192 and S3 (built as olaf-durable-func#90, merged into #85 on 2026-10-07, §13). Not yet imported anywhere; S0 step 3 open. Council HOLD (§10); spike S0 done (§11).
**Related:** plan 049 (ECP completion, the Netz NÖ station lookup), `ecp-transmission-station-lookup.md`,
olaf-durable-func#85 (its binding condition: no production ECP flag before the Nominatim sign-off).

## 1. Goal

Olaf keeps its own copy of Austria's official address register (BEV, *Adressregister — Stichtagsdaten*)
and uses it for two things:

1. **Address search in the tariff app's forms** — registration (main address and every meter point's
   different address) and the battery booking — so a customer picks an address that exists, spelled the
   way the register spells it.
2. **Geocoding for the Netz NÖ transmission station lookup** — the coordinate comes from our own table,
   not from `nominatim.openstreetmap.org`.

Afterwards no customer address leaves our systems for a geocoder: neither the typed search text (today
Photon) nor the meter point's address (today Nominatim, plan 049). This stands on its own, ECP or not.

## 2. Current state (verified 2026-10-05)

**Who already has what:**

| Source | Has | Lacks | Read how |
|---|---|---|---|
| ECP (Enlion) | BEV street directory: 143,703 rows of PLZ / Ort / Straße, 2,232 PLZ; footer "© Österreichisches Adressregister, Stichtagsdaten vom 01.04.2026" | house numbers, coordinates, address code | `GET /addresses/query`, `/addresses/postal-codes/{plz}/lookup` (demo, read-only) |
| MAXENERGY / Joules Service API | `GET /cities?zip=`, `GET /streets?zip=&city=&term=` (lists of strings), `/netOperator?zip=` | house numbers, coordinates | `test.joulesapp.de` spec, `r=service/doc/yaml`, lines 308 and 517 |
| BEV, open data | every officially assigned address with address code (`ADRCD`) and coordinate | — | CSV, "Adressregister Relationale Tabellen — Stichtagsdaten" |

Neither ECP nor Joules can replace a geocoder: both stop at the street.

**The tariff app today:**

- `src/app/api/address/suggest/route.ts:8` proxies **Photon** (`photon.komoot.io`, OpenStreetMap) for the
  battery booking form (`src/components/battery/AddressFields.tsx:44`). Every keystroke after three
  characters goes to Komoot with our server's IP. Rate limits and cache are in the route (`:17–45`).
  `src/lib/address-suggest.ts` normalises Photon's answer to `{label, streetName, houseNumber, zip, city}`.
- The registration form has no search: free text in `StepPersonal.tsx:278–353` (main address) and
  `StepTariff.tsx:290–299` / `:387–396` (a meter point's different address).
- The DTO carries the main address as `Strasse` / `Hausnummer` / `Plz` / `Ort`
  (`src/lib/mappers/contract.ts:256`) and a different meter address as a German-keyed JSON string
  (`buildAddressJson`, `contract.ts:17`, written at `:199` / `:213`).

**olaf-durable-func (branch `feat/049-ecp-completion`):** `src/lib/noeTransmissionStation.ts:52`
`NOMINATIM_URL`; `lookupNoeTransmissionStation` (`:208`) geocodes at `:219`, accepts only an exact house
