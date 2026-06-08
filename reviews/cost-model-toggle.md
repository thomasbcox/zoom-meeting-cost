# cost-model-toggle

Date: 2026-06-07 · Branch: claude/cost-model-toggle · Status: approved

> **Approved (2026-06-07, Thomas):** "approve and implement." Separate simple-mode
> settings (`simpleAverageRate` / `simpleMultiplier`), simple panel replaces the
> per-participant panel, toggle on both, N from live count.

## Problem

The cost meter is driven entirely by the **per-participant private rate table** (name →
rate, aliases, overrides). For larger meetings (~5+ people) entering a rate per person is
tedious and low-value — a rough "**N people × M $/hr × multiplier**" estimate is plenty.
We want an **opt-in simpler cost model**: a toggle that switches what drives the live cost
between the existing per-participant table (default) and a flat simple estimate. The
overlay and the presenter readout are unchanged — only the *source* of the aggregate
`totals` changes.

Today `App.jsx` computes `totals = computeTotals(resolved)` in one place and feeds it to the
overlay payload (`buildOverlayState`) and the private readout. The change: choose the
`totals` source based on a new `costModel` setting; everything downstream is untouched.

## Design (per Thomas, 2026-06-07)

- The **simple panel** shows three fields on one panel together: **per-hour rate**,
  **number of attendees (N)**, and a **multiplier** (defaults to `1.0`).
- When the simple model is active it **replaces** the per-participant panel's display **and
  its data** as the cost source — the rate table / aliases / overrides editors are hidden,
  not shown-but-inert.
- **Both** panels show the **toggle** for switching between the two models.
- **Separate simple-mode settings (Thomas, 2026-06-07): "two different variables so they
  can change separately."** Simple mode has its **own** per-hour rate (`simpleAverageRate`,
  default `75` — same starting value as `defaultRate`) and its **own** multiplier
  (`simpleMultiplier`, default `1.0`), independent of the per-participant `defaultRate` /
  `multiplier`. Editing them in the simple panel does **not** change the per-participant
  settings, and vice-versa.
- **N picks up the current attendee count:** the N field is prefilled with the live
  attendee count and is editable; cleared → falls back to the live count.

## In scope

- **Pure cost helpers (`client/src/lib/cost.js`):**
  - `computeSimpleTotals({ userCount, averageRate, multiplier })` → the **same shape** as
    `computeTotals` (`{ attendeeCount, combinedHourly, costPerMinute, costPerSecond }`),
    where `combinedHourly = userCount × averageRate × multiplier`, `costPerMinute = /60`,
    `costPerSecond = /3600`, `attendeeCount = userCount`; negative/NaN inputs clamp to 0.
  - `selectActiveTotals({ costModel, resolved, simpleAverageRate, simpleMultiplier, simpleUserCount, liveCount })`
    → `computeSimpleTotals({ userCount: simpleUserCount ?? liveCount, averageRate:
    simpleAverageRate, multiplier: simpleMultiplier })` when `costModel === 'simple'`,
    otherwise `computeTotals(resolved)`.
- **Presenter store (`usePresenterStore.js`):** add four back-compat settings —
  - `costModel: 'perParticipant' | 'simple'` (default `'perParticipant'`),
  - `simpleAverageRate` (per-hour M, default `75`),
  - `simpleMultiplier` (default `1.0`),
  - `simpleUserCount` (N override; `null` = use the live attendee count) —
  plus actions `setCostModel`, `setSimpleAverageRate`, `setSimpleMultiplier`,
  `setSimpleUserCount` (rates/multiplier/count clamped ≥ 0; blank `simpleUserCount` → `null`).
  The existing per-participant `defaultRate` / `multiplier` are untouched. The
  `{ ...DEFAULT_CONFIG, ...parsed }` merge gives old persisted blobs the new defaults.
- **Wire the source (`App.jsx`):** compute `totals` via `selectActiveTotals(...)` using the
  live attendee count for `liveCount`. Overlay push + readout consume `totals` exactly as now.
- **Control-panel UI (`PresenterControls.jsx`):**
  - A model **toggle** (per-participant ⟷ simple) visible in **both** modes.
  - **Simple mode:** show the simple panel — per-hour (`simpleAverageRate`), N (prefilled
    live count, editable), multiplier (`simpleMultiplier`, default 1.0) — and **hide** the
    per-participant editors (rate table / aliases / overrides).
  - **Per-participant mode (default):** the existing editors, plus the toggle.

## Non-goals

- **No auto-switching / gating by meeting size.** "~5 people" is the use-case framing, not a
  rule; the toggle is always available and manual.
- **No privacy-model change.** Only the existing sanitized aggregates leave the panel via
  `buildOverlayState`; the per-hour, N, multiplier, and rate table never leave. In simple
  mode `attendees` is N (intended).
- **No change** to the overlay/camera path, the message bridge, `buildOverlayState`'s field
  set, or `CostOverlay` rendering.

## Acceptance criteria

1. **`computeSimpleTotals` (unit-tested).** Returns the `computeTotals` shape;
   `combinedHourly = userCount × averageRate × multiplier`, `costPerMinute = /60`,
   `costPerSecond = /3600`, `attendeeCount = userCount`; negative/NaN inputs clamp to 0.
2. **`selectActiveTotals` (unit-tested).** `costModel: 'simple'` → simple totals using
   `simpleUserCount ?? liveCount` for N, `simpleAverageRate` for the rate, and
   `simpleMultiplier`; `costModel: 'perParticipant'` (or unknown) → `computeTotals(resolved)`.
   Blank/null `simpleUserCount` falls back to `liveCount`.
