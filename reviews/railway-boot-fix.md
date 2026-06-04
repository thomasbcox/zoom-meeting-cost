Date: 2026-06-04 · Branch: claude/railway-boot-fix · Status: merged

> Approved by Thomas 2026-06-04: "railway just deployed successfully although I'm
> having other problems - go ahead with .nvmrc." Q1 → use `.nvmrc` (22). Q2 moot:
> a deploy is now live; this change hardens it against the Node-version regression
> (the "other problems" are separate and not addressed here).

# Fix Railway deploy boot crash (Node version / env-file flag)

## Problem
The deployed app at `https://zoom-meeting-cost-production.up.railway.app`
returns Railway's edge fallback — `HTTP 404`, `server: railway-hikari`,
`x-railway-fallback: true`, `{"message":"Application not found"}`. That means
**no app process is running** behind the domain. Zoom fetches the Home URL, hits
that bare Railway 404 (which carries none of our OWASP headers), and reports the
required headers as missing. The header middleware in `server/src/app.js` is
correct and verified by `server/test/headers.test.js`; the app simply isn't up.

**Root cause:** the start command is `node --env-file-if-exists=.env src/index.js`.
The `--env-file-if-exists` flag only exists on **Node ≥ 20.12 / ≥ 22**. We declare
`engines.node >=22`, but Nixpacks does not reliably honor `engines`; if it builds
with an older Node, `node` exits immediately with `bad option:
--env-file-if-exists`, the process never listens, the healthcheck fails, and
Railway serves the fallback.

## In scope
1. **Pin the runtime.** Add a repo-root `.nvmrc` containing `22` so Nixpacks (and
   local `nvm` users) select Node 22, the runtime `engines.node >=22` already
   declares.
2. **Remove reliance on the CLI flag.** Load `.env` programmatically via a guarded
   side-effect module (`server/src/loadEnv.js`) imported **first** in
   `server/src/index.js`, using `process.loadEnvFile?.('.env')` inside try/catch.
   This loads `.env` for local dev when present, and is a harmless no-op when the
   file is missing (Railway injects config as env vars) or when `process.loadEnvFile`
   doesn't exist (older Node) — so the server can never crash on boot over this.
3. **Simplify scripts.** `server/package.json` `dev`/`start` drop
   `--env-file-if-exists=.env` and run plain `node` (dev keeps inline `API_PORT`).
4. Keep `engines.node >=22` (root + server) unchanged.

## Non-goals
- The OWASP header code — correct and unchanged.
- `railway.json` build/start/healthcheck shape — unchanged (start is still
  `npm start`; only what `npm start` runs underneath changes).
- Creating/connecting the Railway project, entering secrets, setting env vars, or
  the Zoom Marketplace redirect — Thomas's dashboard actions.
- Adding a `dotenv` dependency — not needed; `process.loadEnvFile` covers it.
- CSP hardening (separate backlog item).

## Acceptance criteria
1. **`.nvmrc` pins Node 22.** A repo-root `.nvmrc` exists and contains `22`.
2. **Guarded env loading.** `server/src/loadEnv.js` calls
   `process.loadEnvFile?.('.env')` inside a try/catch that swallows a missing-file
   error; it is imported as the first import in `server/src/index.js` (before
   `app.js` / `zoom/oauth.js`, which read `process.env` at module-eval time).
3. **Scripts use plain `node`.** Neither `dev` nor `start` in
   `server/package.json` contains `--env-file` / `--env-file-if-exists`; `start`
   is `node src/index.js`, `dev` is `API_PORT=8787 node --watch src/index.js`.
4. **Boots without `.env`.** With no `.env` present, the server starts and
   `GET /api/health` returns `200 { ok: true }` (the Railway case).
5. **Loads `.env` when present.** When a `.env` exists in the server workspace
   with e.g. `API_PORT`, the value is read (proves `.env` is still honored for
   local dev). Verified by a `loadEnv` unit test that writes a temp env file,
   calls the loader, and asserts the var lands in `process.env`.
6. **Gate green.** `npm test && npm run build` passes.
7. **(Manual, Thomas)** After redeploy, `curl -sI https://<app>.up.railway.app/`
   returns `200` with the four OWASP headers, and Zoom's Home URL check passes.

