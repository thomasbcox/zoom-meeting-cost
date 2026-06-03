Date: 2026-06-03 · Branch: claude/zoom-first-light · Status: approved

> Approved by Thomas (2026-06-03): "A please and yes I approve - proceed." Q1 loadable-in-Zoom: done. Q2 trigger: `?diag=1` URL flag. Q3: fold pre-existing changes into a distinct setup commit (Option A).

## Problem

The `RealZoom` adapter ([client/src/zoom/zoomAdapter.js](../client/src/zoom/zoomAdapter.js)) was written from the Zoom Apps SDK docs and has never been executed inside the real Zoom client. Every SDK call is wrapped in a `try/catch` that **degrades quietly** — so when it runs inside Zoom we cannot tell whether `sdk.config()` succeeded, whether `getMeetingParticipants()` was permitted, or what the real participant data shape is. We are flying blind on the single most uncertain part of the app.

This story is a **recon/diagnostic spike**: get the app to emit raw, per-call Zoom SDK output (results *and* errors) to the existing `/api/log` server sink, so a single in-Zoom run gives us the ground-truth needed to correct the adapter. It intentionally does **not** fix the adapter or touch cost logic — it produces the data that the next story will act on.

## In scope

1. A diagnostics probe (`client/src/zoom/zoomDiagnostics.js`) that, given an SDK object, calls each relevant method in sequence and records a structured per-call result `{ method, ok, result | error }` **without ever throwing**, even if a call rejects or is missing. Methods probed: `config`, `getRunningContext`, `getMeetingContext`, `getUserContext`, `getMeetingParticipants`.
2. A tiny client log helper that POSTs a JSON payload to `/api/log` (the endpoint already exists at [server/src/index.js:30](../server/src/index.js#L30)) and also `console.log`s it locally; failure to reach the server must not throw.
3. A trigger that runs the probe **inside Zoom only**, leaving normal mock dev untouched: run when `VITE_USE_ZOOM === '1'` **and** a diagnostics flag is set (proposed: `?diag=1` in the URL — flip-able via the Marketplace Home URL without a rebuild).
4. Unit tests (Vitest) for the probe collector using a fake SDK: proves it captures successes, captures rejections/throws as `{ ok: false, error }`, handles a missing method, and never throws.

## Non-goals

- Fixing `RealZoom`'s participant field mapping or any adapter behaviour (that is the **next** story, driven by this output).
- Any change to the cost engine, matching, sharedState, or sync.
- Deriving `roomId` from the real meeting UUID (separate rung).
- Marketplace registration, OAuth install, or HTTPS-tunnel setup (prerequisite infra, tracked separately — see Open question 1).
- Making `getMeetingParticipants()` actually succeed — we are *observing* it, not repairing it.

## Acceptance criteria

1. A `runZoomDiagnostics(sdk, { log })` function exists that probes the five methods above in order and returns/emits an array of `{ method, ok, result?, error? }` entries, one per method, in call order.
2. The probe never throws: a method that rejects, throws synchronously, or is absent on the SDK yields `{ ok: false, error: <message/string> }` and the probe continues to the remaining methods.
3. A `postLog(payload)` helper POSTs `payload` as JSON to `/api/log`; a network/fetch failure is caught and does not propagate.
4. The probe is wired to run on app start **only** when `VITE_USE_ZOOM === '1'` and the `diag` trigger is present; in default (mock) mode the app behaviour is byte-for-byte unchanged and the probe does not run.
5. The diagnostic bundle sent to `/api/log` includes all five per-call entries plus a top-level marker (e.g. `{ kind: 'zoom-diagnostics', entries: [...] }`) so it is greppable in server logs.
6. `npm test && npm run build` passes.

## Test notes

- **AC1, AC2:** Vitest unit test in `client/src/zoom/zoomDiagnostics.test.js` with a fake SDK whose methods variously resolve, reject, throw, or are undefined; assert the shape and ordering of the returned entries and that no call throws. Inject a fake `log` to assert the bundle is emitted.
- **AC3:** Unit test injecting a fake `fetch` that resolves and one that rejects; assert no throw in either case and that the rejecting case is swallowed.
- **AC4:** Unit test (or inspection) confirming the trigger guard: with the flag absent the probe is not invoked. Mock-mode behaviour unchanged is confirmed by the existing suite still passing.
- **AC5, AC6:** `npm test && npm run build` green.
- **Manual (cannot be gated — this is the whole point):** build with `VITE_USE_ZOOM=1`, serve over the HTTPS tunnel, open the app inside a real Zoom meeting with the `diag` trigger, and confirm a `zoom-diagnostics` bundle appears in the server console showing real `getRunningContext` / `getMeetingContext` / participant output. This manual step is what feeds the next story.

## Open questions

1. **Are we actually loadable in Zoom yet?** This story makes the *code* ready to emit diagnostics, but executing the manual step requires the Marketplace app's Home URL to point at the live tunnel and the OAuth install to have completed at least once. Is that already set up (`dev-state.md` shows a Cloudflare tunnel; `.env` is populated), or is standing that up a blocking prerequisite we should do first?
2. **Trigger mechanism:** I propose `?diag=1` on the URL (flip-able via the Marketplace Home URL without a rebuild). Acceptable, or do you prefer a build-time `VITE_ZOOM_DIAG=1` env flag, or simply "always run diagnostics whenever `VITE_USE_ZOOM=1`" for this spike?
3. **Pre-existing uncommitted changes:** the working tree had unrelated modifications (the `@zoom/appssdk` dependency, vitest wiring, server logging) before this branch. Leave them as-is and out of this story's commits, or fold them into a setup commit first?

## Build note (2026-06-03)

AC → file map:
- AC1 (ordered per-call entries) — `runZoomDiagnostics` in client/src/zoom/zoomDiagnostics.js
- AC2 (never throws on reject/throw/missing/null sdk) — `runZoomDiagnostics`
- AC3 (safe `/api/log` POST) — `postLog` in client/src/zoom/zoomDiagnostics.js
- AC4 (in-Zoom-only trigger; mock dev unchanged) — `shouldRunDiagnostics` + `maybeRunZoomDiagnostics`, wired in client/src/main.jsx (App.jsx untouched)
- AC5 (greppable `zoom-diagnostics` bundle) — `runZoomDiagnostics`
- AC6 (gate green) — client/src/zoom/zoomDiagnostics.test.js (+ existing suite); `npm test && npm run build`

git diff --stat main...HEAD:
 .claude/workflow.json                   |    6 +
 AGENTS.md                               |   25 +
 client/index.html                       |   48 ++
 client/package.json                     |    7 +-
 client/src/lib/cost.test.js             |   77 ++
 client/src/lib/matching.test.js         |  111 +++
 client/src/lib/normalize.test.js        |   33 +
 client/src/main.jsx                     |    5 +
 client/src/zoom/zoomAdapter.js          |    3 +-
 client/src/zoom/zoomDiagnostics.js      |  131 ++++
 client/src/zoom/zoomDiagnostics.test.js |  157 ++++
 package-lock.json                       | 1283 +++++++++++++++++++++++++++++--
 package.json                            |    3 +-
 reviews/zoom-first-light.md             |   47 ++
 server/package.json                     |    4 +-
 server/src/index.js                     |   18 +-
 16 files changed, 1900 insertions(+), 58 deletions(-)

## Codex review (2026-06-03, base main, HEAD e32105e)

**Summary:** Core diagnostics probe matches the requested shape, but the branch also carries unconditional client telemetry (in client/index.html, via the baseline setup commit) that violates the mock-mode/no-touch criterion (AC4). Note: Codex could not run the gate itself (read-only sandbox blocks Vite/Vitest temp-file writes) — the gate `npm test && npm run build` was verified GREEN locally before this review.

### BLOCKER
- **Unconditional telemetry changes mock-mode behavior** — client/index.html:7. An inline `<script>` runs on every page load regardless of `VITE_USE_ZOOM`/`?diag=1`: it installs global `window.onerror`/`onunhandledrejection`, monkey-patches `console.log/warn/error` to POST all output to `/api/log`, and immediately posts "telemetry initialized". Observable behavior in default mock mode → violates AC4. (Also creates a feedback loop with zoomDiagnostics' console.log → /api/log path.)
  - *Suggestion:* Remove the global HTML telemetry hook (or gate it behind the same Zoom diagnostics trigger); keep diagnostic logging inside zoomDiagnostics.js without global console monkey-patching.

## Decisions (2026-06-03)

- **BLOCKER — Unconditional telemetry in client/index.html:** Thomas: "fix it and re-review." → FIXED by removing the inline telemetry `<script>` from client/index.html. Diagnostic logging is fully covered by the gated zoomDiagnostics.js + server /api/log endpoint; removal also eliminates the console.log → /api/log feedback loop.

## Codex re-review (2026-06-03, base e32105e, HEAD c7e0d29)

**Summary:** Re-review of the delta since last review. The unconditional telemetry hook (prior BLOCKER) is removed and the prior disposition recorded. **No findings.** ✅

(Gate `npm test && npm run build` verified GREEN locally.)
