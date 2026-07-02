Date: 2026-07-02 · Branch: claude/build-env-stamp · Status: approved

## Problem

There is no way to tell, at a glance, **which environment** (dev vs prod) or **which
git commit** a running instance of the app is. Both Railway environments deploy the
same repo, so dev and prod look identical, and the recent dev↔prod credential-crossing
bug was hard to reason about partly because nothing in the app or its logs states which
build is live. We want a standard, self-evident stamp of `env + commit` in the places a
person would actually look: in a browser (an endpoint), inside the Zoom panel (a badge),
and in the server logs (the boot line). Because the Zoom webview aggressively caches the
client bundle, the badge must report the version **actually loaded** (baked at build),
so it can diverge from — and thereby expose — a stale cached bundle vs the live server.

## In scope

- **(A) `/api/version` endpoint** — public JSON `{ env, commit, startedAt }`, from
  `RAILWAY_ENVIRONMENT_NAME` + `RAILWAY_GIT_COMMIT_SHA` at runtime (safe fallbacks when
  unset). Sits beside `/api/health`; no identity gate (non-sensitive build metadata).
- **(C) Build-time baked constants** — Vite `define` bakes `__APP_ENV__`,
  `__APP_COMMIT__`, `__APP_BUILT_AT__` into the client bundle from the Railway *build*
  env, surfaced via a small `buildInfo` module (with fallbacks for local/unbuilt).
