Date: 2026-06-10 · Branch: claude/railpack-deploy-switch · Status: approved

> Approved by Thomas 2026-06-10: "approve" (as-is). Open-Question defaults stand:
> leave the Node pin as `.nvmrc=22`/`engines>=22`; verify devDeps-for-build on the
> post-merge deploy rather than pre-forcing it.

Two things: (1) switch the Railway builder from **Nixpacks** to **Railpack**, and
(2) record the deferred **esbuild/vite security bump** in the backlog (from the
Dependabot PR #23 closure). Plus a small README deploy-doc touch. Verification of
the builder switch is, by Thomas's call (2026-06-10), the **post-merge live Railway
deploy** (Railway auto-deploys `main`), with a one-field rollback if it fails.

## Problem

**Railway builder.** `railway.json` currently pins `"builder": "NIXPACKS"`. Railpack
is Railway's newer BuildKit-based builder (the Nixpacks successor). Thomas wants the
service to build with Railpack. The build/start/health config is builder-agnostic and
should carry over unchanged:
- `build.buildCommand` = `npm run build` (builds `client/dist` via Vite)
- `deploy.startCommand` = `npm start` (runs the Express server, which serves
  `client/dist` + `/api/health`)
- healthcheck `/api/health`, restart policy unchanged
- Node is pinned via `.nvmrc` (`22`) + `engines.node >=22`; Railpack reads these.

The one real risk is **build-time devDependencies**: `npm run build` needs `vite`
(a devDependency). Nixpacks installs all deps to build, then prunes for runtime — and
the live log shows `npm warn config production`, hinting the platform installs in
production mode. Railpack should behave the same, but a builder swap is exactly where
"`vite: not found`" can surface. This is verified by the deploy succeeding, not by a
local test (the local gate cannot exercise the platform builder).

**Deferred dependency bump (bookkeeping).** Dependabot PR #23 (esbuild dev-server
advisory) was closed 2026-06-10 as malformed (`npm ci` failed; manifest pinned
`vite@^8.0.16` against a lockfile resolving `6.4.2`). The underlying advisory is
**dev-only** (`npm audit --omit=dev` = 0 production vulns), so it was deferred. That
deferral currently lives only on the closed PR; it should be tracked in the backlog.

## In scope

**A — Railway builder switch (Nixpacks → Railpack):**
- In `railway.json`, change `build.builder` from `"NIXPACKS"` to `"RAILPACK"`. Leave
  `buildCommand`, `startCommand`, `healthcheckPath`, `healthcheckTimeout`, and the
  restart policy unchanged.
- Update the `README.md` "Deploy to Railway" section to name the Railpack builder
  (currently it doesn't name the builder at all).

**B — Backlog bookkeeping (docs only):**
- Add a `reviews/backlog.md` item recording the deferred esbuild/vite bump: the
  dev-only esbuild advisory, PR #23 closed as malformed, the clean path
  (bump Vite to a consistent `^6` with a regenerated lockfile; locally that resolves
  esbuild `0.25.12` and the gate passes), and the note to do it ideally alongside CI
  so future Dependabot PRs are auto-gated.

## Non-goals

- **No actual dependency bump** — this story *records* the esbuild/vite work in the
  backlog; it does not perform it (no `package.json` / `package-lock.json` change).
- **No CI / Dependabot config** — separate, previously-declined work.
- No change to `buildCommand`, `startCommand`, healthcheck, restart policy, the
  Node pin (`.nvmrc` / `engines`), or the server's static-serving of `client/dist`.
- No new `railpack.json` / build config file — `railway.json` already carries the
  build/start commands Railpack honors; add one only if the deploy proves it needs it.

## Acceptance criteria

1. `railway.json` `build.builder` is `"RAILPACK"`; `buildCommand` (`npm run build`),
   `startCommand` (`npm start`), `healthcheckPath` (`/api/health`),
   `healthcheckTimeout`, and the restart policy are byte-for-byte unchanged.
2. The local build is unaffected: `npm test && npm run build` is green and
   `client/dist/index.html` is produced (sanity that the build command itself is
   builder-independent).
3. `README.md`'s "Deploy to Railway" section names the **Railpack** builder.
4. `reviews/backlog.md` gains an item recording the deferred esbuild/vite bump
   (dev-only advisory; PR #23 closed malformed; clean `vite ^6` path; pair with CI).
5. **(Post-merge, deploy-observed — not locally verifiable.)** After this merges to
   `main`, the Railway deploy builds with **Railpack** and comes up healthy: the build
   log shows Railpack (not Nixpacks), `npm run build` completes (devDependencies
   available — no `vite: not found`), and `GET /api/health` returns `200`. If the build
   or healthcheck fails, roll back by reverting `railway.json`'s `builder` field.
6. Scope containment: run `git diff --name-only main...HEAD` and verify no files
   appear beyond `railway.json`, `README.md`, `reviews/backlog.md`, and this story
   file (`reviews/railpack-deploy-switch.md`).

## Test notes

- **AC1:** read `railway.json` — only the `builder` value changed.
- **AC2:** run `npm test && npm run build`; green, and `client/dist/index.html` exists.
- **AC3:** read the README deploy section.
- **AC4:** read `reviews/backlog.md` — the esbuild/vite item is present with the repro
  + clean-path notes.
- **AC5:** **post-merge**, watch the Railway deploy: confirm the build log says Railpack,
  the Vite build succeeds (devDeps present), and `/api/health` is `200`. This AC is the
  one that proves the switch and can only be checked after the merge triggers a deploy;
  the merge is the trigger, the revert is the rollback.
- **AC6:** `git diff --name-only main...HEAD` shows no files beyond those AC6 lists.

## Open questions

1. **Node version under Railpack.** Railpack should pick Node 22 from `.nvmrc` (`22`) +
   `engines.node >=22`. If you'd rather pin an exact version (e.g. `.nvmrc` → a specific
   `22.x`) for fully reproducible builds, say so — otherwise I leave the pin as-is.
2. **devDeps-for-build safety.** I'm treating "the build gets `vite`" as something the
   post-merge deploy verifies, not something to pre-emptively force (e.g. via an
   explicit `npm ci --include=dev` in `buildCommand`). If you'd rather de-risk the very
   first Railpack build proactively, I can add that — but it may be redundant with
   Railpack's defaults. Default: verify on deploy, fix only if it fails.

## Build note (2026-06-10)

AC → file map:
- **AC1** (builder NIXPACKS → RAILPACK; build/start/health unchanged) → `railway.json`.
- **AC2** (local build unaffected; gate green; dist produced) → no product files; `npm test && npm run build`.
- **AC3** (README names the Railpack builder) → `README.md`.
- **AC4** (backlog item for deferred esbuild/vite bump) → `reviews/backlog.md`.
- **AC5** (Railpack deploy healthy) → post-merge, deploy-observed; no repo file.
- **AC6** (scope containment) → no product files; `git diff --name-only main...HEAD`.
