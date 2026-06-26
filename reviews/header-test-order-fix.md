# header-test-order-fix

Date: 2026-06-25 · Branch: claude/header-test-order-fix · Status: approved

> **Approved 2026-06-25** — Thomas: "approve" (clean pass — scope nod; Codex design review found
> nothing, no one-way doors).

> Story 3 of 3 in the "step-2 quick wins" batch. Stories 1 (remove-cost-multiplier, PR #49)
> and 2 (api-log-redaction, PR #50) shipped.

## Problem

`server/test/headers.test.js`'s second test — "CSP allows the app bundle and Zoom embedding,
with connect-src pinned" — fetches `GET /` and asserts on the CSP **content** (e.g.
`default-src 'self'`). When `client/dist` is absent, `GET /` falls through `express.static`
to the SPA fallback (`app.get('*')`), `res.sendFile(index.html)` errors, `next()` runs with no
route left, and Express's **finalhandler overwrites the CSP with `default-src 'none'`** on the
404 response — so the `default-src 'self'` assertion fails. The test's header comment wrongly
implies the whole file passes without a build; in reality the gate (`npm test && npm run build`)
only stays green locally because a stale `client/dist` happens to exist, and **CI papers over it
by building before testing** (`.github/workflows/ci.yml`, with an explanatory comment).

The other two tests are already order-independent: test 1 checks header *presence* only (even
the finalhandler 404 carries a CSP header), and test 3 asserts the exported `CSP` constant
directly. So **only the CSP-content test is fragile.**

Tracked in [`reviews/backlog.md`](backlog.md) ("Server header test depends on a built client
(order-fragile gate)").

## In scope

- **Make the CSP-content test order-independent** (`server/test/headers.test.js`): assert the
  delivered CSP on a route that does **not** hit the SPA fallback — `/api/health`, which always
  returns 200 with the global security headers — instead of `GET /`. Update the file's comments
  to describe the order-independence accurately.
- **Drop the CI stopgap** (`.github/workflows/ci.yml`): reorder so **Test runs before Build**
  (matching the local gate's own order, `npm test && npm run build`) and remove the
  "Build before test … the CSP assertion fails" rationale comment, since the test no longer
  depends on a built client.

## Non-goals

- **No app-code change.** The SPA fallback's missing-file behavior is unchanged (see the
  considered-and-rejected alternative in the design sketch). `server/src/app.js` is untouched.
- Not changing what the CSP policy *contains*, the header middleware, or any route behavior.
- Not adding a build step or fixture that materializes a fake `client/dist` for tests.

## Acceptance criteria

1. **Order-independent content test:** the CSP-content test asserts the delivered
   `Content-Security-Policy` on a route that never reaches the SPA fallback (`/api/health`), and
   its assertions (`default-src 'self'`, `script-src 'self'`, pinned `connect-src`, no `wss:`,
   no bare `https:`, `frame-ancestors` with a Zoom host) are unchanged in substance.
2. **Passes with no build:** `npm --workspace server run test` passes when `client/dist` does
   **not** exist (the decisive order-independence proof).
3. **CI stopgap removed:** `.github/workflows/ci.yml` runs Test before Build and no longer
   carries the "build before test because the CSP assertion fails" rationale.
4. **Coverage preserved:** header *presence* is still asserted on a real HTTP response, and CSP
   *content* is still asserted on a real (delivered) response header — not weakened to only the
   exported constant.
5. **Gate green:** `npm test && npm run build` passes.
6. **Scope containment:** the diff touches only `server/test/headers.test.js` and
   `.github/workflows/ci.yml`.

## Test notes

- AC1 / AC4 — read the test: the content assertions now fetch `/api/health`; test 1 still
  fetches `/` for presence; test 3 still checks the `CSP` constant.
- AC2 — the decisive check: with `client/dist` moved aside / absent, run
  `npm --workspace server run test` and confirm green. (I'll verify this explicitly during
  implementation by temporarily removing `client/dist`.)
- AC3 — read `ci.yml`: Test step precedes Build step; the stopgap comment is gone.
- AC5 — run `npm test && npm run build` (the configured gate).
- AC6 — run `git diff --name-only main...HEAD` and verify no files appear beyond the two listed
  in AC6.

## Open questions

None — the approach is settled (see design sketch); the only real fork was test-fix vs
app-fix, resolved in favor of the test fix below.

## Design sketch — HOW

**Chosen approach (test-only, order-independent assertions):**
- Repoint the one fragile test from `GET /` to `GET /api/health`. `securityHeaders` is the
  first global middleware (`app.use(securityHeaders)` before everything), so every successful
  response — including `/api/health`'s JSON 200 — carries the full CSP. `/api/health` never
  reaches `express.static` or the `app.get('*')` SPA fallback, so `sendFile` never errors and
  finalhandler never overwrites the CSP. The assertion then sees the real `default-src 'self'`
  policy whether or not `client/dist` exists.
- Keep asserting on the **delivered response header** (not the exported constant) so the test
  still proves the policy is actually sent on a live response — just on a route that can't
  error. Test 1 (presence on `/`) and test 3 (the `CSP` constant) are already order-independent
  and stay as-is.
- CI: reorder to Install → Test → Build (the local gate's order) and delete the stopgap comment.

**Alternatives considered and rejected:**
- *App-fix — make the SPA fallback preserve security headers on a missing-file error.* Rejected:
  this is app code for a scenario that doesn't occur in production (prod always ships
  `client/dist`), and an error response with `default-src 'none'` is already a *safe* CSP, so
  there's no security gain — only added surface in `app.js`.
- *Assert CSP content against the exported `CSP` constant with no HTTP fetch.* Simplest and
  fully robust, but it drops the "header is actually delivered on a response" property; the
  `/api/health` fetch keeps that property at no extra fragility.

**No new structure, dependency, or cross-cutting pattern** — a test reroute + a CI step reorder.

## Codex design review (2026-06-25)

**Verdict:** Sound design. Repointing only the fragile CSP-content assertion to `/api/health`
uses the existing global `securityHeaders` middleware contract, preserves a live
delivered-header check, avoids app-code churn, and matches the repo's plain
`node:test` / native `fetch` convention. Reordering CI to Test then Build aligns with the root
`npm test && npm run build` gate and removes the temporary build-before-test workaround. No
dependency or hand-rolled-replacement issue found.

**Findings:** none (empty array). No one-way doors.

## Design decisions (2026-06-25)

Clean pass — Codex design review returned 0 findings and no one-way doors; Thomas gave a scope
nod. The chosen shape (test-only reroute to `/api/health` + CI Test→Build reorder; no app
change) is binding on implementation.

## Build note (2026-06-25)

AC → file map:

- **AC1 / AC4** (CSP-content test rerouted to `/api/health`; presence + delivered-header
  coverage preserved) → `server/test/headers.test.js`
- **AC3** (CI reordered Test→Build; stopgap comment removed) → `.github/workflows/ci.yml`
- **AC2** (passes with no `client/dist`) — verified by running the server suite with
  `client/dist` removed; no file change
- **AC5/AC6** — gate + scope containment (the two files above)

## Codex approach review (2026-06-25, base main, HEAD 63491f2)

**Verdict:** Sound approach — Codex would satisfy the ACs with exactly this shape (reroute only
the fragile CSP-content delivered-header assertion to `/api/health`, leave app behavior
untouched, keep presence coverage on a real response, reorder CI to Test→Build). Full-file
review of the test, CI workflow, app, and manifests showed no hand-rolled replacement for a
framework/dependency feature and no unnecessary new structure.

**Findings:** none (empty array). No one-way doors → shape blessed; proceeding to the
correctness pass in the same round.

## Codex review (2026-06-25, base main, HEAD 64cd3d8)

**Summary:** The implementation files satisfy the test reroute and CI-order requirements. One
QUESTION on a scope-containment ambiguity against AC6.

**Findings:**

- **QUESTION — Scope AC excludes review artifacts present in the diff** (`reviews/header-test-order-fix.md`,
  AC6). AC6 says `git diff --name-only main...HEAD` should show only `server/test/headers.test.js`
  and `.github/workflows/ci.yml`, but the branch diff also adds the review/spec artifacts
  (`reviews/header-test-order-fix.md`, `.approach.json`, `.design.json`, `.codex.json`). If those
  aren't intended exemptions, the branch fails the stated criterion. *Suggestion:* decide whether
  review/spec artifacts are exempt; if so, clarify AC6 as implementation-file scope.

- BLOCKER: 0 · IMPORTANT: 0 · QUESTION: 1 · NIT: 0
