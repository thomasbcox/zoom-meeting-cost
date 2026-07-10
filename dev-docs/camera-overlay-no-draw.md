# Hypothesis brief — camera overlay enters the rendering context but never composites

> **✅ RESOLVED — reference only.** The overlay now composites correctly on supported clients; the
> fix shipped (context-shape routing so the `inCamera` instance draws; plus the Zoom Workplace
> 7.1.0+ floor for the ZSEE-195647 regression). Kept as a historical consult record — see the
> resolution at the end of this brief.

**For:** independent review (Codex). **Date:** 2026-06-06.
**Repo:** `zoom-meeting-cost` (Zoom App showing live meeting cost on the presenter's video).
**Branch state:** `main` @ `82b53f4` — includes the merged `camera-overlay-draws-panel`
fix (PR #13). Bundle served live: `index-Oy2d7SsT.js` (the post-fix build).

We want Codex to weigh in on **why the camera overlay never draws** and which of the
competing hypotheses below is correct (or propose a better one), grounded in the
bundled `@zoom/appssdk` types/docs and the code.

---

## Goal of the feature

Composite a small live cost meter onto the presenter's own camera feed so every
participant sees it natively (no install). Uses Zoom's **Layers API / camera mode**:
`runRenderingContext({view:'camera'})` then `drawParticipant` (the presenter's real
video, base layer) + `drawWebView` (the meter, transparent, on top).

## Current architecture (post-fix)

Single React app, two "instances" distinguished by `getRunningContext()`:

- **Panel** (`runningContext === 'inMeeting'`) → renders `App` (rate config + a
  "Show cost on video" button).
- **Camera** (`runningContext === 'inCamera'`) → renders `OverlayApp` (the meter),
  which draws the layers on mount.

Routing — `client/src/lib/renderMode.js`:
```js
export function renderModeFor(runningContext) {
  return runningContext === 'inCamera' ? 'overlay' : 'panel';
}
```

`client/src/Root.jsx` (abridged): boots the adapter, `const { context } = await adapter.init()`,
then `mode = renderModeFor(context?.runningContext)` → mounts `OverlayApp` for `overlay`,
else `App`. **If `init()` throws, it catches and falls back to panel mode**
(`runningContext: undefined`).

Panel button → `App.startOverlay()` → `adapter.startCameraOverlay()`:
```js
// RealZoom — client/src/zoom/zoomAdapter.js
async startCameraOverlay() {                    // PANEL only spawns the context
  await this._instrument('runRenderingContext', () =>
    this._sdk.runRenderingContext({ view: 'camera' }));
}
async drawCameraOverlay() {                      // CAMERA instance draws itself (OverlayApp mount)
  const rt = this._renderTarget || { width: 1280, height: 720 };
  const rect = { x: 0, y: 0, width: rt.width, height: rt.height };
  if (this._selfUUID) {
    await this._instrument('drawParticipant', () =>
      this._sdk.drawParticipant({ participantUUID: this._selfUUID, ...rect, zIndex: 1 }));
  } else {
    this._emitLog({ kind:'zoom-overlay', method:'drawParticipant', ok:false, error:'no self participantUUID' });
  }
  await this._instrument('drawWebView', () =>
    this._sdk.drawWebView({ webviewId: 'camera', ...rect, zIndex: 2 }));
}
```

`OverlayApp` calls `drawCameraOverlay()` on mount (gated on `transparentBody`, which is
true for the real camera mount) and clears on unmount. `init()` captures
`config.media.renderTarget` and resolves the presenter's `participantUUID` from
`getUserContext()` (fallback: name-match against `getMeetingParticipants()`).

The panel→camera state bridge (`connect` / `postMessage` / `onMessage`) already exists
and works.

## Why the fix was made (prior ground truth — important)

Before this fix, the **panel** called both `runRenderingContext` AND `drawWebView`. The
live result: **Zoom composited the full panel UI over the entire camera frame.** That
proves `drawWebView` composites the **calling instance's own DOM**. So to show a *lean*
meter (not the panel UI), a separate instance whose DOM *is* the meter must be the one
calling `drawWebView`. Hence the fix moved the draws to the `inCamera` instance.

---

## Symptom (now)

Clicking **"Show cost on video"** does nothing visible. Nothing composites on the video.
The panel still shows `Overlay: hidden · counting: idle`.

## Evidence — server log (`POST /api/log` client instrumentation), de-interleaved

Every cycle, repeated over ~2 hours, shows ONLY these `zoom-overlay` events:
```
runRenderingContext   ok: true
connect               ok: true        # most cycles
postMessage           ok: true        # once
```
plus, on at least two occasions:
```
connect   ok: false   error: "API can only be called when the Zoom app is running in a meeting."
```
and one earlier `ok:false` with the same "...running in a meeting" error (method truncated
in the log, likely `getMeetingParticipants`).

Each `runRenderingContext` is immediately followed by a fresh page load:
`GET /` → `GET /assets/index-Oy2d7SsT.js` + `index-IHyL8_Kh.css` + `sdk.es-DPTzdOeK.js`
→ `GET /favicon.ico`.

**Decisive negative:** `drawParticipant` and `drawWebView` **never appear in the log — not
once, not even as `ok:false`.** Our draw path is fully instrumented (every `_instrument`
call logs success/failure, and the no-UUID branch logs `ok:false`), so their total absence
means **`drawCameraOverlay()` is never called** — i.e. no instance ever mounts `OverlayApp`
(no instance ever reaches `renderModeFor === 'overlay'`).

## What's NOT in dispute

- `runRenderingContext({view:'camera'})` itself succeeds (`ok:true`).
- The post-fix bundle is live.
- The draw path is instrumented; its silence is real, not a logging gap.
- `drawWebView` composites the calling instance's own DOM (proven by the prior bug).

## Relevant `@zoom/appssdk` facts (from `node_modules/@zoom/appssdk/dist/sdk.d.ts`)

- `RunningContext` includes `'inCamera'` (our string match is correct).
- `runRenderingContext` doc: *"Changes the app's rendering context from the meeting
  sidebar to the main meeting window..."* — phrased as changing the **calling** app's
  context; the `immersive` note says *"Only one app instance can create an immersive
  rendering context"*.
- **`onRenderedAppOpened(handler)`** (marked `@hidden`): *"Notifies the inMeeting instance
  of an app that a **second instance** of the app has been opened in the meeting for Layers
  API related rendering purposes."* — i.e. a second (rendering) instance is opened, and the
  **inMeeting** instance is notified via this event. **Our code does not register or use
  `onRenderedAppOpened` at all.**
- `drawParticipant` doc: `participantUUID` *"can be filled with the value from
  `getMeetingParticipants` or `getUserContext`"* (our approach is valid).
- `config` response carries `media.renderTarget` (we read it).

---

## Competing hypotheses

**H1 — No second instance is opened.** `runRenderingContext({view:'camera'})` changes the
*caller's* (panel's) rendering context rather than spawning a separate `inCamera` webview;
the repeated `GET /` is the panel reloading. Under the new architecture the panel no longer
draws, and no `inCamera` instance exists → nothing draws. *(If true, the fix over-corrected:
we removed the only instance that was ever going to call `drawWebView`.)*

**H2 — A second instance opens but isn't detected as `inCamera`.** It boots (`GET /`,
`connect`), but its `getRunningContext()` returns something other than `'inCamera'`, so
`renderModeFor` → `'panel'`, it mounts `App`, and never draws.

