Date: 2026-06-08 · Branch: claude/overlay-teardown-diagnostics · Status: approved

> Approved by Thomas 2026-06-08: "Diagnostics only" — add teardown +
> onMyMediaChange logging, no behavior change / no auto-recover (deferred to a
> follow-up once the live run reveals the trigger).

## Problem

In a live in-Zoom run the camera-overlay cost display "switches off" by itself,
and we don't know why. The Railway log from 2026-06-08 shows the failure mode but
not the cause:

- 20:01:44 — side **panel** boots (`i_9acfp9`, `inMeeting`, `panel`) and mounts.
- 20:02:14 — `start-overlay:begin status:idle` → the **camera** overlay instance
  boots (`i_3w8ia6`, `inCamera`, `overlay`), draws (`drawWebView`/`drawParticipant`
  ok), and receives a snapshot (`overlay-message status:running`). Display is on.
- ~53 min gap with no overlay logs.
- 20:55:31 — `start-overlay:begin` fires **again**, this time `status:"running"`
  (i.e. a *manual* re-click of "Show cost on video"), and a **new** camera instance
  boots (`i_0hpbot`) replacing `i_3w8ia6`.

So: the panel instance survived the whole session, but the camera-overlay instance
silently disappeared sometime between 20:02 and 20:55 and had to be manually
restarted. **No log records the teardown**, so the trigger is unknown.

Code-level prime suspect: the adapter requests the `onMyMediaChange` capability
(`client/src/zoom/zoomAdapter.js`) but **never subscribes to it**, and nothing logs
when the camera instance unloads. Zoom is known to close the camera *rendering
context* on media/lifecycle changes (camera off/on, stop-video, screen share,
virtual-background swap). Any of those would kill the overlay webview with no trace
in our logs.

This story is **diagnostics-only**: add the instrumentation that will reveal *when*
the overlay dies and *what Zoom event coincides with it*, so the actual fix
(auto-recover / re-arm the rendering context) can be framed as a follow-up against
a confirmed cause rather than a guess. No behavioral change to the overlay.

## In scope

- Log the camera-overlay instance **teardown** (its webview unloading) so the
  disappearance leaves a timestamped trace instead of silence.
- Subscribe to Zoom's `onMyMediaChange` (capability is already requested) and log
  each media event (shape/kind only, no media content) so a teardown can be
  correlated with a video/camera state change.
- Keep all new logging on the existing `/api/log` lifecycle channel
  (`logLifecycle`), privacy-preserving (no names/rates/values), and never able to
  throw — matching the existing instrumentation contract.

## Non-goals

- **No fix / no auto-recovery.** Re-arming `runRenderingContext`, auto-restarting
  the overlay, or any change to when the overlay starts/stops is explicitly out of
  scope — it depends on the cause this story is meant to capture. (Follow-up story.)
- No change to the panel/session state machine, cost math, or message bridge.
- No new Zoom capabilities beyond those already in `ZOOM_CAPABILITIES`.
- The existing "no resume after End session" backlog item is separate and untouched.

## Acceptance criteria

1. When the camera-overlay instance's page is being torn down (the `pagehide`
   event on the `inCamera`/overlay mount), it emits a lifecycle log
   (e.g. `event:"overlay-teardown"`) carrying its `instanceId`, before it goes away.
   The panel mount and the mock preview mount do NOT emit this event.
2. In real mode, the adapter subscribes to `sdk.onMyMediaChange` during `init()`
   and emits a lifecycle log per event (e.g. `event:"media-change"`) recording only
   non-sensitive shape (e.g. which media keys changed / on-off booleans), never
   media content. Mock mode is unaffected (no such event source).
3. All new logging goes through `logLifecycle` (the `/api/log` lifecycle channel),
   contains no participant names, rates, or cost values, and cannot throw even if
   the sink fails (same swallow-and-continue contract as existing logs).
4. No behavioral change: with logging aside, the overlay starts, draws, streams,
   and stops exactly as before. Existing tests still pass and the build succeeds.
5. Scope containment: the diff touches only the files needed for the above
   (expected: `OverlayApp.jsx`, `zoomAdapter.js`, and their test files, plus this
   story file). No unrelated files.

## Test notes

- AC1: unit-test the teardown hook in `OverlayApp` — assert a `pagehide` listener is
  registered only when `transparentBody` is true (the real camera mount) and that
  firing it calls the logger with the teardown event + instanceId; assert no
  listener when `transparentBody` is false (mock preview). Manually: in the next
  live run the Railway log shows `overlay-teardown` at the moment the display dies.
- AC2: unit-test `RealZoom.init()` with a fake SDK exposing `onMyMediaChange` —
  assert it subscribes and that invoking the callback emits a `media-change`
  lifecycle log via the injected sink with only shape fields. Assert `MockZoom` has
  no such subscription. Manually: live log shows `media-change` events, letting us
  correlate one with the `overlay-teardown`.
- AC3: assert log payloads contain only the allowed keys (instanceId, event name,
  shape booleans) and that a throwing sink does not propagate.
- AC4: run `npm test && npm run build` (the gate); all green. Overlay draw/stream
  path unchanged.
- AC5: run `git diff --name-only main...HEAD` and verify no files appear beyond
  `client/src/components/OverlayApp.jsx`, `client/src/zoom/zoomAdapter.js`, their
  associated test files, and `reviews/overlay-teardown-diagnostics.md`.

## Open questions

1. **Diagnostics-only vs. also attempt the fix now.** I've scoped this as
   instrument-first so the real cause is captured before we change behavior. Do you
   want to keep it strictly diagnostics (recommended — one live run then we frame
   the fix against the confirmed trigger), or should I also add a first-cut
   auto-recover (re-run `runRenderingContext` when the overlay tears down while the
   session is still `running`) in the same story?
2. **`onMyMediaChange` payload shape.** I'll log only on/off-style booleans and
   changed-key names. If you know the exact event fields Zoom delivers and want a
   specific field captured, say so; otherwise I'll keep it to safe shape-only.
3. Is there any *other* Zoom event you suspect (screen-share start/stop, gallery↔
   speaker switch)? If the SDK exposes a dedicated rendering-context-close event we
   could log that too — but I won't add capabilities beyond those already requested
   without your go-ahead.
