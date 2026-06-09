Date: 2026-06-08 · Branch: claude/overlay-teardown-diagnostics · Status: approved

> Approved by Thomas 2026-06-08 (phase 1, built): "Diagnostics only" — add
> teardown + onMyMediaChange logging, no behavior change.
>
> Re-scoped 2026-06-08 (phase 2, approved): Thomas confirmed the trigger live —
> **the overlay dies when the presenter turns their camera off and on again** —
> and chose to fold the auto-recover fix into this branch, re-arming **only on a
> confirmed off→on transition**. The diagnostics' `onMyMediaChange` wiring is
> exactly the signal the fix consumes.

## Problem

In a live in-Zoom run the camera-overlay cost display "switches off" by itself.
The Railway log from 2026-06-08 showed the failure mode but not the cause:

- 20:01:44 — side **panel** boots (`i_9acfp9`, `inMeeting`, `panel`) and mounts.
- 20:02:14 — `start-overlay:begin status:idle` → the **camera** overlay instance
  boots (`i_3w8ia6`, `inCamera`, `overlay`), draws, receives a snapshot
  (`overlay-message status:running`). Display is on.
- ~53 min gap with no overlay logs.
- 20:55:31 — `start-overlay:begin` fires **again**, `status:"running"` (a *manual*
  re-click of "Show cost on video"), and a **new** camera instance boots
  (`i_0hpbot`) replacing `i_3w8ia6`.

So the panel survived the whole session, but the camera-overlay instance silently
disappeared and had to be manually restarted, with no log of the teardown.

**Confirmed cause (Thomas, live 2026-06-08):** it happens when the presenter turns
their camera **off and back on**. Turning the camera off tears down Zoom's camera
*rendering context*, destroying our `inCamera` overlay webview. Turning it back on
rebuilds the camera feed but does **not** re-run *our* rendering context, so the
meter stays gone. The panel is unaware — it still holds `overlayOn === true` and
keeps posting state into a context that no longer exists — which is why a manual
re-click of "Show cost on video" (which re-runs `runRenderingContext`) brought it
back at 20:55.

The fix is to do that re-click automatically: detect the camera coming back on and
re-establish the overlay. The signal is `onMyMediaChange` — the very event wired in
phase 1 for diagnostics. The real event shape (from `@zoom/appssdk` types) is:
`{ media: { video: { state: false } }, timestamp }` on camera off and
`{ media: { video: { state: true } } }` on camera on (resolution changes arrive as
`{ video: { width, height } }` with no `state`; audio as `{ audio: { state } }`).

## In scope

Phase 1 — diagnostics (built):
- Log the camera-overlay instance **teardown** (`pagehide`) so the disappearance
  leaves a timestamped trace.
- Subscribe to `onMyMediaChange` and log each event (shape only) so a teardown can
  be correlated with a camera state change.

Phase 2 — auto-recover (this re-scope):
- Expose presenter media-change events to the app via the adapter
  (`adapter.onMediaChange(cb)`), fanning out the same `onMyMediaChange` events the
  diagnostics already observe.
- When the presenter's camera goes **off then back on** while the overlay is meant
  to be on, automatically re-run `startCameraOverlay()` and push a fresh snapshot —
  restoring the meter without a manual re-click.
- Keep all logging on the `/api/log` lifecycle channel, privacy-preserving, never
  able to throw.

## Non-goals

- No change to the session state machine (idle/running/paused/ended), cost math, or
  the message-bridge format. Re-arm reuses the existing `startCameraOverlay()` path.
- No new Zoom capabilities beyond those already in `ZOOM_CAPABILITIES`
  (`onMyMediaChange` is already requested).
- No recovery for teardown triggers we have **not** confirmed (e.g. screen share,
  virtual-background swap). If the diagnostics later show another trigger, that's a
  separate story; the `media-change` log keeps watching for it.
- No mock-dev UI button for simulating the toggle (tests drive it directly); add
  one later only if useful.
- The "no resume after End session" backlog item is separate and untouched.

## Acceptance criteria

