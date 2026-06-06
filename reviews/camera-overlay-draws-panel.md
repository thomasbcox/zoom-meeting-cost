# camera-overlay-draws-panel

Date: 2026-06-06 · Branch: claude/camera-overlay-draws-panel · Status: approved

> **Approved (2026-06-06, Thomas):** "approve with defaults". All four open
> questions take their proposed defaults: (1) presenter `participantUUID` from
> `getUserContext()`/`self`, falling back to the matched participant; (2)
> `drawParticipant` is a full-frame base layer sized to `renderTarget`; (3)
> `renderTarget` fallback = 1280×720; (4) camera-instance draw method named
> `drawCameraOverlay()`.

## Problem

A live Zoom run cleared the `40316` capability wall: the panel shows
"Overlay: on your video · counting: running", and `/api/log` confirms both
`runRenderingContext` and `drawWebView` succeeded. But instead of a minimal cost
meter composited onto the presenter's video, **Zoom draws the entire side-panel
UI** (the full `App` — "Real Zoom mode", rate rules, controls) over the whole
camera frame. It covers the full frame, matching the hardcoded
`drawWebView({ x: 0, y: 0, width: 1280, height: 720 })` call exactly.

Root cause, confirmed against Zoom's official camera-mode sample
([`zoomapps-cameramode-vuejs`](https://github.com/zoom/zoomapps-cameramode-vuejs)):
**`drawWebView` composites the webview of whichever app instance calls it.**
Our `App.jsx` (the side **panel** instance) calls `adapter.startCameraOverlay()`,
which runs *both* `runRenderingContext` *and* `drawWebView` from the panel — so
Zoom composites the panel's own webview (the full UI) onto the camera.

The correct architecture (same router shape we already have — `Root.jsx` ≈
`ImmersiveApps.vue`, `OverlayApp` ≈ `CameraMode.vue`):

- The **panel** only calls `runRenderingContext({ view: 'camera' })` to spawn the
  camera instance.
- The spawned **`inCamera`** instance draws *itself* on mount:
  - `drawParticipant({ participantUUID, …, zIndex: 1 })` — the presenter's real
    video as the base layer.
  - `drawWebView({ webviewId: 'camera', …, zIndex: 2 })` — the overlay UI on top,
    transparent background.
  - sized from `config.media.renderTarget` (the camera surface), **not** a
    hardcoded 1280×720.

Today `OverlayApp` (`OverlayApp.jsx`) draws nothing itself — it only subscribes
to the message bridge — and `RealZoom` never calls `drawParticipant` and never
reads `renderTarget`. The message bridge (panel → camera `postMessage`) and the
`inCamera` routing already exist and are correct; only the draw calls are in the
wrong instance.

This resolves the deferred `webviewId` backlog item: `webviewId` is just an
**arbitrary string label** (per the
[Zoom forum thread](https://devforum.zoom.us/t/where-does-the-webviewid-come-from-in-drawwebview-method/71357)),
not the cause — a red herring. This is exactly the AC6 the `real-zoom-smoke-gate`
story deferred, now with ground truth.

Sources:
[Zoom — Using the Layers API](https://developers.zoom.us/docs/zoom-apps/guides/layers-using-api/) ·
[official Camera Mode sample](https://github.com/zoom/zoomapps-cameramode-vuejs) ·
[webviewId forum thread](https://devforum.zoom.us/t/where-does-the-webviewid-come-from-in-drawwebview-method/71357)

## In scope

- **Move the draw calls to the camera instance.** `RealZoom.startCameraOverlay()`
  (called from the panel) calls **only** `runRenderingContext({ view: 'camera' })`
  — it no longer calls `drawWebView`.
- **New adapter method for the camera instance to draw itself** (e.g.
  `drawCameraOverlay()`), called by `OverlayApp` on mount. In `RealZoom` it:
  - calls `drawParticipant({ participantUUID, zIndex: 1, … })` with the surface
    sized from `config.media.renderTarget`,
  - calls `drawWebView({ webviewId: 'camera', zIndex: 2, … })`, transparent,
    sized from the same `renderTarget`,
  - is instrumented via the existing `_instrument(...)` / `/api/log` path
    (success/failure for `drawParticipant` and `drawWebView`).
- **Capture `renderTarget`.** `RealZoom.init()` keeps the return value of
  `sdk.config(...)` and stores `config.media.renderTarget` so the camera instance
  can size its draws (with a sane fallback if absent).
- **Capture the presenter's `participantUUID`** for `drawParticipant` (source TBD
  — see Open questions).
- **Teardown.** `RealZoom.stopCameraOverlay()` (panel) keeps calling
  `closeRenderingContext()`, which tears down all layers. The camera instance
  clears its own layers on unmount (`clearWebView` / `clearParticipant`) as
  belt-and-suspenders.
- **Add the two new capabilities** `drawParticipant` and `onMyMediaChange` to
  `ZOOM_CAPABILITIES` (`zoomAdapter.js`) and document them in
  `server/zoom-app-config.md`, including a note that they must also be enabled in
  the Marketplace dashboard (same as the others Thomas just toggled).
- **MockZoom parity.** `MockZoom` gains the new `drawCameraOverlay()` (records the
  `drawParticipant` + `drawWebView` calls) so the simulated preview path stays
  representative; its `startCameraOverlay()` records only `runRenderingContext`.
- **Update unit tests** to the new call placement (see Test notes).

## Non-goals

- **Running the live in-Zoom verification.** That the overlay actually composites
  the lean meter (not the panel) onto the video can only be confirmed by Thomas
  running inside the Zoom client; this branch makes that test possible and
  trustworthy but cannot automate it.
- **Toggling the Marketplace dashboard.** Enabling `drawParticipant` /
  `onMyMediaChange` in the Zoom Marketplace is a manual dashboard step Thomas
  performs; the branch only documents it and requests the capabilities in code.
- **Redesigning the overlay's visual content / CSS** beyond what transparency +
  `renderTarget` sizing requires. `CostOverlay` rendering is unchanged.
- **The session-lifecycle backlog bug** (no resume/start after End session) —
  separate item.
- **Using `onMyMediaChange` for live re-draws** (e.g. re-positioning when the
  presenter's video changes). We request the capability now; reacting to its
  events is deferred unless the live test shows it's required for the first draw.

## Acceptance criteria

1. **Panel no longer composites.** `RealZoom.startCameraOverlay()` calls
   `runRenderingContext({ view: 'camera' })` and **does not** call `drawWebView`
   or `drawParticipant`.
2. **Camera instance draws itself.** A new adapter method
   (`drawCameraOverlay()`) on `RealZoom`, when invoked, calls `drawParticipant`
   (zIndex 1) then `drawWebView({ webviewId: 'camera', … })` (zIndex 2), both
   sized from the captured `renderTarget`, with a documented fallback when
   `renderTarget` is unavailable.
3. **OverlayApp triggers the draw.** `OverlayApp` calls `adapter.drawCameraOverlay?.()`
   on mount (in the real camera context) and clears its layers on unmount.
4. **renderTarget captured.** `RealZoom.init()` stores `config.media.renderTarget`
   from the `sdk.config(...)` result; `drawCameraOverlay()` uses it (no hardcoded
   1280×720 in the real path).
5. **Capabilities added.** `ZOOM_CAPABILITIES` includes `drawParticipant` and
   `onMyMediaChange`; `server/zoom-app-config.md` lists both with a note that they
   must be enabled in the Marketplace dashboard.
6. **Instrumentation.** `drawParticipant` and `drawWebView` (from the camera
   instance) emit `zoom-overlay` success/failure entries via the existing
   `_instrument` path, preserving the re-throw-on-failure behavior.
7. **Mock parity & tests green.** `MockZoom` records the new sequence; all unit
   tests (`zoomAdapter.test.js`, others) and the build pass under
   `npm test && npm run build`.

## Test notes

- **AC1/AC2/AC6** — extend `zoomAdapter.test.js` `RealZoom` cases with a fake SDK
  recording call order: assert `startCameraOverlay()` records only
  `runRenderingContext`; assert `drawCameraOverlay()` records `drawParticipant`
  (zIndex 1) then `drawWebView` (zIndex 2, `webviewId: 'camera'`); assert both
  emit `ok: true` log entries and that a rejection logs `ok: false` and re-throws.
- **AC4** — fake `sdk.config()` returns `{ media: { renderTarget: { width, height } } }`;
  assert the draw calls use those dimensions, and assert the fallback path when
  `config()` omits `media.renderTarget`.
- **AC3** — `OverlayApp` test (jsdom): mount with a stub adapter exposing
  `drawCameraOverlay`/`onMessage`; assert `drawCameraOverlay` is called once on
  mount and the clear runs on unmount.
- **AC5** — update the `ZOOM_CAPABILITIES` test to require `drawParticipant` and
  `onMyMediaChange`; the doc change is reviewed by reading.
- **AC7** — `MockZoom` test updated: `startCameraOverlay()` records only
  `{ method: 'runRenderingContext', view: 'camera' }`; `drawCameraOverlay()`
  records the `drawParticipant` + `drawWebView` pair. Gate: `npm test && npm run build`.

## Open questions

1. **Source of the presenter's `participantUUID` for `drawParticipant`.** Three
   candidates: (a) `getUserContext()` (already called in `init()` as `self`) if it
   carries a `participantUUID`; (b) match `self` against `getMeetingParticipants()`
   to read its `participantUUID`; (c) the `onMyMediaChange` event payload. The
   Zoom sample is the authority — **proposed default: read it from
   `getUserContext()`/`self`, falling back to the matched participant**, and flag
   in code where it comes from. Confirm before I wire it.
2. **`drawParticipant` placement/size.** Full-frame base layer sized to
   `renderTarget` (proposed), matching the sample. Any reason to inset it?
3. **`renderTarget` fallback value** when `config.media.renderTarget` is absent —
   proposed 1280×720 (current hardcode) purely as a defensive fallback. OK?
4. **Method name** — `drawCameraOverlay()` proposed for the camera-instance draw.
   Prefer another name (`drawSelf`, `renderOverlay`)?

## Build note (2026-06-06)

AC → file map:

- **AC1** (panel only spawns) — `client/src/zoom/zoomAdapter.js` (`RealZoom.startCameraOverlay`), `MockZoom.startCameraOverlay`
- **AC2** (camera instance draws) — `client/src/zoom/zoomAdapter.js` (`RealZoom.drawCameraOverlay`), `MockZoom.drawCameraOverlay`
- **AC3** (OverlayApp triggers draw) — `client/src/components/OverlayApp.jsx`, `client/src/lib/cameraDraw.js` (+ test)
- **AC4** (renderTarget captured) — `client/src/zoom/zoomAdapter.js` (`RealZoom.init`, `_resolveSelfUUID`, `DEFAULT_RENDER_TARGET`)
- **AC5** (capabilities + doc) — `client/src/zoom/zoomAdapter.js` (`ZOOM_CAPABILITIES`), `server/zoom-app-config.md`
- **AC6** (instrumentation) — `client/src/zoom/zoomAdapter.js` (`drawCameraOverlay` via `_instrument`)
- **AC7** (mock parity + tests) — `client/src/zoom/zoomAdapter.test.js`, `client/src/lib/cameraDraw.test.js`

Deviation: AC3 test note specified jsdom; the repo has no jsdom/testing-library
(component tests call functions directly), so the mount/unmount contract was
extracted into `cameraDraw.js` and unit-tested in the node env instead.

`git diff --stat main...HEAD`:

```
 client/src/components/OverlayApp.jsx  |   7 ++
 client/src/lib/cameraDraw.js          |  17 ++++
 client/src/lib/cameraDraw.test.js     |  26 ++++++
 client/src/zoom/zoomAdapter.js        |  98 ++++++++++++++++++--
 client/src/zoom/zoomAdapter.test.js   | 132 ++++++++++++++++++++++++---
 reviews/camera-overlay-draws-panel.md | 165 ++++++++++++++++++++++++++++++++++
 server/zoom-app-config.md             |  11 ++-
 7 files changed, 437 insertions(+), 19 deletions(-)
```

## Codex review (2026-06-06, base main, HEAD 1d4bdab)

**Summary:** Reviewed `git log --oneline main..HEAD`, `git diff main...HEAD`,
and the spec. The draw placement now matches the spec; Codex found one teardown
issue. (Codex did not run test/build in the read-only sandbox.)

### IMPORTANT

1. **Participant layer is not actually cleared on unmount** — `client/src/zoom/zoomAdapter.js:342`
   `drawCameraOverlay()` draws the base layer with `participantUUID: this._selfUUID`,
   but `clearCameraOverlay()` calls `clearParticipant` with no options, and
   `ZOOM_CAPABILITIES` does not request `clearParticipant`. The story requires the
   camera instance to clear its own `drawWebView` / `drawParticipant` layers on
   unmount; as written, the participant base layer will not be reliably cleared
   before the panel calls `closeRenderingContext()`. Zoom's SDK documents
   `clearParticipant` as taking the participant identifier
   (ClearParticipantOptions).
   **Suggestion:** Request `clearParticipant` in `ZOOM_CAPABILITIES` and document
   it in `server/zoom-app-config.md`; in `clearCameraOverlay()`, call
   `this._sdk.clearParticipant?.({ participantUUID: this._selfUUID })` when
   `_selfUUID` is present, and update tests to assert that argument.

## Decisions (2026-06-06)

- **IMPORTANT #1 (clearParticipant no-op on unmount) — REJECT the suggested fix; drop the dead call.**
  Thomas: "Reject — drop dead call." Rationale: `stopCameraOverlay()` →
  `closeRenderingContext()` is the real teardown (it removes *all* camera layers
  and is what triggers the unmount), so a per-layer `clearParticipant` is
  redundant. Rather than add a third Marketplace capability for a
  belt-and-suspenders call, remove the non-functional `clearParticipant` line
  from `clearCameraOverlay()`. Keep `clearWebView` (already a requested
  capability, and it works). This is applied in `/close`.

## Fixes (2026-06-06)

- **IMPORTANT #1 (REJECT suggested fix; drop dead call) — applied.** Removed the
  non-functional `this._sdk.clearParticipant?.()` line from
  `clearCameraOverlay()` (`zoomAdapter.js`). It was a no-op (no `participantUUID`
  arg, capability not requested) and `closeRenderingContext()` already removes
  all camera layers on teardown. `clearWebView` (a requested capability that
  works) is retained. No new Marketplace capability added. No test change needed
  (no test asserted the removed call).

## Build note (2026-06-06, re-review round)

Re-review base: last-reviewed SHA `1d4bdab`. Only change since:
the reject-and-remove of the dead `clearParticipant` line in
`clearCameraOverlay()` (Codex #1) plus the review/decision/fix story notes.

`git diff --stat 1d4bdab...HEAD`:

```
 client/src/zoom/zoomAdapter.js                | 13 ++---
 reviews/camera-overlay-draws-panel.codex.json |  1 +
 reviews/camera-overlay-draws-panel.md         | 72 +++++++++++++++++++++++++++
 3 files changed, 78 insertions(+), 8 deletions(-)
```
