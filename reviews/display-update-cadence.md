Date: 2026-06-14 · Branch: claude/display-update-cadence · Status: approved

# Configurable cost-update cadence

> **Approved by Thomas, 2026-06-14:** "approve" — scope as written (default 10s,
> options {1,10,60}, overlay+preview quantized, private readout stays live/detailed,
> cadence-aware clock).

## Problem
The live meeting-cost number changes constantly — the on-camera overlay
extrapolates `costPerSecond` and repaints every 250 ms ([OverlayApp.jsx:72](../client/src/components/OverlayApp.jsx)),
and the presenter's private readout repaints every second. The perpetual motion
draws the eye during a meeting. The presenter should be able to choose how often
the *on-camera* number changes so it holds steady between steps — while the
accrued total stays second-accurate underneath, and the presenter keeps an
exact live readout for their own use.

## Decisions (from Thomas, 2026-06-14)
- **Cadence options: `1s`, `10s`, `1min`.** Default **10s** (calmer than 1s out of
  the box; reconciles Thomas's "5s" pick to the nearest option in the final set).
- **Cadence applies to the on-camera overlay** (what every participant sees).
- **Quantize = floor to the grid; dollar figure and clock step together, in sync**
  (10s → 1:00, 1:10, 1:20 …; 1min → whole minutes).
- **Clock format is cadence-aware:** 1s & 10s show seconds in the usual `h:mm:ss`
  (10s lands on the 10-second grid); **1min shows no seconds at all** — `1h 26m`
  / `26m` — to avoid a frozen-`:00` look and the 1:10 = "1h10m or 1m10s?" ambiguity.
- **Presenter keeps TWO views:**
  1. **Data view = the existing private readout, unchanged** — live continual
     **1s** tick with full detail (names, per-person rates).
  2. **NEW preview area, next to the cadence picker** — shows *exactly what
     viewers see*: the quantized, chosen-cadence overlay, **aggregate only**
     (total, $/min, stepped clock, head-count). **No names, no per-person rates.**
- **Accrual unchanged:** quantization only affects the displayed value, never the
  internal `totalRef`/`elapsedRef`.

## In scope
- Persisted presenter setting `displayIntervalSeconds` ∈ {1, 10, 60}, default 10.
- A pure helper `quantizeForDisplay({ totalCost, elapsedSeconds, costPerSecond,
  stepSeconds })` → `{ totalCost, elapsedSeconds }` floored to the `stepSeconds`
  grid (`stepSeconds ≤ 1` ⇒ pass-through).
- A cadence-aware duration formatter: `h:mm:ss` for 1s/10s; `Xh Ym` (no seconds)
  for 1min.
- Apply quantization to the **on-camera overlay** (`OverlayApp` → `CostOverlay`),
  carrying `displayIntervalSeconds` in the overlay payload (`buildOverlayState`).
- A cadence **picker** in `PresenterControls`, with a **preview card** beside it
  rendering the aggregate-only quantized overlay (reusing `CostOverlay`).
- Leave the presenter's detailed private readout (`SharedCostScreen` via `App`)
  ticking live at 1s with full detail.

## Non-goals
- No change to **accrual**: `totalRef`/`elapsedRef` keep advancing every second via
  the existing dt-based tick; only the *rendered* overlay/preview value is stepped.
- Not throttling the 1 s post/tick loop (post stays 1 s so a cadence change shows
  within a second; quantization on the consumer side removes the visual churn).
- The presenter's private detailed readout is **not** quantized (it's the exact
  data view).
- The notetaker / $1-per-hr backlog item is a separate story — not here.
- No new persistence mechanism: the setting rides the existing server-persisted
  presenter config (`usePresenterStore`).

## Acceptance criteria
1. **Quantize helper** (new `client/src/lib/displayCadence.js`): for
   `stepSeconds = N > 1`, returns `elapsedSeconds = floor(elapsedSeconds / N) * N`
   and `totalCost` reduced by `costPerSecond × (elapsedSeconds − steppedElapsed)`;
   for `stepSeconds ≤ 1` returns inputs unchanged; guards 0/`null`/non-finite.