Phase 1 (built):

1. When the camera-overlay instance's page is torn down (`pagehide` on the
   `inCamera`/overlay mount), it emits a lifecycle log (`event:"overlay-teardown"`)
   carrying its `instanceId`. The panel and mock-preview mounts do NOT emit it.
2. In real mode the adapter subscribes to `sdk.onMyMediaChange` during `init()` and
   emits a shape-only `media-change` lifecycle log per event (top-level keys + on/off
   booleans), never media content. Mock mode is unaffected.
3. All new logging goes through `logLifecycle`, contains no participant names,
   rates, or cost values, and cannot throw even if the sink fails.

Phase 2 (to build):

4. The adapter exposes `onMediaChange(cb)` returning an unsubscribe; in real mode it
   fans out each `onMyMediaChange` event to subscribers **in addition to** the phase-2
   diagnostic log. `MockZoom` exposes `onMediaChange(cb)` plus a way to simulate a
   camera toggle so the path is testable and exercisable in mock dev.
5. The panel auto-recovers the overlay: after the presenter's camera goes **off**
   (`video.state === false`) while `overlayOn` is true, the next camera **on**
   (`video.state === true`) re-runs `startCameraOverlay()` and pushes a fresh
   snapshot, logged as `overlay-rearm:begin` / `overlay-rearm:done`. The meter
   returns without a manual re-click.
6. Re-arm is correctly gated — it fires **only** on a real off→on transition while
   the overlay is on. It does NOT fire: on audio events, on video resolution-change
   events (no `state`), when `overlayOn` is false, or repeatedly without an
   intervening camera-off. The re-arm decision lives in a pure, table-tested helper
   (no jsdom), mirroring `runCameraDraw`/`reduceX` style.

Both:

7. No regressions: manual start/stop overlay and the draw/stream path are unchanged;
   `npm test && npm run build` (the gate) is green.
8. Scope containment: the diff touches only the files needed for the above. Run
   `git diff --name-only main...HEAD` and verify no files appear beyond:
   `client/src/components/OverlayApp.jsx`, `client/src/zoom/zoomAdapter.js`,
   `client/src/App.jsx`, the new recovery helper + its test, the touched test files,
   and `reviews/overlay-teardown-diagnostics.md`.

## Test notes

- AC1: unit-test the teardown hook — `pagehide` listener registered only when
  `transparentBody` is true; firing it logs `overlay-teardown`; no listener for the
  mock preview. (Built.)
- AC2: unit-test `RealZoom.init()` with a fake SDK exposing `onMyMediaChange` —
  subscribes and logs shape-only `media-change`; `MockZoom` has no such source.
  (Built.)
- AC3: assert payloads carry only allowed keys and a throwing sink does not
  propagate. (Built.)
- AC4: unit-test `adapter.onMediaChange` — a subscriber receives a fired/simulated
  event and unsubscribe stops delivery; `RealZoom` still emits the `media-change`
  log alongside the fan-out.
- AC5: unit-test (via `MockZoom.simulateCameraToggle` or a fired fake event) that an
  off→on sequence while `overlayOn` re-invokes `startCameraOverlay()` once and posts
  a fresh snapshot. Manually: in the next live run, toggling the camera off/on shows
  `overlay-rearm:*` and the meter returns on its own.
- AC6: table-test the pure recovery reducer — off→on while on ⇒ rearm; on-without-
  prior-off ⇒ no rearm; off/on while overlay off ⇒ no rearm; audio and
  resolution-only events ⇒ no rearm/no state change.
- AC7: run `npm test && npm run build`; all green. Confirm the existing
  start/stop/draw tests are untouched in behavior.
- AC8: `git diff --name-only main...HEAD` shows no files beyond those enumerated in
  AC8.

## Open questions

1. **Re-arm trigger semantics** — I've gated re-arm to a *confirmed* off→on
   transition (camera-off arms it, the next camera-on consumes it) so a stray
   `state:true` can't double-spawn a rendering context. Good, or would you rather
   re-arm on *any* camera-on while the overlay is on (simpler, slightly riskier)?
