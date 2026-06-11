Date: 2026-06-10 · Branch: claude/vite-csp-hardening · Status: approved

> Approved by Thomas 2026-06-10. Decisions: (1) `connect-src` =
> `'self' https://*.zoom.us https://*.zoom.com` (keep Zoom hosts as a margin); (2) vite
> target `^6.4.2` (caret, minimal major to patched esbuild, matches repo convention);
> (3) ship the two items combined, CSP line as the in-Zoom rollback.

Combines two small, independent hardening backlog items (Thomas's call,
2026-06-10): **A** the deferred esbuild/vite security bump, and **B** CSP hardening
(tighten `connect-src` off its dev-permissive wide-open value). They're unrelated
technically but both quick and security-themed.

## Problem

**A — esbuild/vite bump (dev-only advisory).** The repo pins `vite@^5.4.0`, which
ships `esbuild@0.21.x`, affected by the esbuild dev-server advisory. It's **dev-only**
(`npm audit --omit=dev` = 0 production vulns), so it was deferred when the malformed
Dependabot PR #23 was closed. A clean bump to `vite@^6` pulls `esbuild ≥ 0.25` (patched)
with a consistent lockfile. Verified locally on 2026-06-10: reconciling to vite 6.4.2 +
esbuild 0.25.12 passes `npm test && npm run build` with 0 vulnerabilities.

**B — CSP hardening.** The Content-Security-Policy in `server/src/app.js` is
dev-permissive:

```
connect-src 'self' wss: https:
frame-ancestors 'self' https://*.zoom.us https://*.zoom.com
```