**H3 — The second instance's `init()` throws → panel fallback.** The "API can only be
called when the Zoom app is running in a meeting" errors show the rendering instance lacks
meeting scope. If a meeting-scoped call in `init()` throws before `getRunningContext`
settles the mode, `Root` catches and falls back to panel mode (`runningContext: undefined`)
→ no draw. *(Note: in our current `init`, `getMeetingParticipants` is caught and `connect`
is fire-and-forget, so it's unclear what would actually throw — part of the question.)*

**H4 — Wrong trigger: we ignore `onRenderedAppOpened`.** Zoom's intended wiring may be that
the **inMeeting** instance listens for `onRenderedAppOpened` and that event (not a plain
`getRunningContext()==='inCamera'` check at boot) is what signals the rendering instance is
ready to draw — or the draw must be coordinated from/after that event. We never handle it,
so we may be missing the actual handshake.

## Questions for Codex

1. Which hypothesis best fits the SDK semantics + the evidence? In Zoom's camera-mode
   Layers API, does `runRenderingContext({view:'camera'})` **spawn a separate `inCamera`
   webview instance**, or change the **caller's** context? Cite the bundled types/docs.
2. In the correct pattern, **which instance** calls `drawParticipant`/`drawWebView`, and
   **what event/lifecycle** triggers it — `getRunningContext()==='inCamera'` at boot, or
   `onRenderedAppOpened` in the inMeeting instance, or something else? Is the official
   `zoomapps-cameramode-vuejs` sample shape (draw on the `inCamera` component's mount)
   actually sufficient, or does it rely on Marketplace surface config we may be missing?
3. Is the "API can only be called when the Zoom app is running in a meeting" error on
   `connect` a red herring, or does it indicate the rendering instance genuinely lacks
   meeting scope (and would that block the overlay)?
4. Given the total absence of `drawParticipant`/`drawWebView` log lines, what is the single
   most diagnostic instrumentation to add for the next live run to disambiguate H1–H4
   (e.g. log the raw `getRunningContext()` value per instance; log `OverlayApp` mount; log
   `onRenderedAppOpened`; log `init()` catch in `Root`)?
5. Any correctness issues in the current `drawCameraOverlay`/`renderTarget`/`participantUUID`
   wiring that would *also* need fixing once an instance does reach the draw path?

## Suggested next step (pending Codex)

A no-behavior-change **diagnostics** pass: log the raw `getRunningContext()` per instance,
log `OverlayApp` mount + `drawCameraOverlay` entry, register and log `onRenderedAppOpened`,
and log the `Root` `init()` catch — then one more live run to settle H1–H4 before any real
fix.

---

## Codex consultation (2026-06-06, read-only, repo @ 82b53f4)

**Verdict (Codex):** Not H1–H4 as framed — an **SDK response-shape bug in this repo**.
`getRunningContext()` returns `{ context: RunningContext }` (`sdk.d.ts:1101`), but
`Root` reads `context?.runningContext`, so every real context resolves to `undefined`
→ `renderModeFor(undefined)` → `panel` → the `inCamera` instance never mounts
`OverlayApp` → no draw. Matches the zero-draw logs exactly. The mocks/tests use the
non-SDK `{ runningContext }` shape, which masked it; `getRunningContext` was never
instrumented, which hid it.

**VERIFIED by Claude against `node_modules/@zoom/appssdk/dist/sdk.d.ts`:**
- `RunningContextResponse = { context: RunningContext }` — sdk.d.ts:1101–1103 ✓
- `ConfigResponse.runningContext: RunningContext` (config() uses the OTHER name) — sdk.d.ts:1049 ✓
- `RealZoom.init()` returns raw `getRunningContext()`; `Root.jsx:33` reads
  `context?.runningContext` → `undefined` ✓. **Confirmed root cause.**

Answers to the 5 questions (Codex): (1) `runRenderingContext({view:'camera'})` does open a
separate rendering instance — `onRenderedAppOpened` notifies the inMeeting instance a second
instance opened for Layers rendering (`sdk.d.ts:5254`); H1 unlikely. (2) Draws belong in the
camera/rendering instance after config/init/mount; `onRenderedAppOpened` is panel-side
readiness/diagnostic, not the camera component's draw trigger; the sample shape is consistent
with the types **assuming Marketplace camera surface/capabilities are set**. (3) The `connect`
"not in a meeting" error is **not** the no-draw cause (connect is swallowed, can't trigger
Root's fallback); it may still blank the overlay after drawing if the state bridge fails.
(4) Best diagnostic: log raw `getRunningContext()` and `config().runningContext` per
instance before routing, plus Root init catches and `onRenderedAppOpened`. (5) `renderTarget`
/ `participantUUID` wiring broadly valid, but `drawParticipant` failure currently aborts
`drawWebView`.

### BLOCKER

1. **Real running context is read from the wrong property** — `client/src/Root.jsx:33` (Codex said :36)
   reads `context?.runningContext` from the raw `getRunningContext()` result, whose SDK type is
   `{ context: RunningContext }` (`sdk.d.ts:1101`). Real contexts → `undefined` → `panel`; the
   camera instance never mounts `OverlayApp`/draws. **VERIFIED.**
   *Suggestion:* normalize in the adapter — derive a canonical
   `runningContext = raw?.context ?? raw?.runningContext` (and/or use `config().runningContext`),
   return one shape, route on that.

### IMPORTANT

2. **Tests/mocks encode the non-SDK context shape** — `zoomAdapter.test.js` fake returns
   `{ runningContext: 'inMeeting' }` and `MockZoom.init()` (`zoomAdapter.js:74`) does the same,
   masking the real `{ context }` contract so the routing bug survives the gate.
   *Suggestion:* switch fakes/mock to the real `{ context: ... }` shape and add a routing test
   proving a real-shaped `inCamera` mounts overlay mode.
3. **`drawParticipant` failure prevents `drawWebView`** — `zoomAdapter.js` `drawCameraOverlay()`
   awaits `drawParticipant` before `drawWebView`; `drawParticipant` is Host/Co-Host only
   (`sdk.d.ts:4724`) while `drawWebView` is broader, so a base-layer permission failure
   needlessly suppresses the meter.
   *Suggestion:* catch `drawParticipant` failures and still draw the webview; treat the video
   base layer as optional.

### QUESTION

4. **`onRenderedAppOpened` + Marketplace surface need live confirmation** — the app neither
   requests nor registers `onRenderedAppOpened` (`sdk.d.ts:5254`); once routing is fixed, a live
   run should confirm the raw context value, the second-instance event firing, and the
   Marketplace camera-mode surface/capability setup.

_Raw Codex output: `dev-docs/camera-overlay-no-draw.codex.json`._
