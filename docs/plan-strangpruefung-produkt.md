# Plan: In-strand check loop in the product (replaces the test harness `schleife2.sh`)

Status: plan, 08.11.2026. Basis: council `council-strangpruefung-0811.md` (8 conditions) + timing checkpoint `messpunkt-tempo-0811.md`.

## Cause (measured, not guessed)

The loop lives in a shell harness outside the product. That is why:
1. **Rounds run to the cap.** The cross-checker has no "done, nothing found" signal; it stops only after writing tests. F4 round 4: no finding, 600 s. P1: 10.4 min, rc=124.
2. **Lenses run in sequence on one model.** One checker does logic and contracts/security one after the other.
3. **A red gate is reported as "converged".** F4: gate red, loop said converged. The gate output is not kept.
4. **Retry chain is wrong.** `rennen` escalates to glm-5.3 with the logs; the council dropped that stage (same builder with gate output → Sonnet → back to the plan).
5. **Nothing is measured on the product path.** Phase times live only in my log files.

## Before → after

| | Before | After |
|---|---|---|
| End of a check round | cap (10 min) or tests written | explicit line `ERGEBNIS: keine Befunde` / `ERGEBNIS: <n> rote Tests`; missing line = checker failed, not "clean" |
| Lenses | sequential, one model | parallel: logic on the other flash model, contracts/security on the second one |
| Red gate | "converged" | retry: same builder with gate output, then Sonnet, then "back to the plan" |
| Escalation | glm-5.3 | Sonnet (council) |
| Builder prompt | plan only | plan + lean test-first rules (test from DoD first, run affected tests + tsc before commit) |
| Measurement | harness log | ledger event per item: phase times, rounds, red tests, gate log tail |

## Items (≤ 3 files, 1 new public interface each)

| # | Item | Files | Route |
|---|---|---|---|
| L1 | Pure loop core `strangpruefung.ts`: `ergebnisLesen(text)`, `pruefSchleife(deps)` (lenses parallel, count only red tests on HEAD, stop when a round yields no new red test, cap 4), constants `BAUER_REGELN`, `LINSEN` | NEW `claude-bridge/src/strangpruefung.ts`, NEW `claude-bridge/test/strangpruefung.test.ts` | flash pair |
| L3a | Retry chain per council, pure part: no glm-5.3 stage; both red → same first builder with the red logs; that red too → `lauf.weiter = 'sonnet'` (no `bauen('sonnet')`, OC2 cannot run Sonnet); `nachAblehnung` after 2 fix rounds → `{ art:'sonnet', fehlerlogs }` | `claude-bridge/src/bauerrennen.ts`, `claude-bridge/test/bauerrennen.test.ts` | flash pair |
| L3b | Wire L3a: `bestofnStrang` returns `ok:false` with the existing Sonnet-class reason when `lauf.weiter === 'sonnet'`; `bestofnAblehnung` passes `art:'sonnet'` through; `sessions.ts` hands that to the same path as the Sonnet class instead of running `SONNET` on OC2 | `claude-bridge/src/bauerstrang.ts`, `claude-bridge/src/sessions.ts`, `claude-bridge/test/bauerstrang.test.ts` | Sonnet (with L2, sequential commits) |
| L2 | Wire L1 into `bestofnStrang`: after the winner is chosen and before it is applied, run `pruefSchleife` in the winner's sub-worktree (checker = `o.zug` with the other model + lens prompt, fixer = `o.zug` with the winner model, 10 min signal cap per call), then re-run `voll`; red → L3 chain; builder prompt gets `BAUER_REGELN`; ledger event gets `phasen` + `gateLog` | `claude-bridge/src/bauerstrang.ts`, `claude-bridge/src/bauerrennen.ts` (ledger type only), `claude-bridge/test/bauerstrang.test.ts` | Sonnet (after L1, L3a) |

Switch: `BRIDGE_STRANGPRUEFUNG=aus` turns the loop off (old path). Default on.

## DoD (verbatim, per item)

- **L1:** Tests, red before (module missing), green after:
  (a) `ergebnisLesen('…\nERGEBNIS: keine Befunde')` → `{ art:'keine' }`; `'ERGEBNIS: 2 rote Tests'` → `{ art:'rot', n:2 }`; text without the line → `{ art:'ohne' }`.
  (b) `pruefSchleife` with fake deps: both lenses are called in the same round in parallel (both started before either resolves).
  (c) A reported test that is green on HEAD does not count as a finding.
  (d) Round 1 two red tests → fixer called once with their log → round 2 `keine` on both lenses → ende `'konvergiert'`, runden 2.
  (e) Every round yields a new red test → stops after 4 rounds with ende `'deckel'`.
  (f) A lens returning `ohne` is reported as `pruefer-ohne-ergebnis` and never counted as clean.
  (g) Phase times (`testMs`, `pruefMs`, `fixMs`) are returned per round with an injected clock.
- **L3a:** Tests, red before, green after: both builders red → the next `bauen` call is the **same** first builder with `fehlerlogs` containing both red logs (glm-5.3 never called); that red too → `lauf.weiter === 'sonnet'`, `lauf.sieger === null`, no `bauen('sonnet')`; a green retry wins normally; cap overrun on both builders → `zerlegen`, no retry (unchanged); `nachAblehnung` after 2 rejected fix rounds → `{ art:'sonnet', fehlerlogs }`. Existing tests that assert the glm-5.3 stage (bauerrennen.test.ts ~l.98-115) are changed **only** in those assertions, named in the commit message.
- **L3b:** Tests, red before, green after: `bestofnStrang` with fakes where all builds stay red → `{ ok:false }` with the Sonnet-class reason; no OC2 `zug` with model `sonnet` is ever started (sessions path: `bestofnAblehnung` → `art:'sonnet'` → same handoff as the Sonnet class).
- **L2:** Tests, red before, green after: fake `zug` where the checker writes a red test in round 1 and `ERGEBNIS: keine Befunde` in round 2 → the winner's diff applied to the strand contains the fix and the checker's test; ledger event has `phasen` with ≥ 2 rounds and a `gateLog`; checker prompt contains only diff, DoD and tests (no builder text); `BRIDGE_STRANGPRUEFUNG=aus` → old path unchanged; a red `voll` after the loop → L3 chain, never "ok".
- **All:** bridge `tsc --noEmit` 0 errors, no fixed ports, affected tests run twice in parallel green.

## Customer impact & process

No customer-facing change. Internal: builds through the Werkbank get the same check depth as the harness had today, without cap waits; every item's phase times land in the ledger, so the next timing checkpoint is measured on the product path.

## Not in this plan

- Mutation-lite in `abnahme.sh` (own item, after L2).
- Retiring `schleife2.sh`: once L2 is merged, items run through the product strand.