2. **Other teardown triggers** — phase 2 fixes only the camera off/on case you
   confirmed. Screen-share / virtual-background teardown (if real) would be a
   follow-up; the `media-change` + `overlay-teardown` logs stay in to catch them.
   OK to leave those out for now?

## Build note (2026-06-08)

AC → file map:

- **AC1** (overlay-teardown `pagehide` log, camera mount only) → `client/src/components/OverlayApp.jsx` (`registerOverlayTeardownLog` + effect); test `client/src/components/OverlayApp.test.js`.
- **AC2** (real-mode `onMyMediaChange` shape-only `media-change` log) → `client/src/zoom/zoomAdapter.js` (`summarizeMediaEvent` + init subscription); test `client/src/zoom/zoomAdapter.test.js`.
- **AC3** (logging via `logLifecycle`, no values, never throws) → `OverlayApp.jsx`, `zoomAdapter.js`; covered in both test files.
- **AC4** (`adapter.onMediaChange(cb)` fan-out; `MockZoom.simulateCameraToggle`) → `client/src/zoom/zoomAdapter.js`; test `client/src/zoom/zoomAdapter.test.js`.
- **AC5** (panel auto-recovers overlay on off→on; `overlay-rearm:*` logs) → `client/src/App.jsx` (media-change effect).
- **AC6** (pure, table-tested re-arm reducer) → `client/src/lib/overlayRecover.js`; test `client/src/lib/overlayRecover.test.js`.
- **AC7/AC8** (gate green; scope containment) → no product files; verified via the gate + `git diff --name-only main...HEAD`.

## Codex review (2026-06-08, base main, HEAD 5f0fcd0)

**Summary:** Reviewed `git diff main...HEAD`, `git log --oneline main..HEAD`, and the spec. The off→on recovery path is implemented; Codex found one gating edge case and one spec-required test gap. It could not run `npm test` (read-only sandbox blocked Vitest's temp Vite-config write, EPERM), so it did not verify the gate — the gate is green locally.

### IMPORTANT

1. **Stale rearm flag can survive while overlay is hidden** — `client/src/lib/overlayRecover.js:37`.
   When `needsRearm` is already true and a `video.state === true` event arrives while `overlayOn` is false, the reducer preserves `needsRearm`. Since `App.stopOverlay()` only sets `overlayOn` false and does not clear `needsRearmRef`, a user can hide the overlay after camera-off, then later show it again with a stale pending rearm; a later stray `state:true` would re-run `startCameraOverlay()` without a fresh off→on while the overlay was on — violating AC6's gating.
   *Suggestion:* clear the pending rearm whenever the overlay is off (on camera-on with `overlayOn === false`, and in `stopOverlay()`); add a regression test for off-while-on → hide → camera-on → show → stray camera-on does not rearm.

2. **AC5 panel recovery behavior is not unit-tested** — `client/src/App.jsx:179`.
   Reducer and adapter fan-out are tested, but no test exercises the panel effect that subscribes to `adapter.onMediaChange`, calls `startCameraOverlay()`, and posts the fresh snapshot. AC5's test note explicitly requires this, so the behavior can regress while current tests pass.
   *Suggestion:* add a test with a fake adapter / `MockZoom`: start the overlay, simulate camera off then on, assert one additional `startCameraOverlay()` call + a new `postMessage` snapshot, and no duplicate rearm without another camera-off.

## Decisions (2026-06-08)

- **Finding 1 (IMPORTANT — stale rearm flag survives while overlay hidden):** **FIX.** Thomas: "Fix." Clear `needsRearmRef` on manual start/stop and have `reduceOverlayRecovery` consume `needsRearm` on every camera-on; add the hide→show→stray-on regression test.
- **Finding 2 (IMPORTANT — AC5 panel recovery not unit-tested):** **FIX.** Thomas: "Fix." Extract the media-change handler into a plain injectable function and unit-test the off→on recovery (one `startCameraOverlay()` + fresh snapshot, no duplicate without another off).
