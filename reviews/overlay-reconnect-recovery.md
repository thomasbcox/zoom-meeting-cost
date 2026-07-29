Date: 2026-07-29 · Branch: claude/overlay-reconnect-recovery · Status: approved

## Problem

The camera overlay dies and cannot self-recover after Zoom tears down the `inCamera`
rendering instance **without the presenter's camera going off** — reproduced live
2026-07-29 via a breakout-room round-trip. The panel keeps pushing the cost snapshot every
tick to a camera instance that no longer exists; each push fails (`Failed to post message
to connected app`, logged once per second in the dev Railway logs), no overlay renders, and
**"Hide from video" gets stuck** — its close call throws on the dead context, so the panel
never returns to the hidden state and the presenter has no way to rebuild.

The existing auto-recovery ([`lib/overlayRecover.js`](../client/src/lib/overlayRecover.js))
only fires on a `getVideoState` **off→on edge**, which a breakout teardown never produces
(the camera stays on). Camera off→on recovers it (that edge); a breakout does not.

## In scope

- **Dead-link auto-recovery.** When the `postMessage` link to the `inCamera` instance is
  dead (repeated send failures) while the overlay is on, run the same **close→reopen** the
  camera-off path already uses, re-establishing the overlay without a camera off→on.
- **Reliable manual escape hatch.** "Hide from video" always returns to the hidden state
  even when the underlying close throws (already-gone context); "Show cost on video" then
  rebuilds from scratch (existing `startOverlay`).
- **Bounded noise + no hot-loop.** Stop the once-per-second failure log spam; rate-limit
  rebuild attempts.

## Non-goals

- No change to how the overlay renders, the cost math, or the `postMessage` payload shape.
- No new Zoom SDK capability (reuses existing `runRenderingContext` / `closeRenderingContext`
  / `postMessage` / `getVideoState`).
- No breakout-room–specific detection (no such panel-side SDK signal exists — this is why the
  code already *polls* `getVideoState` rather than listening for events). We recover from the
  observable symptom (dead `postMessage` link), which also covers other teardown causes.
- The camera-off→on recovery path is unchanged; the new path is additive.

## Acceptance criteria

1. When `postMessage` fails for **N consecutive ticks** while the overlay is on, the panel
   runs a close→reopen of the rendering context, re-establishing the overlay without a
   camera off→on. A subsequent successful post resets the failure count.
2. Rebuild attempts are **rate-limited** (a cooldown between attempts) and guarded against
   overlapping with the camera-off recovery, so a persistently-failing link cannot rebuild
   every tick (no hot-loop).
