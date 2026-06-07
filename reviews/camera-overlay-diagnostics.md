# camera-overlay-diagnostics

Date: 2026-06-07 · Branch: claude/camera-overlay-diagnostics · Status: approved

> **Approved (2026-06-07, Thomas):** "approve and implement." Open questions take the
> proposed defaults: (1) log every `overlay-message` receipt this round; (2) keep the
> `lifecycle` logs permanent as the first slice of Option 2 observability.

## Problem

The overlay draws (`drawParticipant`/`drawWebView` `ok:true`) but shows an empty meter,
and the latest live run — with every-`postMessage`-send now logged — shows **zero
`postMessage` sends**. So the panel isn't sending at all; the receive side is moot.

We have a strong hypothesis (the inMeeting sender doesn't survive `runRenderingContext`,
so `postOverlay()` and the 1s tick never run), but we have **theorized the instance
topology three times this session and been wrong/blind each time** — the real answers
came from instrumentation and the official sample, never from reasoning. We are still
missing the signals that would make this deterministic:

- how many app instances load per "Show", and what `getRunningContext()` each reports
  (panel vs camera vs other);
- whether the inMeeting panel **survives** `runRenderingContext` and reaches `postOverlay`;
- whether `OverlayApp` mounts in the camera instance and **ever receives** an `onMessage`.

This story adds that observability — **instrument-only, no behaviour change** — so one
live run produces a labelled trace and we choose the data-channel fix (keep-sender-alive
vs. server relay vs. camera-pulls) from evidence, not guesses. It is the "restore sight"
step of the agreed Option 2 sequence.

## In scope

- **Per-instance id.** A module-level `instanceId` (short random string, generated once
  per webview load) included in every diagnostic log, so multi-instance traces are
  separable.
- **Root boot log.** When the adapter resolves, `postLog` a `lifecycle` event with
  `instanceId`, `mode` (real/mock), the **raw** `getRunningContext()` value, the
  normalized `runningContext`, and the routed `mode` (overlay/panel). Also log the
  `init()`-catch fallback path if it fires.
- **Panel (`App`) lifecycle.** Log `panel-mounted` on mount; inside `startOverlay`, log
  three checkpoints: `start-overlay:begin`, `start-overlay:context-started` (immediately
  after `await startCameraOverlay()`), and `start-overlay:posted` (immediately after the
  first `postOverlay()`). These reveal whether the sender survives `runRenderingContext`.
- **Camera (`OverlayApp`) lifecycle.** Log `overlay-mounted` on mount and
  `overlay-message` on **each** `onMessage` receipt — the receive signal we have never
  observed.
- All diagnostic logs go through the existing `postLog` → `/api/log` sink under a
  consistent shape (`{ kind: 'lifecycle', event, instanceId, ... }`) so they're greppable
  alongside the existing `zoom-overlay` logs.

## Non-goals

- **No data-channel fix.** This story does not change the sender, the bridge, add a server
  relay, or alter `runRenderingContext`/draw logic. It only observes. The fix is a
  separate story chosen from this run's data.
- **No change** to `buildOverlayState` / the privacy payload, the draw path, or rendering.
- **No removal** of the existing `zoom-overlay` instrumentation.
- **No heavy fake-based component tests.** Per our own testing critique, fake-driven UI
  tests add little confidence here; the deliverable is a live trace. Keep automated tests
  minimal (see Test notes).

## Privacy

Diagnostic logs carry only `instanceId`, running-context strings, lifecycle event names,
and (for `overlay-message`) at most the **shape**/keys or a boolean "received" — **never**
participant names, rates, or the private config. No new private data leaves the panel.

## Acceptance criteria

1. **Stable per-load id.** A new `client/src/lib/instanceId.js` exports a single
   `instanceId` string, generated once at module load and constant for that webview
   instance. (Unit-tested for stability + format.)
2. **Boot trace.** `Root` emits one `lifecycle`/`boot` log per load with `instanceId`,
   `mode`, raw context, normalized `runningContext`, and routed `mode`; and a
   `lifecycle`/`init-error` log on the init-catch fallback.
3. **Sender-survival trace.** `App` emits `panel-mounted`, and `startOverlay` emits
   `start-overlay:begin` / `:context-started` / `:posted` in order, each with `instanceId`.
4. **Receive trace.** `OverlayApp` emits `overlay-mounted` on mount and `overlay-message`
   on every `onMessage` receipt, each with `instanceId`.
5. **Observe-only.** No change to draw/send/render/route behaviour; existing tests pass
   unchanged; the every-`postMessage`-send logging is retained.
6. **Gate green.** `npm test && npm run build` passes.

## Test notes

- **AC1** — unit test `instanceId`: importing it twice yields the same value; it matches a
  short alphanumeric format. (Pure module; node-testable.)
- **AC2–AC4** — these are component-lifecycle logs in `Root`/`App`/`OverlayApp`. Per the
  testing critique, we do **not** add jsdom/fake-render tests for them; correctness is
  verified by the live trace (the whole point of the story). Where a pure helper is
  extracted (e.g. a `logLifecycle(event, extra)` wrapper), unit-test that it shapes the
  payload and routes to the injected sink.
- **AC5/AC6** — full suite + build stay green; no existing test changes expected.

## Open questions

1. **`overlay-message` volume.** If the camera does receive ~1 msg/sec, logging every
   receipt floods `/api/log`. Proposed: log every receipt **for this debugging round**
   (we expect few/none), and add throttling later if it proves noisy. OK?
2. **Permanence.** Keep these `lifecycle` logs as the start of permanent boundary
   observability (Option 2), or treat them as throwaway to strip after diagnosis?
   *Proposed: keep — they're the first slice of the observability we said we want.*

## Build note (2026-06-07)

AC → file map:

- **AC1** (instanceId + logLifecycle) — `client/src/lib/instanceId.js`, `client/src/lib/lifecycleLog.js` (+ `lifecycleLog.test.js`)
- **AC2** (boot/init-error trace) — `client/src/Root.jsx`; raw context surfaced from `client/src/zoom/zoomAdapter.js` (`RealZoom.init` return)
- **AC3** (panel-mounted + startOverlay checkpoints) — `client/src/App.jsx`
- **AC4** (overlay-mounted + overlay-message) — `client/src/components/OverlayApp.jsx`
- **AC5** (observe-only) — no behaviour change across the above
- **AC6** (gate) — `client/src/lib/lifecycleLog.test.js` + build
