Date: 2026-06-10 · Branch: claude/overlay-rearm-reopen · Status: approved

> Approved by Thomas 2026-06-10: "go ahead." `getVideoState` is **already added** in
> the Marketplace dashboard (so AC7 is live-verifiable on the next deploy). Added
> scope: `server/zoom-app-config.md` should list **all** SDK API settings and be
> up to date (a complete list mirroring `ZOOM_CAPABILITIES`, incl. `getVideoState`).
> Poll cadence 1.5 s and removing the dead event path: accepted as drafted.

Fixes the backlog item **"Overlay auto-recover does not fire on camera off/on
(live)."** A live log (2026-06-10) proved the root cause: **`onMyMediaChange` never
fires in the panel**, so the event-driven auto-recover shipped in
`overlay-teardown-diagnostics` can never trigger. The fix replaces the event trigger
with **polling `getVideoState()`** from the surviving panel, and performs a
**close-then-reopen** of the rendering context (mirroring the manual Hide→Show that
Thomas confirmed is the only thing that restores the overlay).

## Problem

With the cost overlay on, turning the camera **off then on** leaves the meter gone.
The button still reads "Hide from video" (`overlayOn` is still `true`), and the only
recovery is a manual **Hide → Show** double-click.

Two facts from the live Railway log (2026-06-10):

1. **`onMyMediaChange` does not fire in the panel.** Across a clear camera toggle the
   log shows **zero `media-change` entries** (and zero `overlay-rearm:*`). The
   capability is granted (no `40316`; `drawParticipant` returns `ok:true`), but
   self-media events only reach the `inCamera` instance — which Zoom **destroys** on
   camera-off — while the surviving `inMeeting` panel never receives them. The instance
   that could hear "camera's back" is the one that died. So the shipped event-based
   auto-recover (`reduceOverlayRecovery` / `createMediaRecoveryHandler`) is dead in
   production — nothing triggers it.
2. **Restoring requires close *then* reopen.** Thomas's manual fix is Hide→Show =
   `stopCameraOverlay()` (closeRenderingContext) **then** `startCameraOverlay()`
   (runRenderingContext). A single reopen is not enough.

So the panel needs a signal it can obtain **itself**. The SDK provides
`getVideoState()` → `{ video: boolean }`, a *pollable* camera on/off state. The panel
survives the camera toggle, so it can poll this, detect an **off→on** edge while the
overlay is on, and then close+reopen — no dependence on the dead event.

## In scope

- **Adapter:** add `adapter.getVideoState()` → `boolean` (RealZoom wraps
  `sdk.getVideoState().video`; MockZoom returns a settable value for tests/dev). Add
  `getVideoState` to `ZOOM_CAPABILITIES`.
- **Docs:** make `server/zoom-app-config.md`'s SDK-capabilities section a **complete,
  current list that mirrors `ZOOM_CAPABILITIES` exactly** (every entry, including the
  new `getVideoState`) so the dashboard "Add APIs" set is documented in one place and
  doesn't drift. `getVideoState` is **already added** in the dashboard (Thomas,
  2026-06-10); the doc records it.
- **Pure transition reducer** `reduceVideoPoll(currentVideoOn, { overlayOn, lastVideoOn })`
  → `{ lastVideoOn, recover }`: `recover` is true only on a rising edge
  (`lastVideoOn === false && currentVideoOn === true`) while `overlayOn` — table-tested
  without jsdom.
- **Poll recovery handler** `createVideoRecovery({ getOverlayOn, getLastVideoOn,
  setLastVideoOn, getVideoState, stopCameraOverlay, startCameraOverlay, postOverlay,
  log })`: reads `getVideoState` (swallowing errors so a missing capability degrades to
  manual), runs the reducer, and on `recover` performs **close-then-reopen** —
  `stopCameraOverlay()` (best-effort) → `startCameraOverlay()` → `postOverlay()` —
  logged `overlay-rearm:begin/done`. Uses the **adapter** methods directly so
  `overlayOn` is untouched (the button keeps reading "Hide from video").
- **App.jsx:** poll `getVideoState` on an interval while `overlayOn`, driving the
  handler. This **replaces** the dead `onMyMediaChange` recovery wiring.
- **Remove the dead event-recovery path** (`reduceOverlayRecovery`,
  `createMediaRecoveryHandler`, the App `onMediaChange` effect, and the adapter's
  `onMediaChange` fan-out + `simulateCameraToggle`) and its tests. **Keep** the
  `onMyMediaChange` → `media-change` diagnostic log and the `onMyMediaChange` capability
  (it still feeds `drawParticipant` and documents the non-firing).

## Non-goals

- **No reliance on `onMyMediaChange` for recovery** — proven not to fire in the panel.
- **No change to the manual Show/Hide buttons** (they work perfectly), the session
  state machine, cost engine, or message bridge.
