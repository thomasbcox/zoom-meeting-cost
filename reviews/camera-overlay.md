Date: 2026-06-03 · Branch: claude/camera-overlay · Status: approved

> Approved by Thomas 2026-06-03: "1 yes attendee count, yes corner; 2 yes ok to
> leave for now; 3 yes; 4 yes." Open questions resolved below.

# Camera-overlay cost meter (Timer-app model)

## Problem
The app is built as a **Collaborate-mode** app: every participant loads the same
webview, the presenter's config is what they see, and live state is broadcast
over a WebSocket. In practice this means viewers see the presenter's config panel
while in "collaborate" mode and **nothing at all** otherwise. That is the wrong
model.

It should work like Zoom's **Timer app**: the presenter privately configures
rates in the in-meeting **side panel**, then starts a live "taxi meter" that
renders as a **transparent overlay composited onto the presenter's camera/video
feed** via Zoom's camera rendering context. All participants see the accumulating
cost natively in the presenter's video tile — no second webview, no collaborate
space, no shared-state broadcast for the display.

## In scope
- Route the app by Zoom **running context**: side panel (`inMeeting`) renders the
  presenter config + an overlay Start/Stop control; camera context (`inCamera`)
  renders the **overlay only** (transparent, taxi-meter).
- Wire the **camera rendering context** in the `RealZoom` adapter:
  `runRenderingContext({view:'camera'})` → `drawWebView(...)` → `closeRenderingContext()`,
  plus the `postMessage`/`onMessage` bridge to hand live state from the side
  panel instance to the camera instance.
- A new **overlay component**: large accumulating total + cost/minute + elapsed,
  transparent background, self-extrapolating between state ticks (reuse the
  existing extrapolation approach from `ViewerScreen`).
- Send only **sanitized** overlay state to the camera context (resolved aggregate
  numbers + timestamp + prefs) — never the private rate table.
- Remove the **viewer / collaborate display path** from the client: the `viewer`
  role, `ViewerScreen` as a participant-facing screen, and the WebSocket broadcast
  *as the display mechanism*.
- Update `RealZoom.config` capabilities and `server/zoom-app-config.md` for the
  camera-rendering APIs.
- Keep the prototype **runnable for visual review** in mock/browser mode via a
  simulated "camera frame" preview (so the overlay can be seen without real Zoom).

## Non-goals
- Deleting the server WebSocket / `rooms.js` code. After this change it is unused
  for the display; removing it is a separate cleanup story (noted in backlog).
- Real Zoom Marketplace re-submission / scope approval flow.
- Immersive (`view:'immersive'`) / full-stage rendering — camera overlay only.
- Changing the rate-matching / cost math (`lib/normalize|matching|cost`).
- Multi-presenter or per-participant overlays — overlay renders on the presenter's
  own feed only.

## Acceptance criteria
1. **Context routing.** A pure function maps a Zoom running context to a render
   mode: `inCamera` → `overlay`; everything else (`inMeeting`, default/mock) →
   `panel`. `App` renders the overlay-only tree for `overlay` and the
   presenter-config tree for `panel`. No `viewer` role and no role dropdown remain
   in the production render path.
2. **Overlay Start/Stop control.** From the side panel the presenter can Start and
   Stop the camera overlay. Start invokes the adapter's camera-overlay start
   (`runRenderingContext({view:'camera'})` then `drawWebView`); Stop invokes
   `closeRenderingContext`. The control reflects current overlay on/off state.
3. **Overlay render.** In the camera context the app renders **only** the
   taxi-meter — large live total plus cost/minute and elapsed — on a transparent
   background with no panels, header, or role bar. It self-extrapolates between
   state updates so the total ticks smoothly.
4. **Sanitized state hand-off.** A `buildOverlayState()` produces the payload sent
   to the camera context containing only `{ status, totalCost, costPerSecond,
   elapsedSeconds, attendees, currency, updatedAt, prefs }` — no participant names
   or private rates. The adapter delivers it via `postMessage`, and the camera
   instance updates from `onMessage`.
5. **Collaborate/viewer path removed.** `ViewerScreen` is no longer reachable as a
   participant display and the `viewer` role is gone from the client; no
   participant other than the presenter loads a webview to see the cost. Build and
   the remaining test suite pass with these removed.
6. **Capabilities + docs.** `RealZoom.config` requests `runRenderingContext`,
   `drawWebView`, `clearWebView`, `closeRenderingContext`, `postMessage`,
   `onMessage`, and `getRunningContext`; `server/zoom-app-config.md` lists the same
   under SDK capabilities.
7. **Runnable mock preview.** In mock/browser dev the overlay is viewable inside a
   simulated camera frame (so `npm run dev` still demonstrates the display), and
   `MockZoom` records the camera-overlay calls so AC-2/AC-4 are unit-testable.

## Test notes
- AC-1: unit test the context→mode function for `inCamera`, `inMeeting`, unknown.
- AC-2: unit test against `MockZoom` asserting Start records a
  `runRenderingContext({view:'camera'})` + `drawWebView`, and Stop records
  `closeRenderingContext`.
- AC-3: component test — given overlay state, the overlay renders the total and
  carries the transparent/overlay container class; no `.panel`/`.rolebar` nodes.
