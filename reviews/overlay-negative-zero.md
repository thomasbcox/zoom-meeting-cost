Date: 2026-07-20 · Branch: claude/overlay-negative-zero · Status: approved

# overlay-negative-zero — clamp the displayed total to ≥ 0 (BUG-3)

## Problem
The on-camera overlay and the panel preview can show a **negative near-zero** meeting-cost
total ("-$0.00" or a small negative) during the **first display-cadence bucket** — elapsed
< cadence, i.e. the first ~10 s at the default 10 s cadence. It self-clears after the first
cadence step.

Root cause: in bucket 0, `steppedElapsed` floors to 0, so `quantizeForDisplay`
([`client/src/lib/displayCadence.js:52`](../client/src/lib/displayCadence.js)) returns
`totalCost − costPerSecond × elapsedSeconds`. That is meant to land on ~$0, but `totalCost`
is `round2`'d in `buildOverlayState`
([`client/src/lib/overlayState.js:28`](../client/src/lib/overlayState.js)) and can lag
`costPerSecond × elapsed` early in a session, so the residual is **signed and sometimes
negative** → `formatMoney` renders a leading minus. Later buckets add whole positive
cadence-steps of cost that swamp the residual, which is why it disappears after the first
step. Tracked as **BACKLOG.md → BUG-3**. Visible first-impression glitch; wanted before the
Marketplace functional review.

## In scope
- The display quantizer `quantizeForDisplay` in `client/src/lib/displayCadence.js`.
- A unit test for the bucket-0 (`elapsedSeconds < stepSeconds`) case in the existing
  `client/src/lib/displayCadence.test.js`.

## Non-goals
- **No change to the internal accrual** (`App.jsx` `totalRef`/`elapsedRef`) or the cost math
  (`lib/cost.js`). This is display-only.
- No change to `formatMoney`, the overlay/preview components, cadence values, or defaults.
- Not attempting to eliminate the underlying total-vs-elapsed divergence at its source
  (that would touch the accrual — out of scope; the display clamp is the contained fix).

## Acceptance criteria
1. `quantizeForDisplay` never returns a negative `totalCost`: for any inputs, the returned
   `totalCost` is `>= 0`.
2. In bucket 0 (`elapsedSeconds < stepSeconds`), an input where `totalCost` is slightly below
   `costPerSecond × elapsedSeconds` (the negative-residual case) yields a displayed total of
   `>= 0` (and `0` when the live total is ~0) — no leading-minus render.
3. Behavior is unchanged wherever the **pre-clamp** quantized total is already non-negative:
   for those inputs the returned `totalCost` and `elapsedSeconds` are byte-identical to today
   (the floored bucket-start total that holds steady between boundaries). The clamp only
   changes results that were previously negative.
4. A unit test in `displayCadence.test.js` asserts the bucket-0 non-negative case (an input
   with `totalCost` a hair below `cps × es`), plus a regression assertion that an
   `es >= step` case is unchanged.
5. Display-only diff: `git diff --name-only main...HEAD` shows no product files beyond
   `client/src/lib/displayCadence.js`, `client/src/lib/displayCadence.test.js`, and
   `BACKLOG.md` (moving BUG-3 to Done) — the `reviews/overlay-negative-zero.{md,design.json}`
   workflow artifacts aside. No other product code.

## Test notes
- **AC1/AC2:** unit-test `quantizeForDisplay` with `{ totalCost: round2(cps*es) rounded down,
  elapsedSeconds: es (< step), costPerSecond: cps, stepSeconds: 10 }` such that
  `tc - cps*es < 0`; assert `result.totalCost >= 0` and `=== 0` for the ~0 case.
- **AC3:** the existing `quantizeForDisplay` tests (floor-and-walk-back, hold-steady,
  1 s cadence / BUG-2, guards) must still pass unchanged; add an `es >= step` assertion
  confirming the floored value is identical for a non-negative input.
- **AC5:** run `git diff --name-only main...HEAD` and verify no files appear beyond the three
  enumerated in AC5.
- **Gate:** `npm test && npm run build`.

## Open questions
1. **Clamp vs. reconcile (recommend clamp).** The minimal fix is `Math.max(0, …)` on the
   returned `totalCost` — clamps the signed residual to zero, provably non-negative, purely
   display-side. The alternative is to *reconcile* bucket-0 by computing the shown total from
   `cps × steppedElapsed` (the bucket-start estimate) instead of subtracting the fraction from
   a `round2`'d live total — arguably "more correct" but it changes the displayed number's
   derivation for every bucket, not just bucket 0, and risks a visible discontinuity vs.
   today's held value. **Recommendation: clamp** (contained, display-only, matches the
   Non-goals). Decide.
