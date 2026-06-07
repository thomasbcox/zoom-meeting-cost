# overlay-logging-quiet

Date: 2026-06-07 · Branch: claude/overlay-logging-quiet · Status: approved

> **Approved (2026-06-07, Thomas):** "approve. please implement." Open questions take
> the proposed defaults: (1) no debug-verbose flag infra; (2) `overlay-message` logs on
> `status` change only.

## Problem

The overlay now works end to end (PR #17, verified live). But the debugging
instrumentation we added along the way writes to `/api/log` **~3 times per second,
forever, while the overlay is on** — `overlay-message` + `overlay-message-raw` (camera,
each ~1/sec) and the `postMessage` success log (panel, ~1/sec). That was deliberate
"log every send / every receipt while we debug," and both diagnostics stories
(`camera-overlay-diagnostics`, `overlay-payload-parse`) explicitly deferred a
**"throttle once confirmed"** decision. It's confirmed. The steady-state firehose is
now pure cost/noise on every live meeting.

Goal: keep the observability **useful** but **quiet** — steady state is silent; the
events worth keeping (first-of-kind, state changes, anomalies, failures) still log. This
turns the debug scaffolding into the permanent, sane boundary observability we said we
wanted (Option 2), rather than ripping it out.

## In scope

- **`postMessage` send logging (`zoomAdapter.js`).** Log the **first** successful send
  (proves the bridge is live) and **every failure**; drop the per-tick success spam.
  (Re-introduces a one-shot "first send logged" guard; reverts the debug-era "log every
  send.")
- **`overlay-message` (camera receive, `OverlayApp.jsx`).** Log the **first** receipt and
  thereafter only when the snapshot's `status` **changes** (e.g. running→paused→running);
  drop the per-tick steady spam. (Status transitions are a genuinely useful signal we
  otherwise don't log.)
- **`overlay-message-raw` (receive boundary, `zoomAdapter.js`).** Make it **anomaly-only**:
  emit only when the normalized payload is **not a usable object** (the SDK shape changed
  and our parse no longer yields the snapshot). Silent in the happy path; a permanent
  canary for the exact bug class we just fixed. (It already did its diagnostic job
  confirming `payloadType: "string"`.)
- Update the affected unit test(s).

## Non-goals

- **No change to the one-shot / low-volume logs** — `boot`, `init-error`, `panel-mounted`,
  `start-overlay:*`, `overlay-mounted`, `drawParticipant`/`drawWebView`, `runRenderingContext`.
  They fire once per session/instance/show and are kept as-is.
- **No new debug-flag / env infrastructure** (see Open questions).
- **No change** to the data path, draw path, routing, `buildOverlayState`, the privacy
  payload, or `normalizeIncomingMessage`.
- No change to the `_instrument` (`zoom-overlay` ok/fail) contract for draw/render calls.

## Acceptance criteria

1. **First-send-only for postMessage.** `RealZoom.postMessage` logs a `postMessage`
   `ok:true` **only on the first successful send** per adapter instance; subsequent
   successful sends log nothing; **every** send failure still logs `ok:false`. Still
   never throws / never surfaces an unhandled rejection.
2. **overlay-message: first + on status-change.** `OverlayApp` logs `overlay-message` on
   the first received snapshot and only when `status` differs from the previous snapshot's
   status thereafter — not on every tick. (A `type: 'object'` field is retained on the
   entries it does emit.)
3. **overlay-message-raw: anomaly-only.** The receive-boundary `overlay-message-raw` log
   is emitted **only when** the normalized payload is not a non-null object (shape
   anomaly); in the normal case (string→parsed object, or object) it is silent.
4. **Steady state is quiet.** With the overlay running and `status` unchanged, a one-second
   window produces **no** `overlay-message`, `overlay-message-raw`, or `postMessage`
   `/api/log` writes (after the first send + first receipt). One-shot logs are unaffected.
5. **Containment + gate.** Diff touches only `client/src/zoom/zoomAdapter.js`,
   `client/src/components/OverlayApp.jsx`, `client/src/zoom/zoomAdapter.test.js`, and
   `reviews/overlay-logging-quiet.md`. `npm test && npm run build` passes.

## Test notes

- **AC1** — replace `zoomAdapter.test.js`'s "logs EVERY postMessage send" with: two
  successful sends → exactly **one** `postMessage` `ok:true` log; a rejecting fake still
  logs `ok:false` (keep the existing failure-log + no-throw tests).
- **AC2** — `OverlayApp`'s `overlay-message` is component-level (no jsdom here); covered by
  the live trace, not a unit test (consistent with the diagnostics stories). If the
  status-change comparison is extracted into a tiny pure helper, unit-test that helper
  (first → log; same status → no log; changed status → log).
- **AC3** — extend the receive-path test: firing a normal `{ payload: JSON.stringify(snap) }`
  emits **no** `overlay-message-raw`; firing a malformed payload (e.g. `{ payload: 42 }`
  or a non-JSON string) **does** emit one. (Drive via the fake's injected log sink.)
- **AC4** — covered by AC1–AC3 in aggregate; confirmed on the next live run (the log should
  show first-send + first-receipt + draws, then go quiet until a pause/resume).
- **AC5** — `git diff --name-only main...HEAD` shows only the files AC5 enumerates; gate green.

## Open questions

1. **Keep a debug-verbose escape hatch?** Should full per-tick logging be re-enableable
   behind a flag (env or `localStorage`) for future live debugging? *Proposed: no* — the
   first/on-change/anomaly trail plus a one-off debug build if ever needed is enough;
   adding flag infra now is YAGNI. Revisit only if a future live bug needs the firehose.
2. **`overlay-message` on-change key.** Log on `status` change only (proposed), or also on
   other transitions (e.g. attendee-count change)? *Proposed: status only* — it's the
   meaningful lifecycle signal; cost/elapsed change every tick by nature and would re-flood.

## Build note (2026-06-07)

AC → file map:

- **AC1** (postMessage first-success-only) — `client/src/zoom/zoomAdapter.js` (ctor `_firstPostLogged`, `postMessage`)
- **AC2** (overlay-message first + on status-change) — `client/src/components/OverlayApp.jsx`
- **AC3** (overlay-message-raw anomaly-only) — `client/src/zoom/zoomAdapter.js` (`init` onMessage; routed through `this._log`)
- **AC4** (steady state quiet) — emergent from AC1–AC3
- **AC5** (containment + gate) — `client/src/zoom/zoomAdapter.test.js` (first-only + anomaly tests)

## Codex review (2026-06-07, base main, HEAD 7e04c37)

**Summary:** Diff is contained to the spec'd files; AC1/AC2 aligned. One IMPORTANT: the
AC3 anomaly guard has a false-negative path for object-shaped breakages. (Codex couldn't
run the gate in its read-only sandbox; ours is green: 107 tests + build.)

### IMPORTANT

1. **Object-shaped payload breakages bypass the raw anomaly canary** — `zoomAdapter.js`.
   The guard logs only when the normalized payload is falsy or `typeof !== 'object'`, so
   a JSON array (`[]`) or a wrong envelope (`{ timestamp, data }`) — not a usable overlay
   snapshot — would **not** emit `overlay-message-raw`. False negatives on real
   object-shaped shape-breaks, defeating the canary's purpose.
   *Suggestion:* use a stricter snapshot predicate (non-null, non-array, plain object with
   the expected `status` key); add tests for a JSON array and a `payload`-less/keyless
   object while keeping normal JSON-string and snapshot-object payloads silent.
