Date: 2026-06-04 · Branch: claude/ws-cleanup-railway · Status: approved

> Approved by Thomas 2026-06-04: "1 yes you assume correctly; 2 explicit
> railway.json please; 3 yes railway is the intended host." Open questions
> resolved: Railway build sets VITE_USE_ZOOM=1 (real Zoom SDK); ship explicit
> railway.json (not zero-config); ZOOM_REDIRECT_URI host is the Railway app URL.

# WebSocket cleanup + Railway deploy readiness

> Supersedes the earlier untracked draft `reviews/railway-deploy.md` (never
> implemented); its Railway content is folded into Part B below and that stale
> file is removed as part of this story.

## Problem
Two cleanups, bundled because they both touch the server and its config:

**A. Dead WebSocket.** The camera-overlay rework (merged) moved the display to
Zoom's `postMessage`/`onMessage` bridge. The shared-state WebSocket is no longer
used by anything: `client/src/sync/syncClient.js` and `client/src/lib/sharedState.js`
are orphaned (no imports), and the server still opens a `/ws` WebSocket backed by
`server/src/rooms.js`. Carrying dead networking code is confusing and ships an
unused `ws` dependency. (Tracked in `reviews/backlog.md`.)

**B. Not Railway-ready.** We want to deploy on **Railway via GitHub** (push to
`main` → Railway builds & runs). Today the server start command is
`node --env-file=.env src/index.js`, which **crashes if `.env` is missing** — and
on Railway there is no committed `.env` (config is injected as env vars). There is
also no Railway build/start/healthcheck config and no documentation of the env
vars Railway must supply. `PORT` handling already falls back correctly
(`API_PORT || PORT || 8787`) and `listen(PORT)` binds all interfaces.

## In scope
**Part A — remove the WebSocket**
- Delete `client/src/sync/syncClient.js`, `client/src/lib/sharedState.js`,
  `server/src/rooms.js`.
- Strip the WebSocket from `server/src/index.js` (no `ws` import, no
  `WebSocketServer`, no join/publish handler); remove the `ws` dependency from
  `server/package.json`.
- In `server/src/app.js`: drop the `roomStats` import + its use in `/api/health`
  (health becomes `{ ok: true, zoomConfigured }`), and remove the `/ws`
  special-case from the SPA `*` fallback.
- Remove the `/ws` proxy from `client/vite.config.js`.

**Part B — Railway deploy readiness**
- Make the committed `.env` optional: dev/start scripts use
  `--env-file-if-exists=.env` so production boots with config purely from injected
  env vars.
- Add `railway.json` declaring build (`npm run build`), start (`npm start`), and
  `healthcheckPath` `/api/health`.
- Declare a Node `engines` floor (>= 22) so Railway's builder picks a runtime that
  supports `--env-file-if-exists`.
- Extract port resolution into a tested `resolvePort(env)` helper.
- Document the required Railway config in `README.md` + `server/.env.example`
  (runtime: `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_REDIRECT_URI`;
  build-time: `VITE_USE_ZOOM`; `PORT` auto-provided). No secrets committed.
- Remove the superseded `reviews/railway-deploy.md` draft.

## Non-goals
- CSP origin hardening — `connect-src ... wss:` becomes vestigial after the WS
  removal but tightening CSP stays in its own backlog item; left untouched here.
- Creating the Railway project / connecting GitHub / entering secrets / updating
  the Zoom Marketplace redirect URL — dashboard actions Thomas performs. This
  story only makes the repo deploy-ready and documents them.
- Dockerfile / non-Nixpacks build paths; any CI beyond Railway's own GitHub build.
- App behavior / display changes (the overlay is done).

## Acceptance criteria
1. **Server WS removed.** No `WebSocketServer`/`/ws` in `server/src/index.js`,
   `server/src/rooms.js` deleted, and `ws` removed from `server/package.json`
   dependencies. The server still boots and serves `/`, `/api/*`, `/auth/*`.
2. **Client WS removed.** `client/src/sync/syncClient.js` and
   `client/src/lib/sharedState.js` deleted; the `/ws` proxy removed from
   `client/vite.config.js`. A repo grep finds no remaining import/reference to
   `syncClient`, `sharedState`/`buildSharedState`, `rooms`, or `WebSocketServer`
   (code, not stale comments).
3. **Health decoupled from rooms.** `server/src/app.js` no longer imports
   `roomStats`; `GET /api/health` returns `200` with `{ ok: true }` (plus
   `zoomConfigured`) and no rooms field; the SPA `*` fallback no longer references
   `/ws`.
4. **Boots without `.env`.** Dev/start scripts use `--env-file-if-exists=.env`
   (no bare `--env-file=.env`). With no `.env` present the server starts and
   `GET /api/health` returns `200 { ok: true }`. With a local `.env` it is still
   loaded.
5. **Port resolution tested.** A `resolvePort(env)` helper returns `API_PORT`
   when set, else `PORT`, else `8787`; unit-tested for all three. `index.js` uses
   it and logs the chosen port.
6. **Railway config.** `railway.json` exists, is valid JSON, and declares build
   `npm run build`, start `npm start`, and `healthcheckPath` `/api/health`.
   `package.json` declares `engines.node >= 22`.
7. **Docs + no secrets.** `README.md` has a "Deploy to Railway" section listing
   required env vars and noting `PORT` is auto-provided; `server/.env.example`
   matches; `reviews/railway-deploy.md` removed. `git grep` shows no committed
   secret values.
8. **Gate green.** `npm test && npm run build` passes.

## Test notes
- AC1/AC2: `git grep` for the symbols above returns only comments (or nothing);
  `npm run build` + server tests pass with the files gone.
- AC3: extend `server/test/headers.test.js` (or a new test) — `GET /api/health`
  returns 200 and `body.ok === true`, no `rooms` key.
- AC4: a server test starts `createApp()` on port 0 with no `.env` and asserts
  health 200 `{ok:true}` (createApp reads no env, so this is the no-env path).
  Plus a manual check: `PORT=8790 npm --workspace server start` with `.env`
  temporarily moved, then `curl :8790/api/health`.
- AC5: unit test `resolvePort({API_PORT:'9'})→9`, `resolvePort({PORT:'8'})→8`,
  `resolvePort({})→8787`.
- AC6: a node:test parses `railway.json` and asserts the build/start/healthcheck
  fields; assert `engines.node` present in `package.json`.
- AC7: inspect README + `.env.example`; `git grep -iE 'secret|client_secret'`
  shows only placeholders/keys, no values.
- AC8: run the gate.
- **Manual (Thomas):** connect the repo on Railway with the documented env vars →
  successful build and a running app serving `/api/health`.

## Open questions (resolved)
1. **Deployed build mode** — RESOLVED: Railway build sets `VITE_USE_ZOOM=1` (real
   Zoom SDK; deployment runs inside Zoom).
2. **`railway.json` vs zero-config** — RESOLVED: ship the explicit `railway.json`.
3. **Redirect host** — RESOLVED: `ZOOM_REDIRECT_URI` host is the Railway app URL
   (`https://<app>.up.railway.app/auth/callback`), mirrored in the Zoom Marketplace.