2. Elapsed clock is already floored to `>= 0` at `displayCadence.js:46`, so only the total
   needs clamping — no clock change. Confirm that's acceptable (clock stays `00:00:00` through
   bucket 0, as today).

## Design sketch — HOW
Clamp the displayed total at zero in `quantizeForDisplay`
(`client/src/lib/displayCadence.js`), applied at **both** return paths so the invariant
holds for any input (per the BLOCKER): the `step < 1` early return clamps `tc`
(`Math.max(0, tc)`), and the main return clamps the walked-back total
(`Math.max(0, tc - cps * (es - steppedElapsed))`). This floors the signed rounding/lag
residual to zero (and defensively any walk-back overshoot) without touching the internal
accrual, the cost math, or the formatter. `elapsedSeconds` is already floored to `>= 0` at
line 46, so the clock is unaffected. Add two cases to the existing
`quantizeForDisplay` describe block: the bucket-0 negative-residual input (asserts `>= 0`,
`=== 0` at ~0) and an `es >= step` regression (asserts unchanged). Pure function; no new
structures, dependencies, or patterns.

## Codex design review (2026-07-20)
**Verdict:** "The clamp is idiomatic, dependency-free, and consistent with the repo, but the
sketch does not yet satisfy its stated invariant for every input. I would keep `Math.max` and
centralize it across both return paths after clarifying AC3's contradictory scope."

**BLOCKER — two-way × kludgy — "The pass-through branch bypasses the required clamp."**
The proposed `Math.max` sits only in the `stepSeconds >= 1` branch. For `stepSeconds < 1` or
invalid input, `quantizeForDisplay` early-returns `tc` directly (`displayCadence.js:48`),
so a negative total stays negative — violating AC1's "for any inputs" and splitting the
invariant across two return paths.
- *Alternative:* compute the candidate total for either branch, then apply `Math.max(0, …)`
  **once at the return boundary** (or clamp `tc` in the early return too).
- *Win:* centralizes the non-negative invariant, kills the bypass, no new abstraction.

**QUESTION — one-way × standard — "AC1 and AC3 conflict for valid non-negative arguments."**
AC1 (clamp every negative result) and AC3 (behavior identical for non-negative *inputs*)
can't both hold: e.g. `totalCost=1, elapsedSeconds=19, costPerSecond=2, stepSeconds=10`
gives today's result `1 − 2·(19−10) = −17` from all-non-negative inputs, which the clamp
turns to `0`.
- *Alternative:* scope AC3 to "unchanged when the **pre-clamp** quantized result is already
  non-negative" (coherent accrual states), and make the regression test reflect that boundary.
- *Win:* removes an impossible contract; one precise invariant for code + test.

## Build note (2026-07-20)

| AC | What | File |
|---|---|---|
| 1 | `quantizeForDisplay` never returns a negative total — clamp on **both** return paths (`step < 1` early return and the main walked-back return) | `client/src/lib/displayCadence.js` |
| 2 | Bucket-0 (`es < step`) negative residual renders `$0`, not "-$0.00" | `client/src/lib/displayCadence.js`, `client/src/lib/displayCadence.test.js` |
| 3 | Results whose **pre-clamp** value was already non-negative are unchanged | `client/src/lib/displayCadence.js`, `client/src/lib/displayCadence.test.js` |
| 4 | Unit tests: bucket-0 negative-residual case + the AC3 non-negative boundary | `client/src/lib/displayCadence.test.js` |
| 5 | Display-only scope containment | _scope check — no file_ |

## Scope decision (2026-07-20)
Thomas: "clamp it, fix both, go." Approved: the display-only clamp (not reconcile), with both
reviewer fixes applied.

## Design decisions (2026-07-20)
- **BLOCKER — clamp bypasses the early-return path:** FIX. Clamp at **both** return paths so
  the non-negative invariant holds for any input (early `step < 1` return clamps `tc`; main
  return clamps the walked-back total).
- **QUESTION — AC1/AC3 conflict:** FIX. AC3 reworded to "unchanged wherever the pre-clamp
  quantized total is already non-negative"; regression test targets that boundary.
- **Clamp vs. reconcile:** CLAMP (Thomas's call) — matches the non-goals (display-only,
  accrual untouched).
