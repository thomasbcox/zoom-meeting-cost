Date: 2026-06-03 · Branch: claude/zoom-owasp-headers · Status: approved

> Thomas (2026-06-03): "add error visibility, header regression test, confirm we
> ignore dev-state.md, defer CSP hardening and track in backlog"

## Problem

The app rendered correctly in a normal browser but showed a **blank white screen
inside the Zoom client**. Root cause: the Zoom client validates every HTML
response (MIME `text/html`, status 200) for OWASP secure headers and **refuses to
render the app if any are missing** — emitting a `Missing OWASP Secure Headers`
error in the Zoom client console. The Express server (`server/src/index.js`) sent
none of the required headers, so Zoom blocked rendering.

Ref: https://developers.zoom.us/docs/zoom-apps/security/owasp/

A fix is already applied in the working tree (an emergency change made to unblock
in-Zoom testing). This story documents it, brings it onto a review branch, and
also addresses a stray local file (`dev-state.md`) that should not be tracked.

## In scope

1. Send the four Zoom-required OWASP secure headers on responses served by the
   Node/Express server: `Strict-Transport-Security`, `X-Content-Type-Options`,
   `Referrer-Policy`, and `Content-Security-Policy`.
2. A `Content-Security-Policy` that permits everything the app legitimately needs
   and nothing more than necessary for it to run inside Zoom: own bundle/styles,
   the WebSocket + API, images/fonts, and embedding by the Zoom client.
3. Ignore `dev-state.md` (local dev/tunnel scratch notes) via `.gitignore`
   (ignore-only — keep the local file, do not track it).
4. **In-Zoom error visibility:** a global `window.onerror` +
   `unhandledrejection` capture and a React error boundary that report to the
   existing `/api/log` sink and show a minimal on-screen message — so a future
   in-Zoom failure self-reports instead of showing a silent white screen.
5. **Header regression test:** an automated test asserting the four headers are
   present on the Home URL response, wired into the gate (`npm test`).

## Non-goals

- Tightening the CSP to a hard allow-list of exact origins (e.g. pinning
  `connect-src`/`frame-ancestors` to the current tunnel host). **Deferred and
  recorded in `reviews/backlog.md`** (per Thomas's decision).
- Productionizing OAuth, the tunnel workflow, or Marketplace config.
- A full client-side telemetry/observability system — the error capture here is
  the minimum needed to make in-Zoom failures visible, nothing broader.

## Acceptance criteria

1. A request to the server's Home URL (`GET /`) returns `200`, `Content-Type:
   text/html`, and all four headers present: `Strict-Transport-Security`,
   `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and
   `Content-Security-Policy`.
2. The same four headers are present on static asset responses
   (`GET /assets/<bundle>.js`), and the JS bundle still serves with
   `Content-Type: application/javascript` (not blocked / not mis-typed).
3. The CSP value allows: `script-src 'self'` (the Vite bundle + bundled
   `@zoom/appssdk` chunk), inline styles (`style-src 'self' 'unsafe-inline'`),
   the WebSocket and API (`connect-src` includes `wss:`/`https:`/`'self'`),
   `img-src`/`font-src 'self' data:`, and Zoom embedding (`frame-ancestors`
   includes `*.zoom.us`). No app resource is CSP-blocked when the production
   build loads.
4. The app renders (no blank screen) when opened inside the Zoom client — the
   real-world acceptance check, performed manually by Thomas.
5. `dev-state.md` is listed in `.gitignore` and does not appear in
   `git status` (ignore-only; the local file is kept, never tracked).
6. **Error visibility — global handlers.** When the app throws an uncaught error
   or an unhandled promise rejection, a handler POSTs a structured payload to
   `/api/log` (reusing the existing sink). The handler never itself throws and is
   a no-op-safe if the network is unavailable.
7. **Error visibility — error boundary.** A React error boundary wraps the app;
   when a child render throws, it (a) reports to `/api/log` and (b) renders a
   minimal visible fallback message instead of a blank screen.
8. **Header regression test.** An automated test asserts the four required
   headers are present on `GET /`, and it runs as part of `npm test` (the gate).
9. **CSP hardening backlog.** `reviews/backlog.md` exists and contains a tracked
   entry for the deferred CSP origin-pinning work.
10. The gate passes: `npm test && npm run build`.

## Test notes

- AC1/AC2/AC3: `curl -s -D - -o /dev/null http://localhost:8787/` and
  `.../assets/<bundle>.js`, grep for the four headers + content-type; inspect the
  CSP string for the required directives.
- AC4: Thomas closes & reopens the app in Zoom and confirms it renders. If still
  blank, the Zoom client console will name the offending header/resource.
- AC5: `grep dev-state.md .gitignore`; `git status --short` shows nothing for it.
- AC6: unit test — invoke the global handler with a fake error and assert it
  calls the log sink; assert it swallows a throwing sink.
- AC7: unit test (vitest + RTL or shallow) — render a child that throws inside
  the boundary; assert the fallback text renders and the reporter was called.
- AC8: the header test runs under `npm test` and fails if any of the four
  headers is removed.
- AC9: `reviews/backlog.md` contains the CSP entry.
- AC10: run `npm test && npm run build`.

## Open questions

(None outstanding — Thomas's 2026-06-03 decision resolved all four prior
questions: error visibility IN, header test IN, dev-state.md ignore-only, CSP
hardening deferred to backlog.)

## Build note (2026-06-03)

### AC → file map
- AC1–3 (OWASP headers + CSP): `server/src/app.js` (`securityHeaders`, `CSP`,
  `createApp`), `server/src/index.js` (slimmed to use `createApp`).
- AC4 (renders in Zoom): manual — Thomas.
- AC5 (ignore `dev-state.md`): `.gitignore`.
- AC6 (global error reporter): `client/src/lib/reportError.js`,
  `client/src/lib/postLog.js`, wired in `client/src/main.jsx`.
- AC7 (error boundary): `client/src/components/ErrorBoundary.jsx`, wired in
  `client/src/main.jsx`; styles in `client/src/styles.css`.
- AC8 (header regression test): `server/test/headers.test.js`,
  `server/package.json` (`test` script), root `package.json` (run both suites).
- AC9 (CSP backlog): `reviews/backlog.md`.
- Shared refactor: `client/src/zoom/zoomDiagnostics.js` now imports/re-exports
  `postLog` from `client/src/lib/postLog.js`.

### git diff --stat main...HEAD
```
 .gitignore                                  |   3 +
 client/src/components/ErrorBoundary.jsx     |  42 ++++++++++++
 client/src/components/ErrorBoundary.test.js |  37 ++++++++++
 client/src/lib/postLog.js                   |  15 +++++
 client/src/lib/reportError.js               |  61 +++++++++++++++++
 client/src/lib/reportError.test.js          |  72 ++++++++++++++++++
 client/src/main.jsx                         |  10 ++-
 client/src/styles.css                       |  25 +++++++
 client/src/zoom/zoomDiagnostics.js          |  17 ++---
 package.json                                |   2 +-
 reviews/backlog.md                          |  20 ++++++
 reviews/zoom-owasp-headers.md               | (this file)
 server/package.json                         |   3 +-
 server/src/app.js                           |  92 +++++++++++++++++++++++++
 server/src/index.js                         |  49 ++------------
 server/test/headers.test.js                 |  63 ++++++++++++++++++
```
