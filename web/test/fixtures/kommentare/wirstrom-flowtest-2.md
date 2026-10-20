Empfehlung: comment

**Automated review (deep) at e20f7ec** — static deep review — no package.json in the repository. No commands from the PR were executed; only `py_compile` of `flowrunner.py` / `flowdash_server.py` (passes) plus a trace of the new case keys and their consumers in `flowdash_server.py`.

The new suite entries are wired correctly: `meter_later` / `einspeisung` are handled in `flowrunner.py`, `mode: angebot` and `linear` already exist in `flowrunner_hw.py` (`flowrunner_hw.py:40`, `:82`, `:103`), and `me_ok` is defined in the same block before the new Joules check uses it. Ignoring `runs/` is the right call for live registration data. Two points in the new coupon evaluation, though, mean the coupon cases (#24–#26) can report green where they should not — worth fixing before anyone relies on them.

### Should fix

1. **An invalid code that reaches Joules is logged as a success** — `flowrunner.py:800-803`. The `_got == _wanted` branch runs before the `expect_invalid` branch, so for #26 COUP-INVALID a code that *does* end up in `couponData.coupon_code` is appended to `R["good"]` instead of producing a `FINDING`. Today #26 can only fail via `is_valid == true` in the validation response. Suggested order:
   ```python
   if case.get("expect_invalid"):
       if _got == _wanted:
           R["findings"].append(f"FINDING: invalid code '{_wanted}' reached Joules couponData")
   elif _got == _wanted:
       R.setdefault("good", []).append(...)
   ```
   Related: if `?code=NOPE-XYZ-000` triggers no `/coupon/validation` call at all, `:528` skips the finding because of `expect_invalid`, and `:802` skips the Joules check — #26 then checks nothing and still goes green on `contract_created`. Recording at least `coupon_validation_called = False` (or a finding) would make the case meaningful.

2. **Fail-soft paths are invisible in the dashboard** — `flowrunner.py:530-531`, `:795-796`, `:801`, `:806`. `R["good"]`, `R["notes"]`, `coupon_parse_error` and `joules_coupon_parse_error` are never read by `flowdash_server.py` (`analyze()` and `positives()` build their own lists; only findings matching `FINDING|BESTAETIGT|akzeptiert` are surfaced). Consequence: if the `/coupon/validation` body cannot be parsed, `coupon_valid` stays `None`, and a *valid* code that never reaches Joules is downgraded to an unseen note (`:804-806`) instead of the `FINDING` at `:808`. Suggest emitting parse errors as a `FINDING` (or a `mittel` flag in `analyze()`), and either rendering `good`/`notes` or adding a coupon line to `positives()`.

### Worth a look

3. **`_find_cc` takes the first `coupon_code` anywhere in the orchestration output** — `flowrunner.py:776-793`. If `submitToAdmin` (or any step) echoes the submitted code, the check reports "arrived at Joules" without Joules having it. Scoping the search to `out["submitToMaxEnergy"]` would match the claim in the message.
4. **`?code=` now lives in `url`, which other paths reuse** — `flowrunner.py:356` vs. `:824` and `:867`. The recurring path builds `url.replace("/anmelden", "/api/admin/tariff/prefill") + "?email=…"`, which becomes `…/prefill?code=X?email=…` when a case combines `code` and `email: wiederkehrend`. No current suite case does, so this is latent; keeping the base URL in its own variable avoids it.
5. **#27 P-0ZP-1E relies on the consumption meter input staying in the DOM** — `flowrunner.py:613-620`. With `meter_later`, the feed-in meter is typed at index `verbrauch + j` (= 1). That only works if the frontend disables rather than removes the consumption `meterNumber` input; otherwise the feed-in meter and its provider are silently skipped. The dashboard only checks `Einspeiser == "Ja"` in the payload (`flowdash_server.py:105-107`), not that the feed-in meter number was transmitted — so the PR's "verify the feeder is still transmitted" is only partly asserted. One live run with a payload check would settle it.
6. **`ma_expected` only suppresses** — `flowrunner.py:524`. For #23 MA-Wien nothing asserts that the employee fields actually appear; a regression where `MA_WIEN` stops triggering them would stay green.
7. **#23 MA-Wien may pick up a new finding** — `flowrunner.py:804-808`. The Joules branch treats a code as "employee/special code → note only" only when `coupon_valid` is falsy (comment at `:805`). If `/coupon/validation` returns `is_valid: true` for `MA_WIEN` (the dashboard already calls it "Coupon gueltig", `flowdash_server.py:127`) and the code isn't in `couponData`, the existing case now ends in the `FINDING` at `:808`. Keying that branch on `case.get("ma_expected")` / `R.get("coupon_ma_triggered")` instead of `coupon_valid` would make the intent explicit.

### Nits

- `.gitignore`: `ma_dump.py` is already covered by `*_dump.py`.
- The coupon codes `JOE-BONUS2026` / `NOPE-XYZ-000` (`flowdash_server.py:44-46`) are only defined in the SUITE; a one-line note on where they are configured and what they are expected to return (valid customer bonus / unknown) would help the next person reading a finding.
- `runs/*.json` contains the full result incl. OTP and temp-mail address (`flowdash_server.py:174-179`, `flowrunner.py:432`) — the ignore rule is the right control here; the values are throw-away test data, so nothing more needed.
- `flowrunner.py:515`: `import json as _json0` — `json` is already imported at module level (`flowrunner.py:12`).

Neither of the "should fix" items blocks the hardware or 0-ZP cases; they only affect how much the coupon cases can be trusted.