3. Clicking **"Hide from video" always** returns the panel to the hidden state ("Show cost on
   video"), even when the underlying close rejects on a dead context. "Show cost on video"
   then rebuilds the overlay.
4. `postMessage` failure logging is **edge-triggered**: it logs the first failure after a run
   of successes and the first success after a run of failures — not every failed tick.
5. The failure-count→rebuild decision is a **pure, unit-tested** function beside
   `reduceVideoPoll`; the adapter's `postMessage` **returns its send outcome** so the panel
   can observe it. Existing tests stay green; new tests cover the reducer and the
   `postMessage` return + edge-log.
6. **Scope containment:** the diff touches only `client/src/App.jsx`,
   `client/src/lib/overlayRecover.js` (+ its test), `client/src/zoom/zoomAdapter.js` (+ its
   test), and this story file.

## Test notes

- **AC1/AC2** — pure reducer tests (table-driven, no jsdom): a run of failures reaching the
  threshold → `rebuild` true once, advancing `lastRebuildAt`; cooldown suppresses further
  rebuilds until elapsed, then retries; a success resets the count. Plus a pure
  dead-link-recovery orchestrator test (stubbed deps, mirroring `createVideoRecovery`): N
  failed sends drive `stop` → `start` → `postOverlay` once, and an intent flip mid-flight
  aborts before reopen.
- **AC3** — pure best-effort-stop orchestrator test (no jsdom): a `stop` stub that **rejects**
  still resolves the orchestrator to the hidden intent (no throw, no unhandled rejection), so
  the panel flips `overlayOn` to false.
- **AC4** — adapter test: `postMessage` resolves `false` on SDK rejection, `true` on success;
  emitted logs are edge-triggered (first-fail, first-recovery), not one per failure.
- **AC5** — `postMessage` returns `Promise<boolean>`; `MockZoom` parity. Run the gate
  `npm test && npm run build`.
- **AC6** — run `git diff --name-only main...HEAD` and verify no files appear beyond those
  AC6 enumerates.

## Open questions

1. **Threshold + cooldown values.** Proposed: rebuild after **3** consecutive failed posts
   (~3 s at the 1 s tick), with a **~6 s cooldown** between rebuild attempts. Both are the
   only tunables and trivial to change. OK?
2. **Edge-triggered logging vs. keep-verbose.** AC4 replaces the once-per-second failure spam
   with edge logs (first-fail + first-recovery). You just used that verbose stream to diagnose
   this live — switch to edge-triggered, or keep verbose until the app is published?
   *(Recommend edge-triggered — the edges are the signal; the per-tick repeat isn't.)*
3. **Failure counter home.** Proposed: a ref in `App.jsx` fed by `postMessage`'s return value
   from the **existing** 1 s tick — no new interval. OK, or should the dead-link check get its
   own interval like the `getVideoState` poll?

## Design sketch — HOW

- **Adapter (`zoom/zoomAdapter.js`).** Change `postMessage(payload)` to **return a
  `Promise<boolean>`** — `true` on a successful send, `false` on rejection — keeping its
  never-throw, self-logging behavior. Replace log-every-failure with **edge-triggered**
  logging: a `_postFailing` flag; emit `postMessage ok:false` only on the success→fail
  transition and `postMessage ok:true` on the fail→success transition (generalizing today's
  `_firstPostLogged`). Mirror the boolean return in `MockZoom.postMessage`.
- **Pure decision (`lib/overlayRecover.js`).** Add `reducePostResult(ok, prev, now)` beside
  `reduceVideoPoll`: given the latest outcome and `{ consecutiveFailures, lastRebuildAt }`,
  return `{ consecutiveFailures, rebuild }` where `rebuild` is true only when
  `consecutiveFailures` crosses the threshold **and** `now - lastRebuildAt ≥ cooldown`; a
  success resets `consecutiveFailures` to 0. Table-testable, no jsdom (mirrors `reduceVideoPoll`).
- **Shared rebuild.** Extract the close→reopen currently inline in `createVideoRecovery`
  (`stop` best-effort → `start` → `postOverlay`, preserving the "close THEN reopen — a single
  reopen does not re-composite" invariant, proven live) into one `rebuildOverlay(...)` helper,
  so the camera-off path and the new dead-link path share exactly one implementation.
- **Wiring (`App.jsx`).** The 1 s tick already calls `postOverlay()`; thread
  `adapter.postMessage(...)`'s boolean into `reducePostResult`. On `rebuild`, call the shared
  `rebuildOverlay(...)` and stamp `lastRebuildAt`. A shared `recoveringRef` guard prevents the
  dead-link path and the `getVideoState` poll from rebuilding concurrently.
- **Manual escape hatch (`App.jsx`).** In `stopOverlay`, make the close best-effort so
  `setOverlayOn(false)` **always** runs (try/finally) — mirroring the best-effort close already
  inside `createVideoRecovery`. The button then reliably flips to "Show cost on video", and
  `startOverlay` rebuilds.
- No new dependency, no new SDK capability, no payload/render change.

## Codex design review (2026-07-29)

**Verdict:** Not sound as sketched. The core is endorsed — observing `postMessage` outcomes,
sharing the close→reopen, edge-triggered logs, and no new runtime dependency are all
appropriate and consistent with this repo. Three gaps to fix first: make recovery respect a
manual Hide, make the retry reducer own its full transition, and fix the impossible
test/scope combination.

### BLOCKER — App tests can't be built within scope · one-way × nonstandard
- **Claim:** The test notes assume a Vitest/jsdom rendered-interaction harness, but the repo
  has **no** jsdom/happy-dom/Testing-Library/react-test-renderer — its convention is
  pure Node-testable orchestrators. AC6 also excludes `package.json`/`App.test.js`. So the
  proposed App-level tests need either a new (out-of-scope) dependency or a hand-rolled DOM.
- **Alternative:** Follow the repo's extraction convention — put the post-failure and
  best-effort-stop orchestration behind pure injected-dependency functions and test them in
  `overlayRecover.test.js`; inspect the hook-free `PresenterControls` element tree for button
  state if needed. Amend the test notes to drop the jsdom requirement.
- **Win:** Gate becomes implementable with no undeclared dependency or forbidden files, reusing
  the established Node-only test seam.

### BLOCKER — recovery guard doesn't preserve a concurrent manual Hide · one-way × kludgy
- **Claim:** `recoveringRef` only stops the two *automatic* triggers from overlapping. If a
  rebuild is mid-flight and the presenter clicks Hide, Hide sets the UI off but the older
  recovery can still call `startCameraOverlay`/`postOverlay` — overlay actually running while
  the button says "Show cost on video." Also, `try/finally` updates state but preserves the
  close rejection, so the handler still yields an unhandled rejected promise.
- **Alternative:** Hide records intent immediately (`overlayOnRef.current = false` + state off)
  *before* awaiting a caught best-effort close. Put the single-flight guard inside
  `rebuildOverlay`, pass it a `getOverlayOn`/generation check, and re-check intent after close
  and before start/post — an invalidated recovery exits without reopening.
- **Win:** Removes the hidden-state/actual-overlay divergence and the unhandled rejection, and
  centralizes concurrency protection for both auto paths.

### IMPORTANT — reducer owns only half the cooldown transition · two-way × kludgy
- **Claim:** `reducePostResult` takes `lastRebuildAt` but doesn't return it (App stamps it
  imperatively). And "crosses the threshold" is broken: once the count is ≥N during cooldown,
  later failures never "cross" N again, so a literal implementation never retries after the
  cooldown expires.
- **Alternative:** Reducer returns the *complete* next state (incl. `lastRebuildAt`) plus the
  effect signal; eligibility = `nextFailures >= N && now - lastRebuildAt >= cooldown`; on
  eligible, `rebuild: true` and atomically advance `lastRebuildAt`. Success resets only the count.
- **Win:** One pure transition owns the retry invariant; persistent failures retry at the
  cooldown cadence instead of stalling forever.

## Design decisions (2026-07-29)

Thomas approved scope and build (2026-07-29): **"Approve & build (fix all 3)."** The 4-file
scope stands. Dispositions:

- **BLOCKER (test/scope) → FIX.** No jsdom. All new logic lives in pure injected-dependency
  orchestrators (mirroring `attemptStartOverlay` / `createVideoRecovery`) tested in
  `overlayRecover.test.js`; no App-level rendered tests, no new dependency.
- **BLOCKER (concurrent Hide) → FIX.** Hide records intent first (`overlayOnRef.current = false`
  + state off) then awaits a **caught** best-effort close (no unhandled rejection). The shared
  `rebuildOverlay` takes a `getOverlayOn` intent/generation check and re-checks it after close,
  before reopen/post — an invalidated recovery exits without reopening. The single-flight guard
  lives inside `rebuildOverlay`, covering both auto paths and a concurrent manual Hide.
- **IMPORTANT (reducer transition) → FIX.** `reducePostResult` returns the complete next state
  incl. `lastRebuildAt`; eligibility = `nextFailures >= N && now - lastRebuildAt >= cooldown`;
  eligible → `rebuild: true` and advance `lastRebuildAt`; a success resets only the count.
- **Q1 threshold/cooldown:** N = **3** consecutive failed posts; cooldown = **6 s**.
- **Q2 logging:** **edge-triggered** (first-fail after successes, first-success after failures);
  drop the once-per-second spam.
- **Q3 counter home:** the **existing 1 s tick** feeds `postMessage`'s boolean into the reducer;
  no new interval.

## Build note (2026-07-29)

AC → file map:
- **AC1** (rebuild after N failed sends): `client/src/lib/overlayRecover.js` (`reducePostResult`,
  `createPostRecovery`, `rebuildOverlay`) wired from the 1 s tick in `client/src/App.jsx`.
- **AC2** (rate-limit + single-flight): `reducePostResult` cooldown + `rebuildOverlay` `isRecovering`
  guard (`overlayRecover.js`); shared `recoveringRef` across both recovery paths (`App.jsx`).
- **AC3** (reliable Hide): `runStopOverlay` (`overlayRecover.js`) used by `stopOverlay` (`App.jsx`).
- **AC4** (edge-triggered logging): `postMessage` `_postFailing` edges (`client/src/zoom/zoomAdapter.js`).
- **AC5** (pure tested reducer + observable send outcome): `overlayRecover.js` + `overlayRecover.test.js`;
  `postMessage` returns `Promise<boolean>` + `zoomAdapter.test.js`.
- **AC6** (scope): only the four files above (+ tests) and this story file.

## Codex approach review (2026-07-29, base main, HEAD 6c8c91a)

**Verdict:** Core shape is appropriately small and uses existing React/Zoom primitives — no
dependency provides this Zoom-specific recovery lifecycle. Not yet sound: send-outcome state
and rendering-context ownership aren't fully centralized.

### BLOCKER — Hide does not fully supersede an in-flight reopen · two-way × kludgy
- **Locus:** `client/src/lib/overlayRecover.js:120` (`rebuildOverlay`).
- **Claim:** The intent re-check *after* `await start` skips the post but never closes the
  just-reopened context. If Hide's `closeRenderingContext` runs while `start` is pending, start
  completes afterward and the context stays **active while the UI says "Show cost on video"** —
  violating AC3 ("Hide always wins"). The check is a timing assumption, not an enforced invariant.
- **Alternative:** One serialized, generation-aware owner for rendering-context mutations. Hide
  advances the generation + sets desired-off; after any awaited `start`, a stale generation does a
  compensating close (last-intent-wins).
- **Win:** "Hide always wins" becomes enforced, not timing-dependent; no hidden-UI/live-context split.

### IMPORTANT — most successful sends bypass the recovery state machine · two-way × kludgy
- **Locus:** `client/src/App.jsx:138` (only the tick feeds `runPostRecovery`).
- **Claim:** Sends during start, the fresh-snapshot effect, and `rebuildOverlay`'s own post ignore
  their outcomes, and `postStateRef` survives Hide→Show. So a stale failure count can cross overlay
  runs and trigger an early rebuild (one failure completing a prior run's threshold).
- **Alternative:** One observed send boundary owning `adapter.postMessage` + the outcome transition,
  with Hide / new-overlay generations as explicit reset transitions.
- **Win:** Removes the fire-and-forget outcome paths, stops stale state crossing lifecycles,
  centralizes the AC1 reset invariant.

## Decisions (2026-07-29)

Approach pass (base main, HEAD 6c8c91a) — Thomas's calls:
- **BLOCKER (Hide loses race with in-flight reopen) → FIX.** Add last-intent-wins via an overlay
  generation: a compensating close when intent flips during the reopen, so a manual Hide always
  supersedes a background rebuild (AC3 becomes enforced, not timing-dependent).
- **IMPORTANT (failure count survives Hide→Show) → FIX.** Scope/reset the dead-link failure state
  to the current overlay generation so stale counts can't cross overlay runs. Comes with the
  generation added for the BLOCKER.

**Correctness pass NOT run this round** — the approved redesign changes the shape, so it re-enters
the **approach** pass on the new shape (a fresh `/review`) before any line-level pass. No merge is
authorized by these decisions.

## Fixes (2026-07-29)

Applying the approach-pass decisions (both FIX):
- **BLOCKER (Hide loses race with in-flight reopen) → fixed.** Added an overlay **generation**
  (`App.jsx` `generationRef`, bumped on every Show and Hide). `rebuildOverlay` captures the
  generation at entry and treats the run as *superseded* if the overlay was hidden **or** the
  generation advanced; if superseded after the reopen it performs a **compensating close** of the
  context it just recreated. Last intent wins — "Hide always wins" is now enforced, not a timing
  assumption. (`overlayRecover.js` `rebuildOverlay`; forwarded via `createVideoRecovery` /
  `createPostRecovery`.)
- **IMPORTANT (failure count survives Hide→Show) → fixed.** `startOverlay` success bumps the
  generation and resets `postStateRef` to `{ consecutiveFailures: 0, lastRebuildAt: 0 }`, so a
  stale dead-link count can't cross overlay runs and rebuild a fresh overlay early.
- **Tests:** two new `rebuildOverlay` cases — compensating-close on a Hide-during-reopen, and on a
  generation advance during the reopen. Gate green (71 client + 50 server + 14 secret-scan; build clean).

## Codex approach review (2026-07-29, base main, HEAD dee6a37)

**Verdict:** Keep the boolean-returning adapter, edge logging, pure retry reducer, and existing
tick. But don't build rendering-context ownership this way — Show, Hide, and both recovery paths
should pass through one serialized controller. No dependency supplies this Zoom lifecycle.

### BLOCKER — compensating close can destroy a newer Show · two-way × kludgy
- **Locus:** `client/src/lib/overlayRecover.js:128` (the compensating close).
- **Claim:** Generation checks *detect* stale recovery but don't *serialize* the global
  `runRenderingContext` / argument-free `closeRenderingContext`. If recovery is awaiting `start`
  and the presenter does Hide→Show, the stale start resolves and its compensating `stop` closes the
  **newer Show's** context. Final state: desired-on / UI-on with **no live context** — the very
  invariant the redesign was meant to prevent, in a different sequence.
- **Alternative:** One small rendering-context controller / promise queue used by Show, Hide, and
  both recovery paths. Record intent immediately, but **serialize** every SDK start/close; a Hide
  queued after an old start closes it, and a later Show is the final op. Keep the pure retry reducer
  as the controller's input.
- **Win:** Removes the stale-close-after-new-Show path and centralizes ordering for all
  rendering-context mutations — replacing the scattered `generationRef` / `recoveringRef` /
  compensating-close coordination with one owner.

## Decisions (2026-07-29) — approach pass #2

Approach pass #2 (base main, HEAD dee6a37) — Thomas's call:
- **BLOCKER (compensating close can destroy a newer Show) → FIX (serialized controller).** Replace
  the `generationRef` / `recoveringRef` / compensating-close coordination with one small serialized
  rendering-context controller (a promise queue) used by Show, Hide, and both recovery paths:
  record intent immediately, serialize every SDK `start`/`close` so last-intent-wins by
  construction. Keep the boolean-returning adapter, edge logging, the pure retry reducer
  (`reducePostResult`), and the existing 1 s tick as the controller's input.

**Correctness pass NOT run this round** — the approved redesign changes the shape, so it re-enters
the **approach** pass on the new shape (a fresh `/review`) before any line-level pass. No merge authorized.

## Fixes (2026-07-29) — serialized controller

Applying the approach-pass #2 decision (BLOCKER → FIX):
- **Serialized rendering-context controller.** Added `createOverlayController` in
  `overlayRecover.js`: a single owner of the global camera context with a promise-queue so every SDK
  `start`/`close` runs one at a time. It tracks the desired intent (read at run time) + a best-effort
  `open` belief; `show()`/`hide()` reconcile toward intent, `rebuild()` force-cycles (close→reopen)
  while desired. Because ops are serialized, the **last intent wins by construction** — no stale
  reopen can clobber a newer Show, and there is no compensating close.
- **Removed** `rebuildOverlay`, `runStopOverlay`, and the App-side `generationRef` / `recoveringRef`
  / compensating-close coordination — the controller subsumes all of it. `createVideoRecovery` /
  `createPostRecovery` are now thin: they decide *when* to rebuild (the pure reducers) and call
  `controller.rebuild()`; the controller owns *how*. `App.jsx` routes Show (via a controller-backed
  `startCameraOverlay`), Hide, and the tick's dead-link check through the controller;
  `attemptStartOverlay` is unchanged (its tests untouched).
- **Tests:** `overlayRecover.test.js` rewritten — controller serialization tests (rebuild→hide→show
  and rebuild→show→hide both land on last-intent-wins; a rejecting start surfaces to `show()` without
  wedging the queue) plus the driver + reducer tests. Full client suite 160 green; gate green.

## Codex approach review (2026-07-29, base main, HEAD c9355ab)

**Verdict:** The shape is sound and proportionate — a pure retry reducer, a
boolean-returning/edge-logging adapter boundary, and one Promise-serialized controller owning all
rendering-context mutations. No installed dependency or React/Zoom primitive provides this
lifecycle; the controller **replaces rather than compounds** the prior coordination machinery.

**Findings:** none — approach pass **clean**. Shape blessed; proceeding to the correctness pass.

## Codex review (2026-07-29, base main, HEAD c9355ab)

**Summary:** The serialized controller is consistent with the approved design. Two IMPORTANTs — a
theoretical out-of-order race in how post outcomes are reduced, and a missing close-rejection test
required by AC3. (Codex could not rerun the gate in its read-only sandbox; the gate is green when
run locally.)

### IMPORTANT — post outcomes reduced in completion order, not tick order · `client/src/App.jsx:187`
- **Claim:** Each tick starts an independent `postOverlay().then(runPostRecovery)` and applies the
  result when that promise resolves. If sends settle out of order, a slow earlier success could
  reset the counter between failed ticks (blocking an AC1 rebuild); a stale failure could settle
  after Hide→Show and contaminate the freshly reset state (premature rebuild in the new run).
- **Suggestion:** Tag each send with an overlay-run token + sequence; ignore superseded/out-of-order
  results, or serialize the observed sends. Add out-of-order + post-Hide→Show settling tests.

### IMPORTANT — best-effort close rejection lacks required coverage · `client/src/lib/overlayRecover.test.js`
- **Claim:** The controller suite tests a rejecting `startCtx` but has **no rejecting `stopCtx`**
  case for `hide()` / `rebuild()`, despite AC3 + the test notes explicitly requiring proof that a
  rejected close still resolves to hidden intent with no unhandled rejection. The old
  close-rejection test was removed without equivalent controller coverage.
- **Suggestion:** Add tests — a rejecting `stopCtx` where `hide()` resolves with `isOn()` false and
  a later `show()` starts cleanly, and where `rebuild()` continues past the failed close to start+post.

## Decisions (2026-07-29) — correctness pass

Correctness pass (base main, HEAD c9355ab) — Thomas's calls:
- **IMPORTANT (best-effort close rejection lacks coverage) → FIX.** Add rejecting-`stopCtx` tests to
  `overlayRecover.test.js`: `hide()` resolves with `isOn()` false and a later `show()` starts
  cleanly; `rebuild()` continues past a failed close to start+post. **Test-only** — no product change.
- **IMPORTANT (post outcomes reduced in completion order) → DEFER.** Negligible in practice: the
  dead-link rebuild path is order-insensitive (all posts fail; order among failures doesn't matter),
  `postMessage` settles in ms so reordering across 1 s-apart ticks doesn't occur, and the Hide→Show
  contamination needs a post pending across a sub-second toggle and only nudges a counter needing 3.
  The reviewer's run-token+sequence fix re-adds the per-run bookkeeping the controller removed —
  complexity not worth the negligible gain. **Recorded as a known edge.**

The one approved fix is test-only (no redesign), so `/close` reaches the re-review/merge fork.

## Fixes (2026-07-29) — close-rejection test coverage

Applying the correctness-pass decision (FIX; the other IMPORTANT is deferred and untouched):
- **Rejecting-`stopCtx` coverage added** (`overlayRecover.test.js`): `hide()` with a rejecting
  `stopCtx` still resolves to `isOn() === false` (no unhandled rejection) and a later `show()` starts
  cleanly; `rebuild()` continues past a rejecting close to reopen and post. Closes the AC3 gap left
  when `rebuildOverlay`'s close-rejection test was replaced. **Test-only** — no product change.