- **(B) Panel badge** — a color-coded build badge in the side panel (`RoleBar`), beside
  the existing mode badge, showing `env · <short commit>` from `buildInfo` (the loaded
  bundle's own version). Presenter-private panel only.
- **(D) Boot-log stamp** — add `env` + `commit` (from `buildInfo`) to the existing
  lifecycle `boot` event, so every session's Railway log line records the build.

## Non-goals

- No change to `/api/health`'s shape (the Railway healthcheck contract stays stable);
  version data lives in its own endpoint.
- No env/version indicator on the **camera overlay** — the stamp is presenter-private
  (panel + server only), never shown to meeting participants.
- No new dependency; no CI change — rely on Railway's build-injected
  `RAILWAY_GIT_COMMIT_SHA` (local builds simply show a `dev`/`local` fallback).
- The response-header (E) and document-title (F) surfaces discussed are out.

## Acceptance criteria

1. **(A)** `GET /api/version` returns `200` with JSON `{ env, commit, startedAt }`.
   With `RAILWAY_ENVIRONMENT_NAME` / `RAILWAY_GIT_COMMIT_SHA` set, it echoes them; unset,
   it returns safe fallbacks (`env:'local'`, `commit:'unknown'`). No auth required.
2. **(C)** A `buildInfo` client module exposes `{ env, commit, builtAt }` from the baked
   `__APP_*__` constants, with a defined fallback when the constants are absent (unbuilt
   / test context), plus a `shortCommit` (first 7 chars). Vite `define` is wired to bake
   them at build from the Railway build env.
3. **(B)** The side panel renders a build badge (`env · <shortCommit>`) beside the mode
   badge, with an env-derived CSS class (dev visually distinct from prod). It reads
   `buildInfo` (the loaded bundle's version), not a runtime fetch.
4. **(D)** The lifecycle `boot` event payload includes `env` and `commit` fields from
   `buildInfo`, so the server's `[client-log] … "event":"boot"` line records the build.
5. Scope containment: `git diff --name-only main...HEAD` shows no files beyond
   `client/vite.config.js`, `client/src/lib/buildInfo.js`, the new badge component,
   `client/src/components/RoleBar.jsx`, `client/src/Root.jsx`, `client/src/styles.css`,
   `server/src/app.js`, their tests under `client/src/**` + `server/test/**`, and
   `reviews/build-env-stamp*`.

## Test notes

- **AC1:** `server/test/version.test.js` (mirrors `health.test.js`): start `createApp()`,
  `GET /api/version` → 200; with `RAILWAY_ENVIRONMENT_NAME`/`RAILWAY_GIT_COMMIT_SHA`
  set, assert they're echoed; with them unset, assert the `local`/`unknown` fallbacks.
- **AC2:** `client/src/lib/buildInfo.test.js`: assert `buildInfo` exposes
  `env`/`commit`/`builtAt` and `shortCommit` truncates to ≤7 chars (under vitest the
  baked constants resolve to the fallbacks, which is a valid deterministic case).
- **AC3:** `client/src/components/BuildBadge.test.jsx`: call the hook-free component
  directly (as `CostOverlay.test.js` does), assert it renders `env` + short commit and
  the env-based class; assert the prod-visibility behavior chosen in Open questions.
- **AC4:** covered indirectly — the `buildInfo` fields the boot line stamps are asserted
  in AC2; the `Root.jsx` wiring is verified by the diff and, post-deploy, by the live
  Railway `boot` line carrying `env`/`commit` (Root's async SDK init is integration-level,
  not unit-tested here).
- **AC5 (scope containment):** run `git diff --name-only main...HEAD` and verify no files
  appear beyond those AC5 enumerates.
- Gate: `npm test && npm run build`.

## Open questions

1. **Badge visibility in prod.** Recommend **show, but muted** (dev = amber/accent so it
   stands out; prod = quiet grey) — a user reading "prod · abc1234" to you during support
   is useful, and it's presenter-only so no participant sees it. Alternative: **dev-only**
   (hide entirely in prod). Decide at consult.
2. Commit length: badge shows the **first 7 chars**; `/api/version` returns the **full**
   SHA. (Proposed default, not a blocker.)

## Design sketch — HOW

- **Vite `define`** (`client/vite.config.js`): add
  `define: { __APP_ENV__: JSON.stringify(process.env.RAILWAY_ENVIRONMENT_NAME || 'local'),
  __APP_COMMIT__: JSON.stringify(process.env.RAILWAY_GIT_COMMIT_SHA || 'dev'),
  __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()) }`. Runs in Node at build
  time; Railway injects the git/env vars during the build. vitest inherits this config
  (constants resolve to fallbacks in the test run).
- **`client/src/lib/buildInfo.js`**: read the globals behind `typeof … !== 'undefined'`
  guards so an unbuilt/test context can't `ReferenceError`; export
  `buildInfo = { env, commit, builtAt }` and `shortCommit = commit.slice(0, 7)`. Declare
  the globals for eslint.
- **`client/src/components/BuildBadge.jsx`**: hook-free presentational component (same
  shape as `CostOverlay`) returning a `<span class="build-badge <env>">env · shortCommit</span>`;
  honors the prod-visibility decision.
- **`RoleBar.jsx`**: render `<BuildBadge />` beside the existing mode badge (minimal;
  the badge reads `buildInfo` itself, so no new props threaded).
- **`Root.jsx`**: spread `{ env: buildInfo.env, commit: shortCommit }` into the existing
  `logLifecycle('boot', { … })` call. (D)
- **`server/src/app.js`**: `const STARTED_AT = new Date().toISOString()` at module load;
  `app.get('/api/version', (_req, res) => res.json({ env: process.env.RAILWAY_ENVIRONMENT_NAME || 'local',
  commit: process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown', startedAt: STARTED_AT }))`.
  Public, alongside `/api/health`. (A)
- **`styles.css`**: small `.build-badge` styles (dev accent vs prod muted).
- No new dependency; reuses existing patterns (mode badge, `logLifecycle`, `/api/health`).

## Codex design review (2026-07-02)

**Verdict: shape sound** (Vite `define`, small `buildInfo`, hook-free badge, reused
`logLifecycle`, sibling `/api/version` — all fit the repo, no new deps). Two IMPORTANT,
**two-way** adjustments to make before building:

- **[IMPORTANT · two-way · kludgy] Boot log should log the full SHA, not `shortCommit`.**
  The `commit` observability field must mean the same thing as `/api/version` (full SHA),
  since logs get matched against Railway deploy metadata. _Alternative:_ boot payload uses
  `commit: buildInfo.commit` (full); `shortCommit` stays badge-only (optionally add a
  separate `shortCommit` log field). _Win:_ one meaning for `commit` everywhere; full-SHA
  log searches work.
- **[IMPORTANT · two-way · nonstandard] Don't use the raw env name as a CSS class.**
  Railway reports `production`/`development` (long/arbitrary/mixed-case), so a raw class
  can silently miss styling. _Alternative:_ normalize once —
  `envKind = normalizeEnv(buildInfo.env)` mapping `prod|production→prod`,
  `dev|development→dev`, else `other` — and render `build-badge build-badge-${envKind}`,
  mirroring `RoleBar`'s fixed `mock`/`real` classes. _Win:_ deterministic, testable
  dev/prod distinction decoupled from arbitrary env strings.

**Both accepted into the sketch (see revisions below).** Neither is a one-way door.

### Sketch revisions (folding in both findings)

- **Boot log (D):** use `commit: buildInfo.commit` (full SHA) — plus `env: buildInfo.env`
  (raw). Not the short form.
- **`normalizeEnv`** (in `buildInfo.js`): `prod|production→'prod'`, `dev|development→'dev'`,
  else `'other'`; export as `envKind`. `BuildBadge` renders
  `className={`build-badge build-badge-${envKind}`}` with fixed CSS classes
  `build-badge-prod|-dev|-other`. Badge **text** shows the compact `envKind` label
  (`dev`/`prod`) + `shortCommit`; the full raw env + full SHA live in `/api/version` and
  the boot log.

## Design decisions (2026-07-02)

Thomas approved the full A+B+C+D scope ("let's do all of these including D"). Dispositions:

1. **Boot log full SHA** (Codex #1) — **fix.** Boot payload logs `commit: buildInfo.commit`
   (full); `shortCommit` is badge-only.
2. **Normalize env for CSS class** (Codex #2) — **fix.** `envKind` (`prod`/`dev`/`other`)
   drives fixed classes; raw env + full SHA live in `/api/version` + boot log.
3. **Open question — prod badge visibility:** **show, muted** (dev accent, prod quiet grey;
   presenter-only).

This shape is binding on implementation.

## Build note (2026-07-02)

AC → file map:

- **AC1 (A · /api/version)** — `server/src/app.js` (route + `STARTED_AT`) · test
  `server/test/version.test.js`.
- **AC2 (C · baked constants)** — `client/vite.config.js` (Vite `define`) +
  `client/src/lib/buildInfo.js` (`buildInfo`, `normalizeEnv`, `envKind`, `shortCommit`) ·
  test `client/src/lib/buildInfo.test.js`.
- **AC3 (B · panel badge)** — `client/src/components/BuildBadge.jsx` +
  `client/src/components/RoleBar.jsx` (mount) + `client/src/styles.css` (badge styles) ·
  test `client/src/components/BuildBadge.test.jsx`.
- **AC4 (D · boot-log stamp)** — `client/src/Root.jsx` (`env` + full `commit` in the
  `boot` payload) · fields asserted via `buildInfo.test.js`; live boot line post-deploy.
- **AC5 (scope containment)** — `git diff --name-only main...HEAD`.

## Codex approach review (2026-07-02, base main, HEAD ab90260)

**Verdict: Shape sound — no findings.** Codex's own sketch matched the implementation:
Vite `define` for baked client metadata, a tiny guarded `buildInfo` with normalized env
kind, a hook-free badge mounted only in `RoleBar`, the existing `logLifecycle('boot', …)`
path with raw env + full commit, and a sibling unauthenticated `/api/version`. Stays in
the scoped files, adds no dependency, uses framework-native config over hand-rolled
plumbing, and folds in the prior design guardrails (full-SHA logging, fixed CSS class
vocabulary). No high-leverage approach concerns.

_Empty findings → shape blessed; proceeded to the correctness pass in the same round._
