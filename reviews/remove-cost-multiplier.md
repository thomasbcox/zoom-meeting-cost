# remove-cost-multiplier

Date: 2026-06-25 · Branch: claude/remove-cost-multiplier · Status: approved

> **Approved 2026-06-25** — Thomas: "I thought we were removing the multiplier?" →
> confirmed: remove it entirely, no replacement "scale" control. Open question resolved.

> Story 1 of 3 in the "step-2 quick wins" batch (see roadmap). The other two —
> redact `/api/log` server-side, and fix the order-fragile header test — follow as
> their own `/frame` stories.

## Problem

The cost model still has a **loaded-cost multiplier** (`multiplier` for the
per-participant model, `simpleMultiplier` for the simple model). "Loaded cost" —
overhead layered on top of pay — is a *compensation* concept. Since the
opportunity-cost framing pass ([`reviews/opportunity-cost-framing.md`](opportunity-cost-framing.md)),
each per-person number is an **hourly opportunity cost** — already the full value of
that person's time. Multiplying it by an overhead factor **double-counts** and muddies
the meaning the framing pass was meant to clean up. That pass only neutralized the help
text; this story removes the field itself.

Tracked in [`reviews/backlog.md`](backlog.md) ("Remove the loaded-cost multiplier").

## In scope

- Remove the multiplier from the **cost math**:
  - `client/src/lib/matching.js` `resolveAll` — stop reading `config.multiplier` and
    stop multiplying (`rate: r.baseRate * multiplier` → `rate: r.baseRate`).
  - `client/src/lib/cost.js` `computeSimpleTotals` — drop the `multiplier` factor
    (`n * rate * mult` → `n * rate`); `selectActiveTotals` — drop the `simpleMultiplier`
    param.
- Remove the multiplier from the **UI** (`client/src/components/PresenterControls.jsx`):
  both the per-participant "Multiplier" input + its help line, and the simple-model
  "Multiplier" input; fix the simple-model description that reads
  "× average opportunity cost × multiplier".
- Remove the multiplier from **client state** (`client/src/state/usePresenterStore.js`):
  the `multiplier` / `simpleMultiplier` defaults and the `setMultiplier` /
  `setSimpleMultiplier` actions; update the wiring in `client/src/App.jsx`
  (`selectActiveTotals` call + its `useMemo` deps).
- **Relax the persisted-schema validation for back-compat**
  (`server/src/store/rateStore.js` `validateConfig`): `multiplier` is no longer
  **required** (a new client that omits it must still PUT successfully). Mirror the
  existing `simpleMultiplier` rule — *if present*, both must still be non-negative
  numbers (so a malformed legacy value is still rejected). No data migration: a stored
  blob that still contains a valid `multiplier`/`simpleMultiplier` continues to load and
  validate; the client simply ignores it in cost math.
- Update the affected tests: `cost.test.js`, `matching.test.js`,
  `server/test/rateStore.test.js`, `server/test/rates.test.js`.

## Non-goals

- **No data migration / no active stripping** of legacy `multiplier` fields from stored
  blobs. The field is inert (ignored by cost math, tolerated by validation); it
  disappears from a given uid's blob naturally the next time that config is saved by a
  new client. Writing a migration is out of scope.
- **No replacement "scale" control.** (See open question — recommended: none.)
- Not touching the overlay payload, the privacy invariant, or any other cost-model
  behavior. `computeTotals` (per-participant sum) is unchanged except that its inputs no
  longer carry a multiplier.
- No identifier rename of the historical `rate` field (unchanged, as elsewhere).

## Acceptance criteria

1. **Per-participant math:** `resolveAll` returns `rate === baseRate` for every
   participant (no multiplier applied); `config.multiplier` is no longer read.
2. **Simple math:** `computeSimpleTotals({ userCount, averageRate })` returns
   `combinedHourly === userCount * averageRate`; `selectActiveTotals` no longer accepts
   or uses `simpleMultiplier`.
3. **UI:** neither Multiplier input renders in either cost model, and no visible copy
   references a multiplier. The simple-model description reads as a clean
   "attendees × average opportunity cost" (no "× multiplier").
4. **State:** `usePresenterStore` no longer defines `multiplier` / `simpleMultiplier`
   defaults or `setMultiplier` / `setSimpleMultiplier` actions; nothing in the client
   references them.
5. **Back-compat (new client writes):** a config object **without** `multiplier` /
   `simpleMultiplier` passes `validateConfig` (returns the config, not null).
6. **Back-compat (legacy reads):** a config object **with** a valid numeric
   `multiplier` / `simpleMultiplier` still passes `validateConfig` and round-trips
   through `save`/`load` unchanged; a config with a **malformed** `multiplier` /
   `simpleMultiplier` (non-number, NaN, negative) is still rejected (null).
7. **Gate green:** `npm test && npm run build` passes.
8. **Scope containment:** the diff touches only the files enumerated in *In scope*.

## Test notes

- AC1 — `matching.test.js`: assert `resolveAll` rows have `rate === baseRate` for a
  config that previously carried a multiplier; remove/adjust the existing
  multiplier-applied assertions.
- AC2 — `cost.test.js`: `computeSimpleTotals` returns `n * rate`; add/adjust a case
  proving the old `* multiplier` factor is gone; `selectActiveTotals('simple', …)`
  ignores any stray `simpleMultiplier`.
- AC3 — covered by `npm run build` (compiles) + manual read of `PresenterControls.jsx`
  for the two removed inputs and the corrected copy. No jsdom render test exists for
  this panel; the build + grep for "ultiplier" in `client/src` (expect 0 hits) is the
  check.
- AC4 — grep `client/src` for `setMultiplier` / `setSimpleMultiplier` / `multiplier`
  (expect 0 non-comment hits); `npm run build` confirms no dangling references.
- AC5 / AC6 — `server/test/rateStore.test.js`: add a positive case for a
  multiplier-absent config; keep a positive case for a legacy multiplier-present config;
  keep the malformed-multiplier rejection. `server/test/rates.test.js` PUT cases updated
  to match.
- AC7 — run `npm test && npm run build` (the configured gate).
- AC8 — run `git diff --name-only main...HEAD` and verify no files appear beyond those
  listed in *In scope*.

## Decisions

1. **Scaling dropped entirely — no replacement control** (Thomas, 2026-06-25). A scale knob
   would re-introduce the "is this the real value or a fudged one?" ambiguity the
   opportunity-cost framing removed; presenters who want higher estimates raise the
   opportunity-cost values directly.

## Build note (2026-06-25)

AC → file map:

- **AC1** (per-participant `rate === baseRate`, no multiplier) → `client/src/lib/matching.js`
- **AC2** (`computeSimpleTotals` = N × rate; `selectActiveTotals` drops `simpleMultiplier`) →
  `client/src/lib/cost.js`
- **AC3** (both Multiplier inputs removed; simple-model copy fixed) →
  `client/src/components/PresenterControls.jsx`
- **AC4** (defaults + `setMultiplier`/`setSimpleMultiplier` removed; wiring updated) →
  `client/src/state/usePresenterStore.js`, `client/src/App.jsx`
- **AC5 / AC6** (validation: multiplier optional-when-present; malformed rejected;
  legacy round-trips) → `server/src/store/rateStore.js`
- **Tests** → `client/src/lib/cost.test.js`, `client/src/lib/matching.test.js`,
  `server/test/rateStore.test.js`, `server/test/rates.test.js`