- AC-4: unit test `buildOverlayState()` includes exactly the sanitized fields and
  excludes participant names / rates; mock `postMessage`→`onMessage` round-trip.
- AC-5: grep/build — no `viewer` render path; `npm test && npm run build` green.
- AC-6: unit assert the capability list; doc diff reviewed.
- AC-7: covered by AC-2/AC-4 mock instrumentation; manual `npm run dev` check.
- **Gate cannot exercise real camera compositing.** Final proof is a manual
  in-Zoom run (presenter starts overlay, a second participant confirms the meter
  appears on the presenter's video tile). Flagged as a manual verification step,
  not automated.

## Open questions (resolved)
1. **Overlay content/layout** — RESOLVED: show prominent total + cost/min +
   elapsed **and attendee count**; position in a **corner** of the video.
2. **Server WebSocket** — RESOLVED: leave `rooms.js` in place but unused; cleanup
   is a separate follow-up story.
3. **Known Zoom risk** — RESOLVED: ship behind the manual in-Zoom verification;
   treat a `drawWebView` no-op as a Zoom-side issue if it recurs.
4. **Mock preview fidelity** — RESOLVED: a lightweight simulated camera frame is
   enough for visual review.

## Build note (2026-06-03)

AC → implementing files:
1. Context routing → `client/src/lib/renderMode.js`, `client/src/Root.jsx`, `client/src/main.jsx`
2. Overlay Start/Stop control → `client/src/components/PresenterControls.jsx`, `client/src/App.jsx` (startOverlay/stopOverlay), adapter `startCameraOverlay`/`stopCameraOverlay`
3. Overlay render (transparent, taxi meter) → `client/src/components/CostOverlay.jsx`, `client/src/components/OverlayApp.jsx`, `client/src/styles.css`
4. Sanitized state hand-off → `client/src/lib/overlayState.js` (`buildOverlayState`), adapter `postMessage`/`onMessage` bridge, `App.jsx` `postOverlay`
5. Collaborate/viewer path removed → deleted `client/src/components/ViewerScreen.jsx`; `RoleBar.jsx` (role dropdown/conn/room removed); App no longer uses sync/buildSharedState
6. Capabilities + docs → `client/src/zoom/zoomAdapter.js` (`ZOOM_CAPABILITIES`), `server/zoom-app-config.md`, `README.md`
7. Runnable mock preview → `App.jsx` simulated camera frame (mock only), `MockZoom` call recording + message loopback

Tests added: `renderMode.test.js`, `overlayState.test.js`, `zoomAdapter.test.js`, `CostOverlay.test.js`.

`git diff --stat main...HEAD`:
 README.md                                   |  72 +++++----
 client/src/App.jsx                          | 217 +++++++++++++---------------
 client/src/Root.jsx                         |  49 +++++++
 client/src/components/CostOverlay.jsx       |  36 +++++
 client/src/components/CostOverlay.test.js   |  38 +++++
 client/src/components/OverlayApp.jsx        |  37 +++++
 client/src/components/PresenterControls.jsx |  50 +++----
 client/src/components/RoleBar.jsx           |  37 +----
 client/src/components/ViewerScreen.jsx      |  33 -----
 client/src/lib/overlayState.js              |  56 +++++++
 client/src/lib/overlayState.test.js         |  84 +++++++++++
 client/src/lib/renderMode.js                |  13 ++
 client/src/lib/renderMode.test.js           |  18 +++
 client/src/main.jsx                         |   4 +-
 client/src/styles.css                       |  92 ++++++++++++
 client/src/zoom/zoomAdapter.js              | 104 +++++++++++--
 client/src/zoom/zoomAdapter.test.js         |  58 ++++++++
 reviews/backlog.md                          |  12 ++
 reviews/camera-overlay.md                   | 110 ++++++++++++++
 server/zoom-app-config.md                   |  20 ++-
 20 files changed, 875 insertions(+), 265 deletions(-)

## Codex review (2026-06-03, base main, HEAD d65b573)

**Summary:** Reviewed `git diff main...HEAD`, `git log --oneline main..HEAD`, and the spec. The branch generally implements the requested context routing, sanitized overlay state, capability docs, and viewer-path removal. (Codex could not run `npm test` — the read-only sandbox blocked Vitest/Vite from writing its temp config; gate was run green outside Codex.)

### IMPORTANT
1. **Mock preview does not hide when overlay is stopped** — `client/src/App.jsx:176`.
   The simulated camera frame always mounts `OverlayApp` whenever `adapter.isMock`. `stopOverlay()` only calls `stopCameraOverlay()` and flips `overlayOn` false, but the mounted `OverlayApp` retains the last message state and keeps rendering (and ticking) the cost meter in the mock preview after "Hide from video". The control state then disagrees with the preview — breaks AC-7 mock visual-review fidelity.
   *Suggestion:* gate the mock `OverlayApp` render on `overlayOn`, or have `stopOverlay`/`MockZoom.stopCameraOverlay` clear the overlay state and notify subscribers so the frame empties when hidden.

_No BLOCKER, QUESTION, or NIT findings._

## Decisions (2026-06-03)

- **IMPORTANT #1 (mock preview doesn't hide):** Thomas — **Fix**. Gate the mock `OverlayApp` on `overlayOn` so the simulated camera frame empties when "Hide from video" is clicked; re-run the gate. To be applied in /close.