- `connect-src` allows XHR/fetch/WebSocket to **any** `wss:`/`https:` host. The `wss:`
  is **dead** — the shared-state WebSocket was removed (backlog: "Remove the unused
  shared-state WebSocket — DONE"), so nothing uses WebSockets. The bare `https:` lets
  the page connect anywhere.
- `frame-ancestors` is already scoped to Zoom domains (not `'self'`/`*`). Zoom's OWASP
  docs (developers.zoom.us/docs/zoom-apps/security/owasp) do **not** publish narrower
  client origins, and narrowing below the `*.zoom.us`/`*.zoom.com` wildcards risks
  blank-screening the app in the Zoom client — so it is **left as-is** (the wildcards
  are the documented scoping, and the real hardening here is `connect-src`).

CSP changes can blank-screen the app inside the Zoom client (the original reason these
headers exist), so the tightening is verified **in the Zoom client post-merge**, with a
one-line revert as rollback.

## In scope

**A — vite/esbuild bump:**
- Bump `client/package.json` `vite` devDependency to `^6.4.2`; regenerate
  `package-lock.json` so it is consistent (`npm ci` passes); `esbuild` resolves to
  `≥ 0.25`.

**B — CSP `connect-src` tightening:**
- In `server/src/app.js`, change `connect-src 'self' wss: https:` →
  `connect-src 'self' https://*.zoom.us https://*.zoom.com` (drop the dead `wss:` and
  the wide-open `https:`; keep `'self'` for our `/api`, plus the Zoom hosts defensively
  in case the bundled `@zoom/appssdk` fetches from Zoom). Update the stale code comment
  that references "WebSocket + API (wss:/https:)". Leave `frame-ancestors` and the other
  directives unchanged. Update the CSP assertions in `server/test/headers.test.js`.

## Non-goals

- **No `frame-ancestors` narrowing** — Zoom doesn't document narrower origins and it
  risks breaking embedding; the Zoom-scoped wildcards stay.
- **No major upgrade beyond vite 6** (not vite 7/8) — vite 6 is the minimal patched line
  and the one verified locally; vite 8 is what the malformed Dependabot PR overshot to.
- No change to the other CSP directives, the secure-header set, the build/start
  commands, or app behavior.
- No CI / Dependabot config (separate, previously-declined).

## Acceptance criteria

1. `client/package.json` `vite` is `^6.4.2`; `package-lock.json` is regenerated and
   **consistent** — `npm ci` completes without `EUSAGE`/missing-package errors; the
   resolved `esbuild` is `≥ 0.25`; `npm audit` no longer reports the esbuild dev-server
   advisory.
2. The gate is green on vite 6: `npm test && npm run build` passes and
   `client/dist/index.html` is produced.
3. `server/src/app.js` `connect-src` is exactly
   `'self' https://*.zoom.us https://*.zoom.com` (no `wss:`, no bare `https:`); the
   stale "WebSocket" comment is corrected; `frame-ancestors` and all other directives
   are byte-for-byte unchanged.
4. `server/test/headers.test.js` asserts the tightened `connect-src` (contains `'self'`
   and the Zoom hosts; does **not** contain `wss:` or a bare ` https:` token) and still
   asserts `frame-ancestors` + the four required OWASP headers. Test name/comment no
   longer says "websocket".
5. **(Post-merge, in-Zoom observed.)** The app still renders inside the Zoom client — no
   blank screen, no `connect-src`/CSP-violation console errors — and the overlay still
   composites and updates. Rollback if it breaks: revert the `connect-src` line.
6. Scope containment: run `git diff --name-only main...HEAD` and verify no files appear
   beyond `client/package.json`, `package-lock.json`, `server/src/app.js`,
   `server/test/headers.test.js`, and this story file
   (`reviews/vite-csp-hardening.md`).

## Test notes

- **AC1:** after the bump, run `npm ci` (must succeed) and `node -e` to print resolved
  `vite`/`esbuild`; run `npm audit` and confirm the esbuild advisory is gone.
- **AC2:** `npm test && npm run build` green; `client/dist/index.html` exists.
- **AC3:** read `server/src/app.js` — only `connect-src` (and its comment) changed.
- **AC4:** the updated `headers.test.js` runs in the gate (`npm test`) and passes;
  assert the new connect-src content and the absence of `wss:`/bare `https:`.
- **AC5:** **post-merge** — load the app in the Zoom client; confirm it renders, the
  overlay works, and the browser/Zoom console shows no CSP violations.
- **AC6:** `git diff --name-only main...HEAD` shows no files beyond those AC6 lists.

## Open questions

1. **`connect-src` aggressiveness.** I propose `'self' https://*.zoom.us
   https://*.zoom.com` — drops the wide-open `https:`/`wss:` but keeps Zoom hosts as a
   safety margin (the bundled SDK *might* fetch from Zoom). The tightest option is
   `'self'` only (no external connects at all), but if the SDK does any XHR to a Zoom
   host that would blank-screen the app — and it's only confirmable in-Zoom. Go with the
   safer `'self' + Zoom hosts`, or attempt `'self'`-only?
2. **vite target.** `^6.4.2` (the verified line). If you'd rather pin an exact `6.x` or
   accept a later 6 minor, say so; I'm avoiding 7/8.
3. **Combined verification.** The vite bump is gate-verified now; the CSP tightening is
   only fully verified in-Zoom (post-merge). So this PR mixes a gate-verifiable change
   with an in-Zoom-verifiable one — fine to ship together, with the CSP line as the
   easy rollback if the in-Zoom check fails?

## Build note (2026-06-10)

AC → file map:
- **AC1** (vite ^6.4.2; lockfile consistent; esbuild ≥0.25; 0 vulns) → `client/package.json`, `package-lock.json`.
- **AC2** (gate green on vite 6; dist produced) → no product files; `npm test && npm run build`.
- **AC3** (connect-src pinned; comment fixed; frame-ancestors unchanged) → `server/src/app.js`.
- **AC4** (CSP test asserts pinned connect-src; no wss:/bare https:) → `server/test/headers.test.js`.
- **AC5** (renders in Zoom) → post-merge, in-Zoom observed.
- **AC6** (scope) → no product files; `git diff --name-only main...HEAD`.