- No recovery for other teardown causes (screen share, etc.) — only camera off/on.
- **Does not flip the Marketplace dashboard** — adding `getVideoState` under Add APIs is
  a one-time manual step only Thomas can do; AC7 depends on it.

## Acceptance criteria

1. `ZOOM_CAPABILITIES` includes `getVideoState`; `RealZoom.getVideoState()` resolves to
   the boolean `sdk.getVideoState().video`, and `MockZoom.getVideoState()` returns a
   value settable by the test/dev harness. `server/zoom-app-config.md` lists **every**
   `ZOOM_CAPABILITIES` entry (a complete, current set including `getVideoState`) under
   the dashboard "Add APIs" section — verified to match the code list exactly.
2. `reduceVideoPoll(current, { overlayOn, lastVideoOn })` returns `recover: true` **only**
   on an off→on rising edge while `overlayOn`, and always updates `lastVideoOn` to
   `current`. Table-tested: off→on while on ⇒ recover; on→on / off→off / on→off ⇒ no
   recover; any transition while `overlayOn` is false ⇒ no recover.
3. `createVideoRecovery`, on `recover`, calls `stopCameraOverlay()` **before**
   `startCameraOverlay()`, then `postOverlay()` (order asserted); the close is
   best-effort (if it rejects, the reopen still runs); a throwing/rejecting
   `getVideoState` is swallowed (no recover, no throw).
4. `App.jsx` polls `getVideoState` on an interval while `overlayOn`, driving the handler;
   the dead `onMyMediaChange` recovery wiring is gone. The handler path never calls
   App's `setOverlayOn` (so `overlayOn` stays `true` across recovery).
5. The dead event-recovery code (`reduceOverlayRecovery`, `createMediaRecoveryHandler`,
   adapter `onMediaChange`/`simulateCameraToggle`) and its tests are removed; the
   `media-change` diagnostic log and `onMyMediaChange` capability remain.
6. No regression: manual Show/Hide and the draw/stream path are unchanged;
   `npm test && npm run build` is green.
7. **(Post-merge, deploy-observed.)** `getVideoState` is already added in the dashboard,
   so once deployed, toggling the camera **off then on** with the overlay on restores the
   meter **automatically — no manual double-click** — and the Railway log shows
   `overlay-rearm:begin/done` plus close-then-reopen (`closeRenderingContext` then
   `runRenderingContext`). (Defensive: if `getVideoState` ever errors, it's swallowed and
   behavior degrades to the manual double-click — no regression.)
8. Scope containment: run `git diff --name-only main...HEAD` and verify no files appear
   beyond `client/src/zoom/zoomAdapter.js`, `client/src/zoom/zoomAdapter.test.js`,
   `client/src/lib/overlayRecover.js`, `client/src/lib/overlayRecover.test.js`,
   `client/src/App.jsx`, `server/zoom-app-config.md`, and this story file
   (`reviews/overlay-rearm-reopen.md`).

## Test notes

- **AC1:** `zoomAdapter.test.js` — `ZOOM_CAPABILITIES` contains `getVideoState`;
  `RealZoom.getVideoState()` returns the fake SDK's `.video` boolean; `MockZoom`
  returns its settable value. Read `zoom-app-config.md` for the dashboard note.
- **AC2:** `overlayRecover.test.js` — table over the four transitions × overlayOn
  true/false.
- **AC3:** drive `createVideoRecovery` with a fake adapter recording call order; assert
  close-before-reopen-before-post; close-rejects-still-reopens; getVideoState-throws is
  swallowed.
- **AC4:** read `App.jsx` — interval polls `getVideoState` gated on `overlayOn`; no
  `onMediaChange` recovery effect; no `setOverlayOn` in the recovery path.
- **AC5:** `git grep` shows `reduceOverlayRecovery`/`createMediaRecoveryHandler`/
  `simulateCameraToggle`/adapter `onMediaChange` gone; `media-change` log retained.
- **AC6:** `npm test && npm run build` green.
- **AC7:** **post-merge + dashboard** — live, toggle camera off→on with overlay on; meter
  returns on its own; confirm `overlay-rearm:*` + close/reopen in the Railway log.
- **AC8:** `git diff --name-only main...HEAD` shows no files beyond those AC8 lists.

## Open questions

1. **Poll cadence.** Default: poll `getVideoState` every **1.5 s** while the overlay is
   on (cheap; ~1–2 s to auto-restore after the camera returns). Faster (e.g. 1 s) =
   snappier recovery, more SDK calls; slower = fewer calls, laggier. OK with 1.5 s?
2. **Dashboard dependency — RESOLVED.** `getVideoState` is already added in the
   Marketplace dashboard (Thomas, 2026-06-10), so AC7 is live-verifiable on the next
   deploy with no pending manual step.
3. **Removing the event path.** I'm deleting the now-dead `onMyMediaChange`-based
   recovery (keeping the diagnostic log). If you'd rather keep it as a dormant
   secondary trigger in case Zoom ever fires it, say so — but it adds a double-fire
   guard for no current benefit.
