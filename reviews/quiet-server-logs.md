# quiet-server-logs

Date: 2026-06-08 · Branch: claude/quiet-server-logs · Status: approved

> **Approved (2026-06-08, Thomas):** "approve." `init-error` stays at info (default).

## Problem

After the in-Zoom overlay was verified, the Railway logs are noisy and *look*
alarming — but the noise is almost entirely **server-side presentation**, not the
client diagnostics (those were already throttled by `overlay-logging-quiet`).

In `server/src/app.js`:
1. **`/api/log` logs everything via `console.error`** (line 71) — so benign client
   diagnostics (`kind: 'lifecycle'` / `'zoom-overlay'` / `'zoom-diagnostics'`)
   appear as `[err]` in Railway, indistinguishable from real errors.
2. **It pretty-prints** (`JSON.stringify(body, null, 2)`) — each event sprawls ~10
   lines, so one overlay-start burst becomes a screenful.
3. **The request logger logs every request** (line 61) — including the periodic
   `/api/health` check (forever), every `/assets/*` file, `/favicon.ico`, and every
   `/api/log` POST. That is most of the `[inf]` volume.

Genuine client errors are cleanly tagged `kind: 'client-error'` (both
`reportClientError` and `ErrorBoundary`), so error-vs-diagnostic is trivially
separable.

## In scope

`server/src/app.js` only (plus server tests):

- **`/api/log` log level by kind.** Route the entry by payload `kind`:
  `client-error` → `console.error` (a real error; stays `[err]`); every other kind
  → `console.log` (info; `[inf]`). So diagnostics stop masquerading as errors and
  real errors stand out.
- **`/api/log` compact output.** Emit a single-line `JSON.stringify(body)` (drop the
  `null, 2` pretty-print).
- **Request logger skip-list.** Do not log routine traffic: `/api/health`,
  `/api/log`, `/favicon.ico`, and `/assets/*`. Keep logging everything else —
  `/auth/*` (path only — preserves the OAuth-code-leak regression guard),
  other `/api/*`, and SPA navigations (`/`).

## Non-goals

- **No change to the client diagnostics.** The one-shot `lifecycle` / `zoom-overlay`
  events (boot, panel-mounted, start-overlay:\*, overlay-mounted, draw calls) stay —
  they are bounded and useful; this story only changes how the *server* presents
  what it receives.
- **No change to error reporting** payloads or the `/api/log` contract (still 204,
  still accepts the same body).
- **No debug-flag / env infrastructure** (consistent with `overlay-logging-quiet`).
- No change to security headers, OAuth, health response, or static serving.

## Acceptance criteria

1. **Diagnostics log at info, errors at error.** A POST to `/api/log` with a
   non-`client-error` kind (e.g. `kind: 'lifecycle'`) is written via `console.log`,
   not `console.error`; a POST with `kind: 'client-error'` is written via
   `console.error`. Endpoint still responds `204`.
2. **Compact single-line output.** The `/api/log` log line is single-line JSON (no
   embedded newlines / indentation from pretty-printing).
3. **Request logger skips routine traffic.** `GET /api/health`, `POST /api/log`,
   `GET /favicon.ico`, and `GET /assets/<anything>` produce **no** `[server] …` log
   line; a request to `/auth/callback?code=…` still logs exactly one line with the
   **path only** (no `code` / query) — the existing leak guard; other paths (e.g.
   `/`, `/api/*`) still log.
4. **Containment + gate.** Only `server/src/app.js` and `server/test/*` change;
   `npm test && npm run build` passes.

## Test notes

- **AC1/AC2** — `server/test`: stub `console.log` / `console.error`, POST a
  `lifecycle` payload → captured on `console.log`, and the captured string has no
  newline (single line); POST a `client-error` payload → captured on
  `console.error`. Assert `204` both times.
- **AC3** — extend `server/test/requestLog.test.js`: assert no `[server]` line for
  `GET /api/health` and `GET /assets/x.js`; keep the existing assertion that
  `/auth/callback?code=…` logs the path without the code.
- **AC4** — run `git diff --name-only main...HEAD` and verify no files appear beyond
  `server/src/app.js`, `server/test/*`, and this story file.

## Open questions

1. **`init-error` level.** The adapter-init-failure diagnostic is `kind: 'lifecycle'`
   (event `init-error`) — a graceful degradation, not a crash. This spec keeps it at
   **info** (only `client-error` goes to stderr). If you'd rather a failed init also
   show as `[err]`, say so and I'll route `event: 'init-error'` (or add it to the
   error set) to `console.error`.

## Build note (2026-06-08)

AC → file map:
- **AC1–2** (`/api/log` level-by-kind + compact): `server/src/app.js` (+ `server/test/clientLog.test.js`)
- **AC3** (request-logger skip-list `isRoutineRequest`): `server/src/app.js` (+ `server/test/requestLog.test.js`)
- **AC4** (containment): only `server/src/app.js` + `server/test/*` + this story file.