2. **Cadence-aware duration formatter** (in `displayCadence.js`): for interval 60
   returns minutes form with **no seconds** (`1h 26m`, `26m`, `0m`); for interval
   1 or 10 returns the existing `h:mm:ss` form. Stepping to the grid is handled by
   AC1 feeding whole-grid `elapsedSeconds` in, so 10s renders 1:00, 1:10 (never
   1:05).
3. **Setting**: `displayIntervalSeconds` exists in presenter config, default `10`,
   settable via a store action constrained to {1, 10, 60}, persisting through the
   existing save/load path.
4. **Overlay quantized**: the on-camera overlay's total + clock change only on
   N-second boundaries when the interval > 1 (per-minute rate and head-count
   unaffected); at interval = 1 behavior matches today. The 1-min interval shows
   no seconds in the clock.
5. **Cadence picker** in `PresenterControls` offers {1s, 10s, 1min} and invokes the
   store action with the chosen value.
6. **Preview card** beside the picker renders the **aggregate-only** quantized
   overlay (reusing `CostOverlay`): total, $/min, stepped clock, head-count —
   and **no participant names or per-person rates** anywhere in it.
7. **Presenter data view unchanged**: the private detailed readout still ticks at
   1s with full per-person detail (not quantized).
8. **Accrual independent of interval**: over the same wall-clock run, the final
   internal total is the same (to rounding) whether the interval is 1 or 60 —
   only the visible stepping differs.
9. **Scope containment**: `git diff --name-only main...HEAD` shows no files beyond
   those enumerated in **Test notes**.

## Test notes
- **AC1** — `client/src/lib/displayCadence.test.js`: elapsed 37 s, step 10 ⇒
  elapsed 30, total reduced by `cps × 7`; step 1 ⇒ pass-through; non-finite guards.
- **AC2** — same test file: interval 60 ⇒ `90 s → "1m"`-style with no `:` /
  seconds, `5160 s → "1h 26m"`; interval 10/1 ⇒ `h:mm:ss`.
- **AC3** — `usePresenterStore` test: default 10; `setDisplayInterval` accepts
  {1,10,60} and rejects/normalizes others; survives save/load round-trip via mock.
- **AC4** — `OverlayApp.test.js`: feed a running snapshot with `costPerSecond`,
  advance time within and across an N-second bucket, assert rendered total + clock
  hold within a bucket and change at the boundary; interval 1 matches current
  output; interval 60 clock has no seconds.
- **AC5/AC6** — `PresenterControls` test: picker renders {1s,10s,1min} and calls
  `actions.setDisplayInterval`; the preview card renders the aggregate overlay and
  contains no participant name / per-person rate text.
- **AC7** — an `App`/`SharedCostScreen` test asserting the detailed readout still
  shows per-person rows and ticks (unchanged).
- **AC8** — helper/accrual test proving the *internal* total is independent of
  `stepSeconds` (quantization only subtracts a within-bucket fraction for display).
- **AC9** — `git diff --name-only main...HEAD` shows only:
  - `reviews/display-update-cadence.md`
  - `client/src/lib/displayCadence.js` (+ `.test.js`)
  - `client/src/state/usePresenterStore.js`
  - `client/src/lib/overlayState.js`
  - `client/src/components/OverlayApp.jsx`
  - `client/src/components/CostOverlay.jsx`
  - `client/src/components/PresenterControls.jsx`
  - `client/src/App.jsx`
  - `client/src/styles.css` (cadence picker + preview-stage styling)
  - test files updated for the ACs above
- **Gate:** `npm test && npm run build` stays green.

## Open questions
- None outstanding — the default (10s), option set {1,10,60}, quantization scope
  (overlay + preview only; private readout stays live/detailed), and clock
  formatting are all settled above. Flag if 10s-default should instead be 1s.

