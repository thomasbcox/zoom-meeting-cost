# real-zoom-smoke-gate

Date: 2026-06-05 · Branch: claude/real-zoom-smoke-gate · Status: approved

> **Approved (2026-06-05, Thomas):** "approved". Open questions resolved:
> (1) detect a Zoom-like environment via the **`navigator.userAgent` token**
> (`ZoomApps`/`ZoomWebKit`), kept as a pure function of the UA string; the SDK
> `getRunningContext()` check is a secondary positive signal once the SDK loads.
> (2) the Real-vs-Mock mode badge lives in the **panel header / `RoleBar`** near
> the existing `PROTOTYPE` tag.

## Problem

A live Zoom run showed the presenter's private side panel but attendees saw **no
camera overlay**. The screenshot showed mock-only UI (the `Simulate Zoom
join/leave` row and the simulated camera preview) — i.e. the Zoom session loaded
a **mock build**. In mock mode `MockZoom.startCameraOverlay()` only records fake
calls (`zoomAdapter.js:97`) and cannot render to the attendee video feed, so the
app looks successful to the presenter while doing nothing attendee-facing.

The root cause is silent fallback. `getZoomAdapter()` (`zoomAdapter.js:293`) uses
`MockZoom` whenever `VITE_USE_ZOOM !== '1'` **or** the `@zoom/appssdk` import
throws — and the only signal is a `console.warn` no one sees inside the Zoom
client. There is also no visible Real-vs-Mock indicator, and `RealZoom`'s
camera-overlay SDK calls (`runRenderingContext`, `drawWebView`, `connect`,
`postMessage`) are fire-and-forget with errors swallowed, so a failed real run
leaves no server-side evidence to diagnose.

## In scope

- A pure, testable detector for a **Zoom-like environment** (we are running
  embedded in the Zoom client) — see Open questions for the signal.
- Reshape adapter selection so that **in a Zoom-like environment** we never
  silently use `MockZoom`: instead of an adapter, the boot path gets a
  `blocked` result carrying a reason when (a) `VITE_USE_ZOOM !== '1'` or (b) the
  SDK import fails. Outside a Zoom-like environment, behavior is unchanged
  (mock dev still works; non-Zoom import failure still degrades to mock).
- A **blocking error screen** ("Real Zoom SDK not loaded") rendered by `Root`
  in place of `App`/presenter controls when the boot result is `blocked`.
- A **visible runtime mode indicator** — `Real Zoom mode` vs
  `Mock prototype mode` — shown in the panel UI.
- **`/api/log` instrumentation** in `RealZoom` for `runRenderingContext`,
  `drawWebView`, `connect`, and the **first** `postMessage`, each emitting a
  success or failure payload (without changing the existing graceful-degrade
  behavior — instrumentation observes, it does not throw).

## Non-goals

- Changing `MockZoom`'s prototype behavior in ordinary local dev (no Zoom-like
  env, `VITE_USE_ZOOM` unset): it looks and behaves exactly as today.