3. **Store settings persist with back-compat defaults.** `costModel` / `simpleAverageRate` /
   `simpleMultiplier` / `simpleUserCount` round-trip through localStorage; a persisted blob
   lacking them loads the defaults (`perParticipant`, `75`, `1.0`, `null`); the rate /
   multiplier setters clamp ≥ 0 and `setSimpleUserCount('')` resets to `null`. The
   per-participant `defaultRate` / `multiplier` are unaffected (change separately).
4. **App drives the meter from the selected model.** With `costModel: 'simple'`, the overlay
   payload + readout reflect `N × simpleAverageRate × simpleMultiplier`; with the default,
   behaviour is byte-for-byte as today.
5. **Control-panel toggle + panel swap.** The toggle is visible in both modes. Selecting
   simple **replaces** the per-participant editors with the simple panel (per-hour =
   `simpleAverageRate`, N prefilled with the live count and editable, multiplier =
   `simpleMultiplier`); switching back restores the per-participant editors. Default remains
   per-participant. Editing the simple per-hour/multiplier does **not** change the
   per-participant `defaultRate` / `multiplier`.
6. **Privacy + containment + gate.** No new fields leave the panel (overlay payload
   unchanged). Diff touches only `client/src/lib/cost.js`, `client/src/lib/cost.test.js`,
   `client/src/state/usePresenterStore.js`, `client/src/App.jsx`,
   `client/src/components/PresenterControls.jsx`, `reviews/cost-model-toggle.md`.
   `npm test && npm run build` passes.

## Test notes

- **AC1/AC2** — unit tests in `client/src/lib/cost.test.js`: `computeSimpleTotals` value +
  clamp cases; `selectActiveTotals` branch selection incl. `simpleUserCount` fallback to
  `liveCount` and unknown-model → per-participant.
- **AC3** — the store is a hook (no jsdom here); the back-compat default merge is the
  existing `{ ...DEFAULT_CONFIG, ...parsed }` pattern (already covers new keys), confirmed by
  reading; clamp/`null`-reset logic verified by reading the new setters.
- **AC4/AC5** — `App` wiring and `PresenterControls` UI are component-level (no jsdom, per
  repo norm); the cost logic they call is covered by AC1/AC2, and behaviour is confirmed by
  running the app. The "default behaviour byte-for-byte" claim (AC4) is protected by the
  unchanged `computeTotals` path + existing `cost.test.js`.
- **AC6** — `git diff --name-only main...HEAD` shows only the enumerated files; the overlay
  payload field set is unchanged (no edit to `buildOverlayState`); gate green.

## Open questions

_All resolved by Thomas's 2026-06-07 direction:_ simple panel = per-hour + N + multiplier on
one panel; simple mode **replaces** the per-participant panel; toggle on both; **separate**
`simpleAverageRate` / `simpleMultiplier` (change independently of the per-participant
settings); N prefilled from the live attendee count.

## Build note (2026-06-08)

AC → file map:
- **AC1–2** (`computeSimpleTotals`, `selectActiveTotals`): `client/src/lib/cost.js` (+ `client/src/lib/cost.test.js`)
- **AC3** (store settings + setters): `client/src/state/usePresenterStore.js`
- **AC4** (App drives meter from selected model): `client/src/App.jsx`
- **AC5** (toggle in both modes + simple panel replaces editors): `client/src/components/PresenterControls.jsx`
- **AC6** (containment): only the above + this story file; `buildOverlayState` untouched.

## Codex review (2026-06-08, base main, HEAD 684daa5)

**Summary:** The branch mostly matches the spec and keeps the overlay payload
contained, but two simple-mode attendee-count fallback issues should be fixed.

### IMPORTANT
1. **Live attendee tracking can be accidentally pinned** (`client/src/components/PresenterControls.jsx`)
   — the N field shows `simpleUserCount ?? liveCount`, but `NumberInput` commits on
   every blur. Focusing then blurring the prefilled field commits the live count as
   an explicit `simpleUserCount`, so it stops tracking participant changes until
   cleared — violating "null = use the live attendee count". _Fix:_ keep
   `simpleUserCount` null unless the user actually changes N (e.g. commit null when
   the value equals the current live count).
2. **Blank `simpleUserCount` doesn't fall back in the selector** (`client/src/lib/cost.js`)
   — `selectActiveTotals` uses `simpleUserCount ?? liveCount`, so `''` is treated as
   an explicit value and clamps to 0 attendees instead of falling back to
   `liveCount`. _Fix:_ normalize `'' || null → liveCount` in the selector; add a unit
   test for `simpleUserCount: ''`.

## Decisions (2026-06-08)

Both IMPORTANT findings: **FIX** (Thomas — "fix both then review").

1. N field pins live tracking on stray focus/blur → commit "track live" (null) when
   the entered value is blank or equals the current live count. Extract a pure
   `simpleCountCommit(value, liveCount)` helper so it's unit-tested.
2. `selectActiveTotals` blank fallback → normalize `'' || null → liveCount`; add a
   `simpleUserCount: ''` unit test.

## Build note — re-review (2026-06-08, base 684daa5)

AC → file map (fixes only): the two approved Codex fixes touch
`client/src/lib/cost.js` (blank-N selector fallback + new `simpleCountCommit` helper),
`client/src/lib/cost.test.js` (+4 tests), and `client/src/components/PresenterControls.jsx`
(N field commits via `simpleCountCommit`).