## Build note (2026-06-14)
AC → file map:
- **AC1** (pure quantize helper) — `client/src/lib/displayCadence.js`
  (`quantizeForDisplay`) + `displayCadence.test.js`.
- **AC2** (cadence-aware duration formatter) — `client/src/lib/displayCadence.js`
  (`formatCadenceDuration`) + `displayCadence.test.js`.
- **AC3** (persisted setting, default 10, action ∈ {1,10,60}) —
  `client/src/state/usePresenterStore.js` (`displayIntervalSeconds`,
  `setDisplayInterval` via `normalizeDisplayInterval`).
- **AC4** (overlay quantized; 1-min drops seconds) —
  `client/src/lib/overlayState.js` (`buildOverlayState` carries the cadence) +
  `client/src/components/OverlayApp.jsx` (quantize after extrapolation) +
  `client/src/components/CostOverlay.jsx` (cadence-aware clock); tests in
  `overlayState.test.js` + `CostOverlay.test.js`.
- **AC5** (cadence picker) — `client/src/components/PresenterControls.jsx` +
  `client/src/styles.css`.
- **AC6** (aggregate-only viewer preview) —
  `client/src/components/PresenterControls.jsx` (preview card) +
  `client/src/App.jsx` (`previewDisplay`, built from `buildOverlayState` +
  `quantizeForDisplay`) + `client/src/styles.css`.
- **AC7** (private detailed readout unchanged) — `client/src/App.jsx`
  (`readoutState` untouched; `SharedCostScreen` not modified).
- **AC8** (accrual independent of cadence) — `client/src/App.jsx` tick loop
  unchanged; quantization is display-only (`displayCadence.js`).
- **AC9** (scope containment) — verified: `git diff --name-only main...HEAD`
  lists only the enumerated files.

## Codex review (2026-06-14, base main, HEAD 02bf751)
**Summary:** Reviewed `git diff main...HEAD`, `git log --oneline main..HEAD`, and
this spec. The implementation mostly matches the approved spec, but Codex found
one cadence-propagation bug for non-running sessions.

### IMPORTANT
1. **Visible overlay is not refreshed on cadence changes when the session is not
   running** — `client/src/App.jsx:188`.
   > The immediate overlay refresh effect only depends on `overlayOn`,
   > `session.status`, and `postOverlay`; `postOverlay` reads
   > `displayIntervalSeconds` through `liveRef`, so changing the cadence does not
   > change the callback identity and does not trigger this effect. During a
   > paused or ended session there is no running 1-second tick to call
   > `postOverlay`, so the preview updates to the new cadence while the on-camera
   > overlay keeps using the old `displayIntervalSeconds`. That breaks the spec's
   > requirement that cadence applies to the on-camera overlay and that the
   > preview shows exactly what viewers see.
   >
   > **Suggestion:** Trigger `postOverlay()` when `config.displayIntervalSeconds`
   > changes while `overlayOn` is true — add `config.displayIntervalSeconds` to
   > that effect's dependency list, or add a dedicated effect for cadence changes.

## Decisions (2026-06-14)
- **IMPORTANT #1 (overlay not refreshed on cadence change while paused/ended):**
  **FIX** (Thomas: "Fix"). Add `config.displayIntervalSeconds` to the
  `if (overlayOn) postOverlay()` effect's dependency array so a cadence change
  immediately re-posts to the camera overlay while it's on; re-run the gate.

## Fixes (2026-06-14)
- **IMPORTANT #1 (FIX):** Added `config.displayIntervalSeconds` to the
  `if (overlayOn) postOverlay()` effect's dependency array in
  `client/src/App.jsx`. Now a cadence change re-posts the overlay snapshot
  immediately whenever the overlay is on — including paused/ended sessions where
  no 1 s tick is running — so the on-camera overlay and the preview stay in sync.
