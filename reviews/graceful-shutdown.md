Date: 2026-06-21 · Branch: claude/graceful-shutdown · Status: approved

Approved 2026-06-21 by Thomas ("approve"): graceful SIGTERM/SIGINT shutdown (server.close →
exit 0, ~10s force-exit fallback, one log line); backlog the deeper hardening (server
process-level crash guards + in-Zoom client-error hardening).

## Problem
Railway sends a flood of "crash" notifications, but the server isn't actually crashing.
The Railway logs show a single container running ~2 days straight (serving real meetings),
then stopping with `npm error signal SIGTERM` at the exact moment the next deploy replaced
it. `server/src/index.js` installs no `SIGTERM`/`SIGINT` handler, so on a redeploy Node is
terminated by the signal and exits non-zero (143); npm surfaces that as an error and Railway
reports a "crash." Every merge to `main` (= a redeploy) produces one. It's cosmetic, but
noisy and alarming, and it also cuts off in-flight requests.

The fix is **graceful shutdown**: handle the signal, stop accepting connections, exit 0.

Two deeper, separate concerns surfaced in the same log are **out of scope here and
backlogged** (per Thomas — "backlog the hardening"):
- Server has no process-level crash guard (`unhandledRejection`/`uncaughtException`) or
  global Express error handler.
- Real client-side errors inside Zoom, reported via `/api/log` (SDK-config race before
  `runRenderingContext`; "Video is not sending." when the camera is off; a
  `postMessage`/`getVideoState` "object does not support…" failure).

## In scope
1. **Graceful shutdown in `server/src/index.js`:** on `SIGTERM` and `SIGINT`, log a brief
   line, call `server.close()` to stop accepting new connections and let in-flight requests
   finish, then `process.exit(0)`. Include a **force-exit timeout fallback** (default ~10s)
   so a hung `close()` still exits 0 rather than hanging until Railway force-kills. The
   handler is registered once and is safe to call once (guard against double-invocation).
2. **Backlog two items in `reviews/backlog.md`:**
   - *Server process-level crash guards* — `process.on('unhandledRejection')` +
     `uncaughtException` (log + controlled exit) and a global Express error-handling
     middleware.
   - *In-Zoom client-error hardening* — reduce the unhandled rejections in the camera-overlay
     flow (await `zoomSdk.config` before other SDK calls; handle camera-off /
     video-not-sending; guard the `postMessage`/`getVideoState` path).

## Non-goals
- No change to request handlers, routes, `createApp`, or any business logic.
- No process-level crash guards in this story (backlogged).
- No client-side / in-Zoom fixes in this story (backlogged).
- No `railway.json` change — the restart policy stays; graceful shutdown is the fix.

## Acceptance criteria
1. On `SIGTERM` (and `SIGINT`), the running server shuts down and the process **exits 0** —
   verified by a subprocess test that boots `server/src/index.js`, waits for it to listen,
   sends `SIGTERM`, and asserts exit code 0 within a short timeout.
2. Shutdown calls `server.close()` (stops accepting connections) and has a force-exit
   fallback so a hung close still exits 0; the handler does not double-run.
3. Existing boot behavior is preserved: the `EADDRINUSE` `server.on('error')` path and the
   startup logging are unchanged; `createApp` and the routes are untouched.
4. `reviews/backlog.md` contains the two new backlog items (server process-level crash
   guards; in-Zoom client-error hardening).
5. Scope containment: the diff touches only `server/src/index.js`, the new shutdown test,
   `reviews/backlog.md`, and this story file.
6. Gate green (`npm test && npm run build`).

## Test notes
- AC1/AC2: new `server/test/shutdown.test.js` spawns `node src/index.js` (with a test
  `PORT`/`API_PORT` and otherwise-empty env — the app boots fine unconfigured), waits for the
  `server on …` line, `child.kill('SIGTERM')`, and asserts `code === 0` within ~3s. A second
  assertion (or the same) covers `SIGINT`.
- AC3: read `index.js`; confirm the EADDRINUSE handler and startup logs are intact, and that
  `app.js`/routes are unchanged in the diff.
- AC4: confirm the two items exist in `reviews/backlog.md`.
- AC5: `git diff --name-only main...HEAD` shows nothing beyond the files this AC enumerates.
- AC6: run the gate.

## Open questions
1. **Force-exit timeout.** Default **10s** (well under Railway's stop grace period, so we
   exit cleanly before a force-kill). OK, or prefer a different value?
2. **Shutdown log line.** Default: log one line (e.g. `received SIGTERM, shutting down`) for
   observability. OK, or stay silent?

## Build note (2026-06-21)
AC → file map:
- AC1/AC2 graceful shutdown + force-exit + double-run guard → `server/src/index.js`; subprocess test → `server/test/shutdown.test.js`
- AC3 boot behavior preserved (EADDRINUSE, logs) → `server/src/index.js`
- AC4 backlog (process-level crash guards; in-Zoom client-error hardening) → `reviews/backlog.md`
- AC5/AC6 scope + gate

## Codex review (2026-06-21, base main, HEAD 7ce422c)
**Summary:** The shutdown implementation is scoped and matches the spec. One acceptance-test
gap: the test can pass without proving the signal path ran.

### IMPORTANT
1. **Shutdown test can false-pass without sending a signal** — `server/test/shutdown.test.js`.
   `bootThenSignal` resolves with the child exit code regardless of whether the `server on`
   log was seen or `child.kill(signal)` was called. A child that exits 0 before listening
   would pass both tests without verifying boot → listen → signal → exit 0. Fix: track that
   the listen log was seen, reject in the exit handler if `signalled` is false, and check the
   `child.kill()` return value.

Last-reviewed SHA: 7ce422c

## Decisions (2026-06-21)
Thomas: "fix then /close."
- **IMPORTANT 1** (shutdown test can false-pass) — **FIX**: require the `server on` log was
  seen and `child.kill(signal)` succeeded; reject in the exit handler if the signal was never
  sent, so a boot regression fails the test instead of slipping through.

## Fixes (2026-06-21)
- **IMPORTANT 1:** `server/test/shutdown.test.js` now fails a false-pass — it rejects if
  `child.kill(signal)` doesn't deliver, and rejects in the `exit` handler when `signalled`
  is false (server exited before listening/being signalled). A boot regression that exits 0
  early now fails the test instead of slipping through.
