Date: 2026-06-04 · Branch: claude/realmode-p1-fixes · Status: merged

> Approved by Thomas (2026-06-04): "yes use your defaults" — both open-question defaults accepted (log `req.path`; no connect retry/backoff).

## Problem

An advisor review surfaced two P1 issues that only bite in the real-Zoom path
(both invisible to the current test suite, which exercises only `MockZoom`):

1. **OAuth authorization codes are logged.** The request-logging middleware in
   `server/src/app.js` logs `req.url`, so the Zoom OAuth redirect
   `/auth/callback?code=<authorization code>` prints the single-use code to the
   server log before `oauth.js` exchanges it. The code is short-lived and can't
   be redeemed without our client secret, but writing any credential material to
   logs is wrong and trivially avoidable.

2. **The side-panel ↔ camera state bridge is missing `connect()`.** The overlay
   feature pushes live cost from the side-panel instance to the camera-rendering
   instance via `postMessage`/`onMessage`. The bundled `@zoom/appssdk` docs are
   explicit that these are "App Instances Communication" APIs: `postMessage`
   fails with error `10041` ("app instances aren't connected") unless the
   instances first call `zoomSdk.connect()`, and the SDK's own `config` example
   lists `connect`/`onConnect` alongside `postMessage`/`onMessage`. Today
   `ZOOM_CAPABILITIES` requests `postMessage`/`onMessage` but **not**
   `connect`/`onConnect`, and `RealZoom` never calls `sdk.connect()` — so in real
   Zoom the overlay would silently never receive state. Additionally
   `RealZoom.postMessage()` calls `this._sdk.postMessage(payload)` without
   returning or catching the promise, so an SDK rejection becomes an unhandled
   rejection.

The remaining three review findings are deferred to the backlog (see AC5).

## In scope

- **OAuth log redaction** (Finding 1): stop the request logger from emitting
  OAuth (and any other) query strings, so authorization codes never reach the
  log.
- **Connect the app instances** (Finding 2):
  - Add `connect` and `onConnect` to `ZOOM_CAPABILITIES`, and update the
    mirrored capability list in `server/zoom-app-config.md`.
  - Have `RealZoom` establish the app-instance connection: call `sdk.connect()`,
    register `onConnect`, and only `postMessage` over a live connection
    (replaying the latest state once connected) so the first/early pushes aren't
    dropped with `10041`.
  - Make `RealZoom.postMessage()` swallow/handle SDK promise rejections (no
    unhandled rejection).
- Backlog the other three findings (AC5).

## Non-goals

- No change to `MockZoom`'s behaviour or the adapter interface contract
  (`postMessage`/`onMessage`/`startCameraOverlay`/…) — the public shape stays
  identical so `App.jsx`/`Root.jsx` are untouched.
- No fix for the deferred findings (drawWebView `webviewId` shape, silent `$0`
  meeting on participant-fetch failure, hardcoded `Thomas Cox` identity) — those
  only get backlog entries here.
- No attempt to fully verify the real Zoom messaging round-trip from the test
  suite (it requires running inside the Zoom client). Tests cover the adapter
  logic against a fake SDK stub.

## Acceptance criteria

1. The server request logger no longer emits query strings: a request to
   `/auth/callback?code=SECRET123` produces a log line containing the path
   `/auth/callback` and **not** `SECRET123` (nor `code=`).
2. `ZOOM_CAPABILITIES` in `client/src/zoom/zoomAdapter.js` includes `connect`
   and `onConnect`, and the capability list in `server/zoom-app-config.md` is
   updated to match (the doc states the two must match).
3. `RealZoom` calls `sdk.connect()` during `init()` and registers an `onConnect`
   handler; given a fake SDK, `connect()` is invoked and the connection state is
   tracked.
4. `RealZoom.postMessage()` does not send over a not-yet-connected channel and
   does not produce an unhandled rejection: messages sent before `onConnect`
   fires are held and the latest is replayed once connected; a rejected
   `sdk.postMessage` is caught.
5. The three deferred findings are appended to `reviews/backlog.md` (drawWebView
   `webviewId` real-Zoom risk; silent `$0` meeting on `getMeetingParticipants`
   failure; hardcoded presenter identity / `self` ignored by `Root`).

## Test notes

- **AC1:** Server test (vitest + supertest, like `server/test/headers.test.js`)
  that spies `console.log`, issues `GET /auth/callback?code=SECRET123`, and
  asserts the captured log line includes `/auth/callback` and excludes
  `SECRET123`/`code=`.
- **AC2:** Client unit assertion that `ZOOM_CAPABILITIES` contains `connect` and
  `onConnect` (extends the existing capabilities test). Doc change verified by
  inspection.
- **AC3/AC4:** Client unit test (vitest) constructing `RealZoom` with a fake SDK
  stub exposing `config`, `getRunningContext`, `getUserContext`,
  `getMeetingParticipants`, `connect`, and `onConnect`. Assert: `connect()` is
  called during `init()`; a `postMessage` issued before the stub fires
  `onConnect` is not sent through, then is delivered (latest value) after
  `onConnect`; and a stub whose `postMessage` rejects does not throw/reject out
  of `RealZoom.postMessage`.