## Test notes
- AC1: assert the file exists and its trimmed contents === `22`.
- AC2/AC3: read `server/package.json` — no `--env-file` substring; `start` ===
  `node src/index.js`. Read `server/src/index.js` — first import is `./loadEnv.js`.
- AC4: existing/extended health test — `createApp()` on port 0, no `.env`, health
  200 `{ok:true}` (already covered by `server/test/health.test.js`). Plus manual:
  move `.env` aside, `PORT=8796 node src/index.js`, `curl :8796/api/health`.
- AC5: `server/test/loadEnv.test.js` — write a temp file with a unique key, call
  the loader pointed at it (or via cwd), assert `process.env[key]` is set; and a
  missing-path call does not throw.
- AC6: run the gate.
- AC7: Thomas redeploys on Railway (Node 22 via `.nvmrc`) and re-checks.

## Open questions (resolved)
1. **`.nvmrc` vs other pin** — RESOLVED: use `.nvmrc` (`22`) in the repo.
2. **Different failure mode** — MOOT: a deploy is now live, so this is a
   regression-hardening change rather than the active fix. Thomas's remaining
   "other problems" are separate and out of scope here.

## Build note (2026-06-04)

AC → implementing files:
1. `.nvmrc` pins Node 22 → `.nvmrc`
2. Guarded env loading → `server/src/loadEnv.js` (`loadLocalEnv`), imported first in `server/src/index.js`
3. Scripts use plain `node` → `server/package.json` (dev/start)
4. Boots without `.env` → covered by `server/test/health.test.js` + manual `node src/index.js` (no .env) check
5. Loads `.env` when present → `server/test/loadEnv.test.js`
6. Gate → `npm test && npm run build`
7. Manual (Thomas) → redeploy on Railway, re-check headers / Zoom Home URL

Tests added: `server/test/loadEnv.test.js` (present-file load + missing-file no-throw).

`git diff --stat main...HEAD`:
 .nvmrc                      |  1 +
 reviews/railway-boot-fix.md | 85 +++++++++++++++++++++++++++++++++++++++++++++
 server/package.json         |  4 +--
 server/src/index.js         |  3 ++
 server/src/loadEnv.js       | 25 +++++++++++++
 server/test/loadEnv.test.js | 30 ++++++++++++++++
 6 files changed, 146 insertions(+), 2 deletions(-)

## Codex review (2026-06-04, base main, HEAD ab421b3)

**Summary:** The branch implements the Node 22 pin, removes the CLI env-file flag, imports the env loader first, and adds loadEnv tests. One issue: the loader suppresses more failures than the spec calls for. (Codex could not run the gate in its read-only sandbox — EPERM on fs/socket writes; gate was run green outside Codex: 55 client + 10 server tests, build OK.)

### IMPORTANT
1. **Env loader suppresses non-missing .env failures** — `server/src/loadEnv.js:19`. The catch treats every `process.loadEnvFile` exception as a harmless missing `.env`; an unreadable/bad `.env` (or other load failure) would silently boot with local env vars absent, making a config problem look like ordinary unconfigured state. *Suggestion:* return false when `process.loadEnvFile` is unavailable, ignore only the missing-file (ENOENT) error, and rethrow other failures.

_No BLOCKER, QUESTION, or NIT findings._

## Decisions (2026-06-04)

- **IMPORTANT #1 (env loader swallows non-missing errors, loadEnv.js):** Thomas — **Fix**. Ignore only ENOENT, rethrow other load errors, return false when `process.loadEnvFile` is unavailable; add a test that a real failure surfaces. Applied in /close.

## Fixes (2026-06-04)

- **IMPORTANT #1:** `server/src/loadEnv.js` — `loadLocalEnv` now returns false
  when `process.loadEnvFile` is unavailable (older Node), ignores only the
  missing-file `ENOENT` case, and rethrows any other load failure (unreadable /
  malformed `.env`) so a real config problem surfaces instead of booting silently
  without local config. Added `server/test/loadEnv.test.js` case asserting a
  non-ENOENT failure (directory path → EISDIR) propagates.