- The `drawWebView` / `webviewId` correctness question (backlog #4). Story AC6
  makes resolving it **conditional** on the smoke test still failing *after* the
  mock-build risk is removed; it is deferred to a separate item unless the live
  test proves it's the next blocker.
- Running the live two-person smoke test itself (AC5) — that is a manual Zoom
  run by Thomas + a second attendee, not something this branch can automate. The
  branch's job is to make that test *possible to pass and trustworthy*.
- Any server change beyond what `/api/log` already accepts (it already logs
  arbitrary JSON bodies — `app.js:70`).

## Acceptance criteria

1. **Never silently mock inside Zoom.** A pure detector reports whether we are in
   a Zoom-like environment. When it is true, the boot path never returns a
   `MockZoom` adapter — it returns a `blocked` result instead. Unit-tested.
2. **Blocking error, not presenter controls.** When in a Zoom-like environment
   and either `VITE_USE_ZOOM !== '1'` or the `@zoom/appssdk` import fails, `Root`
   renders a blocking "Real Zoom SDK not loaded" error screen instead of `App`.
   The reason (mock-build vs import-failure) is distinguishable in the result.
3. **Visible mode indicator.** The panel UI shows a runtime badge reading
   `Real Zoom mode` (real adapter) or `Mock prototype mode` (mock adapter),
   driven by the adapter actually in use (`adapter.isMock`).
4. **`/api/log` instrumentation.** `RealZoom` emits a `/api/log` entry for each
   of `runRenderingContext`, `drawWebView`, `connect`, and the **first**
   `postMessage`, with a payload indicating success or failure (method name +
   ok flag + error string on failure). Instrumentation must never change the
   method's outcome (no new throws; failures still swallowed as today).
   Unit-tested against a fake SDK with an injected log sink.
5. **(Manual) Live smoke test.** After this branch is merged/deployed in real
   mode, Thomas runs a live Zoom meeting: presenter clicks "Show cost on video";
   a second attendee confirms the meter appears on the presenter's video tile.
   Tracked here as a manual acceptance step, not automated.
6. **(Conditional follow-up)** If — and only if — the AC5 smoke test still fails
   *after* mock-build risk is eliminated, open a follow-up to resolve the
   `drawWebView` / `webviewId` uncertainty (backlog #4), using the AC4 logs as
   evidence. Not built in this branch.

## Test notes

- **AC1** — unit-test the env detector (pure, `userAgent`-style input injected;
  node-env, same style as `lib/*.test.js`): Zoom token present → `true`;
  ordinary browser UA / undefined → `false`. Unit-test the reshaped selection
  helper with injected env + import outcome: Zoom-like + not-wanted → blocked
  (reason mock-build); Zoom-like + import throws → blocked (reason import-fail);
  Zoom-like + import ok → real adapter; not Zoom-like + unset → mock; not
  Zoom-like + import throws → mock (unchanged degrade).
- **AC2 / AC3** — `Root`/`App` use hooks and aren't render-tested in this
  node-env harness (same constraint noted in `presenter-honesty.md`). Verified by
  reading the gated render branch (blocked → error screen) and the badge wired to
  `adapter.isMock`, plus the helper coverage from AC1. The blocking-vs-degrade
  decision logic lives in the AC1-tested helper, not in JSX.
- **AC4** — extend `zoomAdapter.test.js`: drive `RealZoom` with a fake SDK + an
  injected log sink. Assert a log entry per instrumented method on success;
  assert a failure entry (ok=false + error) when the SDK method rejects; assert
  `postMessage` logs only once (first send). Assert the method's existing
  behavior (return/throw) is unchanged.
- Gate: `npm test && npm run build` green.

## Open questions

_Both resolved at approval (see header):_
1. _Zoom-env detection: `navigator.userAgent` token (`ZoomApps`/`ZoomWebKit`), a
   pure function of the UA string._
2. _Mode badge: panel header / `RoleBar`, near the `PROTOTYPE` tag._

## Build note (2026-06-05)

AC → file map (AC1–4 built; AC5 manual, AC6 deferred/conditional):
- **AC1** (never silently mock inside Zoom): `client/src/zoom/zoomEnv.js`
  (`isZoomLikeEnvironment` UA detector + pure `decideAdapter` table) +
  `zoomEnv.test.js`; `getZoomAdapter()` reshaped in `client/src/zoom/zoomAdapter.js`
  to return a result object `{ adapter, mode } | { blocked, reason }`.
- **AC2** (blocking error): `client/src/components/SdkBlockedError.jsx` +
  `client/src/Root.jsx` (renders it when `boot.blocked`). Reason is `mock-build`
  vs `import-fail`.
- **AC3** (mode badge): `client/src/components/RoleBar.jsx` (badge driven by
  `adapter.isMock`; the `PROTOTYPE` tag is now mock-only to avoid contradicting
  `Real Zoom mode`) + `client/src/styles.css`.
- **AC4** (`/api/log` instrumentation): `client/src/zoom/zoomAdapter.js` —
  `RealZoom` takes an injectable `log` sink (defaults to `postLog`) and emits a
  `kind:'zoom-overlay'` entry (`method` + `ok` + `error`) for
  `runRenderingContext`, `drawWebView`, `connect`, and the **first** `postMessage`.
  Outcomes are unchanged (overlay calls still re-throw; connect/postMessage still
  swallowed). Covered by new tests in `zoomAdapter.test.js`.

Small honesty add beyond the literal ACs: the `PROTOTYPE` tag is hidden in real
mode (it would contradict the new `Real Zoom mode` badge).

Gate: `npm test && npm run build` green (client 81, server+secret-scan pass,
build OK — the `@zoom/appssdk` dynamic-import chunk confirms real-mode builds
resolve the SDK).

`git diff --stat main...HEAD` (excl. story file):
```
 client/src/Root.jsx                       |  17 ++++-
 client/src/components/RoleBar.jsx         |   8 ++-
 client/src/components/SdkBlockedError.jsx |  34 +++++++++
 client/src/styles.css                     |  36 ++++++++++
 client/src/zoom/zoomAdapter.js            | 116 ++++++++++++++++++++++-----
 client/src/zoom/zoomAdapter.test.js       |  96 +++++++++++++++++++++
 client/src/zoom/zoomEnv.js                |  48 ++++++++++++
 client/src/zoom/zoomEnv.test.js           |  51 +++++++++++++
```

## Codex review (2026-06-05, base main, HEAD f9ed1ec)

**Summary:** Reviewed `git diff main...HEAD`, `git log --oneline main..HEAD`, and
`reviews/real-zoom-smoke-gate.md`; the branch matches AC1–AC4 in the spec, with
AC5 manual and AC6 deferred as specified. No issues found in the diff.

**Findings:** _none_ (empty findings array).

## Fixes (2026-06-05)

None required — clean Codex review (0 findings). No code changed in the close
round; gate re-run green (`npm test && npm run build`). Header stays `approved`.