- Full gate: `npm test && npm run build`.

## Open questions

1. **Log redaction approach.** Simplest is to log `req.path` (drops *all* query
   strings, not just `/auth/*`). That also removes potentially-useful non-secret
   query params from `/api` debug logs. Default proposed: **log `req.path`**
   (least code, zero leak surface). Alternative: redact query only for `/auth/*`
   and keep it elsewhere. OK with the `req.path` default?
2. **Connect sequencing.** Calling `connect()` in `init()` runs it in both the
   panel and camera instances (both mount the adapter). If a peer instance isn't
   up yet `connect()` may reject (`10039`); the design treats that as non-fatal
   and relies on `onConnect` + latest-state replay. Acceptable for the prototype,
   or do you want explicit retry/backoff? (Default: no retry — keep minimal.)

## Build note (2026-06-04)

AC → file map:
- **AC1** (OAuth log redaction): `server/src/app.js` (logger → `req.path`);
  test `server/test/requestLog.test.js`.
- **AC2** (capabilities): `client/src/zoom/zoomAdapter.js` (`ZOOM_CAPABILITIES`
  += `connect`/`onConnect`); `server/zoom-app-config.md` (mirrored list);
  test assertion in `client/src/zoom/zoomAdapter.test.js`.
- **AC3/AC4** (connect lifecycle + safe postMessage): `client/src/zoom/zoomAdapter.js`
  (`RealZoom` connect/onConnect, held-payload replay, `_send` rejection-swallow,
  `RealZoom` exported); tests in `client/src/zoom/zoomAdapter.test.js`.
- **AC5** (backlog): `reviews/backlog.md`.

```
 client/src/zoom/zoomAdapter.js      |  50 ++++++++++++++++-
 client/src/zoom/zoomAdapter.test.js |  80 +++++++++++++++++++++++++-
 reviews/backlog.md                  |  41 ++++++++++++++
 reviews/realmode-p1-fixes.md        | 109 ++++++++++++++++++++++++++++++++++++
 server/src/app.js                   |   5 +-
 server/test/requestLog.test.js      |  44 +++++++++++++++
 server/zoom-app-config.md           |   3 +
 7 files changed, 327 insertions(+), 5 deletions(-)
```

## Codex review (2026-06-04, base main, HEAD f7316ba)

**Summary:** Reviewed `git diff main...HEAD`, `git log --oneline main..HEAD`, and `reviews/realmode-p1-fixes.md`. The logging redaction, capability doc updates, tests, and backlog entries align with the spec, but the new RealZoom connection handling has one blocker. Targeted tests were attempted but blocked by sandbox permissions: Vitest could not write Vite temp files, and the server test could not bind a listener.

### BLOCKER
1. **Failed onConnect events mark the bridge connected** — `client/src/zoom/zoomAdapter.js:183`
   - **Claim:** The new `onConnect` handler unconditionally sets `_connected = true` and flushes `_pendingMsg`. The installed Zoom SDK's `OnConnectEvent` carries `action: 'success' | 'failure'`, so a failure event is treated as a live channel; the pending snapshot is sent over a not-connected bridge and cleared, violating AC4's requirement to only post over a live connection and replay once connected.
   - **Suggestion:** Accept the event argument and only set `_connected`/flush when the event reports success. On failure, keep `_connected` false and retain the latest pending payload; add a fake-SDK test that fires a failure event before a success event.

## Decisions (2026-06-04)

- **BLOCKER 1 (failed onConnect marks bridge connected):** FIX — Thomas: "fix".
  Gate `onConnect` on `action === 'success'`; keep `_connected` false and retain
  `_pendingMsg` on failure; add a fake-SDK test firing failure before success.

## Fixes (2026-06-04)

- **BLOCKER 1 — failed onConnect no longer marks the bridge connected**
  (`client/src/zoom/zoomAdapter.js`): the `onConnect` handler now inspects the
  event and returns early unless `action === 'success'`. On a `'failure'` event
  the bridge stays `_connected = false` and retains `_pendingMsg`, so the held
  snapshot is replayed only on a later success. The fake SDK now fires the real
  `{ timestamp, action }` event shape (default `'success'`), and a new test
  asserts a `'failure'` event posts nothing and keeps the payload, then a
  `'success'` flushes it.

## Codex review (2026-06-04, base f7316ba, HEAD 00a11d2)

**Re-review — no findings.**

**Summary:** Reviewed `git diff f7316ba...HEAD`, `git log --oneline f7316ba..HEAD`, and `reviews/realmode-p1-fixes.md`. The new fix resolves the prior blocker: `onConnect` now returns unless `evt.action === 'success'`, so failure events no longer mark the bridge connected or flush `_pendingMsg`, and the added fake-SDK test covers failure followed by success. I found no new issues in the changed range. Targeted Vitest verification was attempted but blocked by the read-only sandbox (`EPERM` writing Vite temp config).
