Date: 2026-07-26 · Branch: claude/codeql-security-fixes · Status: approved

# Fix all open CodeQL alerts

## Problem

CodeQL code-scanning reports **4 open alerts on `main`** (confirmed live via
`gh api .../code-scanning/alerts`, 2026-07-26). They sit on the Security tab as
unresolved High/Medium findings on a soon-to-be-published Marketplace app:

| # | Rule | Sev | Location | Nature |
|---|------|-----|----------|--------|
| 1 | `js/missing-rate-limiting` | High | `server/src/app.js:158` (static catch-all) | FS-serving route with no rate limiter |
| 2 | `js/clear-text-logging` | High | `server/src/index.js:18` (boot cred log) | Secret-derived value flows to a log sink |
| 3 | `js/insecure-temporary-file` | High | `server/test/loadEnv.test.js:12` | Predictable filename in shared `tmpdir()` |
| 6 | `js/log-injection` | Medium | `server/src/app.js:107` (request logger) | `req.path` logged unsanitised |

Goal: drive the open-alert count to **zero**. Three are true positives with
clean code fixes; #2 is a judgment call (the code deliberately never logs the
secret — it logs a length + truncated SHA fingerprint) and needs Thomas's
disposition (fix-in-code vs. dismiss-as-false-positive). See Open questions.

## In scope

- **#1 rate limiting** — add a global per-IP rate limiter (using the already-present
  `express-rate-limit`) covering the app's file-serving routes.
- **#6 log injection** — sanitise user-controlled values (`req.path`, `req.method`)
  before they reach `console.log` in the request logger.
- **#3 insecure temp file** — the `loadEnv` test writes to a unique private temp
  **directory** (`fs.mkdtempSync`) instead of a predictable file in `tmpdir()`.
- **#2 clear-text logging** — resolve per Thomas's decision (Open questions Q1):
  either narrow the boot log so no secret-derived value is logged, **or** dismiss
  the alert as a false positive with a justification. Code path taken only if Q1 = fix.
- Tests for #1 and #6 (the two with new production logic).

## Non-goals

- No change to what the credential fingerprint *computes* (it already never
  reveals the secret) unless Q1 lands on the code-fix option.
- No new dependency (`express-rate-limit` is already in `server/package.json`).
- No change to the deauth webhook's own limiter (`deauth.js`) — it stays as-is.
- No CI / CodeQL-workflow changes (the scan already runs and produced these alerts).
- No broader security sweep — only these four alerts.
- The unrelated modified `dev-docs/marketplace-submission/*` files in the working
  tree are not part of this story and will not be committed here.

## Acceptance criteria

1. **AC1 — rate limiting (#1).** A rate-limiting middleware is applied ahead of the
   static/file-serving routes in `createApp`, so `js/missing-rate-limiting` no longer
   flags `app.js`. The limiter's ceiling is injectable via a `createApp` option (mirroring
   the existing `deauth.rateLimitOptions`) so tests can drive it.
2. **AC2 — log injection (#6).** The request logger strips CR/LF and other control
   characters from `req.path` (and `req.method`) before interpolation, so
   `js/log-injection` no longer flags `app.js:107`. The existing request-logger
   behaviour (path-only, skips routine traffic, never logs the OAuth code) is preserved.
3. **AC3 — insecure temp file (#3).** `loadEnv.test.js` creates its scratch env file
   inside a unique directory from `fs.mkdtempSync(join(tmpdir(), 'meeting-cost-'))`
   and removes that directory in `finally`, so `js/insecure-temporary-file` no longer
   flags line 12. The test's three assertions still pass unchanged in intent.
4. **AC4 — clear-text logging (#2).** Resolved per Thomas (2026-07-26): the boot
   fingerprint line at `index.js:18` is **deleted entirely**, leaving only the
   `zoom oauth configured: <bool>` line. No secret-derived value is logged at boot, so
   `js/clear-text-logging` no longer flags `index.js`. The `fingerprint`/
   `zoomCredentialFingerprint` helpers in `oauth.js` and their `oauthFingerprint.test.js`
   coverage stay (still exported for deliberate diagnostics); the now-dead
   `zoomCredentialFingerprint` import in `index.js` is removed too.
5. **AC5 — gate green.** `npm test && npm run build` passes.
6. **AC6 — scope containment.** The committed diff touches only files needed for the
   above (`server/src/app.js`, `server/test/loadEnv.test.js`, this story file, plus new
   test file(s); `server/src/index.js` / `oauth.js` only if Q1 = fix). No unrelated files.

## Test notes

- **AC1** — extend `createApp` with a `rateLimit` option; a new test builds the app
  with a tiny limit (e.g. `{ windowMs: 60_000, limit: 3 }`), fires N+1 requests at a
  file-serving path, and asserts the last returns **429** while earlier ones return
  2xx (pattern mirrors the rate-limit case in `deauth.test.js`). A second assertion
  confirms a normal app (default limit) serves a handful of requests without 429.
- **AC2** — extract a small pure `sanitizeLogValue()` helper and unit-test it directly:
  input containing `\n`, `\r`, and a control char → output has them removed; ordinary
  paths pass through unchanged. Plus a live check (capture `console.log`, like
  `requestLog.test.js`) that a request still logs `[server] GET /…` with no embedded newline.
- **AC3** — `npm test` (the file *is* the fixture); the two behavioural assertions and
  the EISDIR assertion still pass. The 3rd test (`loadLocalEnv(tmpdir())`, reading a dir)
  is unaffected and stays.
- **AC4** — if *fix*: covered by the boot-log change (assert the boot line no longer
  contains a secret-derived token) or simply by re-scan. If *dismiss*: `gh api -X PATCH
  repos/thomasbcox/zoom-meeting-cost/code-scanning/alerts/2 -f state=dismissed
  -f dismissed_reason="false positive" -f dismissed_comment="…"` — a GitHub account
  action requiring Thomas's explicit approval (or Thomas dismisses via the Security UI).
- **AC5** — `npm test && npm run build` (the configured gate).
- **AC6** — run `git diff --name-only main...HEAD` and verify no files appear beyond
  those the ACs enumerate.
- **CodeQL confirmation** — CodeQL runs on push/PR via the existing Actions workflow;
  the definitive check is that alerts #1/#3/#6 do not reappear on the branch scan and
  #2 is cleared or dismissed. Local gate green is necessary but not sufficient for that.

## Open questions

- **Q1 — #2 clear-text logging: fix-in-code or dismiss-as-false-positive?**
  `index.js:18` logs `zoomCredentialFingerprint()`, which prints
  `secret[len=<n> sha=<12 hex>]` — a length plus a truncated, non-reversible SHA-256.
  The secret itself is never logged; this is the standard credential-fingerprint
  diagnostic (built to debug `invalid_client`). CodeQL's dataflow still connects the
  `ZOOM_CLIENT_SECRET` source to the log sink and a runtime guard would **not** clear it
  (CodeQL flags the structural path, not the condition). So the real choice is:
  - **(a) Dismiss as false positive** (recommended) — keeps the diagnostic; alert is
    dismissed with justification. Cost: an external GitHub action (Thomas in the UI, or
    Thomas authorises me to run `gh api`). Risk: a reviewer later re-opens it (low; the
    justification stands).
  - **(b) Narrow the boot log** — drop the *secret* fingerprint from the unconditional
    boot line (keep id/redirect). Clears the alert purely in code. Cost: loses the most
    useful field for `invalid_client` triage (the secret is exactly what you fingerprint).
  - **(c) Restructure to break the dataflow** while keeping the secret fingerprint —
    not recommended: mangles correct code to satisfy a heuristic, marginal benefit.
- **Q2 — rate-limit model & ceiling.** Primary proposal: **per-IP** limiter with
  `app.set('trust proxy', 1)` (Railway = single proxy hop) and a generous default
  (~300 req/min/IP), skipping only `/api/health` so platform health checks are never
  throttled. Alternative: a **constant-key** global bucket like the deauth limiter (no
  `trust proxy` needed) — rejected as primary because it lets one noisy client exhaust
  the shared bucket for everyone; the deauth route uses constant-key only because Zoom's
  webhook source IPs are deliberately unstable, which does not apply to real SPA users.
  Confirm the model and whether ~300/min is the right ceiling.

## Design sketch — HOW

**#1 — global rate limiter (`server/src/app.js`).**
`express-rate-limit` (already a dep, already used in `deauth.js`) is the tool. In
`createApp`, after the `/auth` deauth router is mounted (so deauth keeps *only* its own
constant-key limiter and isn't double-counted) and before the JSON parser + API/static
routes, add `app.use(rateLimit({...}))`. Config mirrors deauth's style:
`standardHeaders: 'draft-7'`, `legacyHeaders: false`, **default (per-IP) key generator**,
`skip: (req) => req.path === '/api/health'`, and a limit taken from a new
`createApp({ rateLimit })` option defaulting to `{ windowMs: 60_000, limit: 300 }`.
Add `app.set('trust proxy', 1)` so `req.ip` is the real client IP behind Railway's proxy
(nothing else in `server/src` reads `req.ip` today, so blast radius is nil; `express-rate-limit`
v8 accepts a numeric trust-proxy without its permissive-proxy error). This is the one
genuinely cross-cutting change: a middleware + a proxy setting future routes inherit.

**#6 — log-injection sanitiser (`server/src/app.js`).**
Add a small pure helper near `isRoutineRequest`:
`sanitizeLogValue(v) => String(v).replace(/[\n\r]/g, '').replace(/[\u0000-\u001F\u007F]/g, '')`
(the explicit `\n|\r` strip is the pattern CodeQL recognises as a log-injection barrier).
Apply it to `req.method` and `req.path` in the existing logger line. Behaviour otherwise
unchanged (still path-only, still skips routine traffic).

**#3 — unique temp dir (`server/test/loadEnv.test.js`).**
Replace `const file = join(tmpdir(), 'meeting-cost-…env')` + write with
`const dir = mkdtempSync(join(tmpdir(), 'meeting-cost-'))` (0700, unpredictable suffix),
write `join(dir, 'test.env')`, and `rmSync(dir, { recursive: true, force: true })` in
`finally`. Removes the predictable-name/symlink-race vector CodeQL flags. Other two tests
untouched.

**#2 — clear-text logging (`server/src/index.js` / `oauth.js`).** Only if Q1 = (b) fix:
in `zoomCredentialFingerprint()` (or its boot-log call site) stop emitting the
secret-derived field unconditionally. If Q1 = (a) dismiss: no code change; external
dismissal instead.

**Testing shape.** New/edited tests use the repo's `node:test` + `createApp()` +
`app.listen(0)` + `fetch` conventions (see `deauth.test.js`, `requestLog.test.js`); the
`sanitizeLogValue(v) => String(v).replace(/[\n\r]/g, '').replace(/[\u0000-\u001F\u007F]/g, '')`

## Codex design review (2026-07-26)

**Verdict:** The temp-directory (#3) and log-sanitisation (#6) designs are small,
idiomatic, and consistent with the repo. The rate-limiter library choice and middleware
placement are appropriate — but the proposed **client-IP mechanism rests on an
undocumented Railway proxy assumption and should be redesigned before implementation**.
AC4 (#2) remains contingent on Thomas's disposition.

### IMPORTANT
- **Per-IP limiter relies on an unverified proxy contract** — *(one-way · nonstandard)*
  · locus: Design sketch #1.
  `app.set('trust proxy', 1)` assumes one proxy hop supplying `X-Forwarded-For`. Railway's
  networking spec documents **`X-Real-IP`** as the client-IP header, not `X-Forwarded-For`,
  so the default (XFF-based) limiter key may collapse all users into one proxy-wide bucket;
  a wrong numeric hop count could instead admit spoofed addresses. `trust proxy` also
  changes request semantics app-wide (inherited by future routes) — cross-cutting, not
  limiter-local.
  **Alternative:** keep Express's default trust setting; give *this limiter* a narrow
  `keyGenerator` that reads Railway's documented `X-Real-IP`, normalises via
  `express-rate-limit`'s `ipKeyGenerator`, and falls back safely to the socket address.
  Test that repeated requests from one forwarded IP are limited while a second IP keeps its
  own bucket.
  **Win:** stops the per-IP control from degrading into one shared bucket or a spoofable
  no-op, removes an app-wide proxy setting, and confines Railway-specific identity to the
  one component that needs it.

### QUESTION
- **AC4 has no selected implementation path** — *(two-way · standard)* · locus: Design
  sketch #2. Dismissal = no code change; narrowing the boot diagnostic = edits `index.js`/
  `oauth.js`. Until Thomas picks one, no complete design satisfies AC4. (= this story's Q1.)
  Reviewer notes dismissal is "a defensible false-positive disposition for the high-entropy
  truncated fingerprint."
- **The 300/min ceiling is not yet justified** — *(two-way · standard)* · locus: Q2 /
  Design sketch #1. A per-IP quota is shared by users behind one corporate NAT; this
  no-cache SPA fires several requests per load. Derive the default from the built client's
  actual request fan-out × expected concurrent users per egress IP and record that
  calculation; keep the injectable tiny ceiling for tests.

### My recommended dispositions (for the frame consult)
- **IMPORTANT (proxy contract): FIX** — adopt the reviewer's alternative. Drop
  `app.set('trust proxy', …)`; key the limiter on `X-Real-IP` via a narrow `keyGenerator`
  + `ipKeyGenerator`, with a safe socket-IP fallback. This removes the one-way, app-wide
  setting and the unverified assumption. (Revised Design sketch #1 below supersedes the
  original on approval.)
- **QUESTION (AC4 / #2): DECIDE — recommend (a) dismiss as false positive.** The fingerprint
  is non-reversible and never logs the secret; dismissal keeps the diagnostic. Needs Thomas
  to dismiss in the Security UI or authorise me to run the `gh api` PATCH.
- **QUESTION (ceiling): ACCEPT with rationale** — I'll set the default from the real asset
  fan-out (counted from `client/dist` at implementation time) and record the number; not a
  blocker. Keep it injectable.

### Revised Design sketch #1 (supersedes original, applied only on approval)
In `createApp`, after the `/auth` deauth mount and before the JSON parser + API/static
routes: `app.use(rateLimit({ windowMs, limit, standardHeaders: 'draft-7',
legacyHeaders: false, skip: req => req.path === '/api/health', keyGenerator }))` where
`keyGenerator(req)` = normalise `req.headers['x-real-ip']` (documented Railway client-IP
header) via `ipKeyGenerator`, falling back to the socket address when absent. **No
`app.set('trust proxy', …)`.** `windowMs`/`limit` come from the injectable
`createApp({ rateLimit })` option; default limit derived from the built client's request
fan-out and recorded in a comment. Everything else in the sketch (#3, #6, #2) unchanged.

## Scope decision (2026-07-26)

Thomas approved all four alerts in scope (drive the open CodeQL count to zero). For #2 he
chose, verbatim: **"Delete the fingerprint line; keep only zoom oauth configured:
true/false."** For the rate limiter he chose the reviewer's fix (X-Real-IP keyGenerator,
no `trust proxy`).

## Design decisions (2026-07-26)

Binding on implementation (step 9):

- **IMPORTANT — per-IP limiter / proxy contract → FIX (adopt reviewer's alternative).**
  No `app.set('trust proxy', …)`. The global limiter gets a narrow `keyGenerator` that
  reads Railway's documented `X-Real-IP`, normalises it via `express-rate-limit`'s
  `ipKeyGenerator`, and falls back to the socket address when the header is absent.
  Railway-specific identity stays confined to the limiter. (Revised Design sketch #1 is
  the binding shape.)
- **QUESTION — AC4 / #2 → FIX by deletion (Thomas's choice, supersedes my "dismiss"
  recommendation).** Delete `index.js:18` (`console.log('… zoom creds …')`) and the dead
  `zoomCredentialFingerprint` import on `index.js:6`. Keep the `oauth.js` helpers and
  `oauthFingerprint.test.js` untouched (that test asserts on the fingerprint but never logs
  it, so it introduces no new sink). No external dismissal needed.
- **QUESTION — rate-limit ceiling → ACCEPT with recorded rationale.** Default limit derived
  from the built client's real request fan-out (counted from `client/dist` at implementation
  time) × a generous concurrent-users-per-egress-IP allowance, recorded in a code comment.
  Kept injectable via `createApp({ rateLimit })` for tests.

## Build note (2026-07-26)

AC → file map:

- **AC1** (rate limiting, #1) → `server/src/app.js` (`DEFAULT_APP_RATE_LIMIT`, `clientIpKey`,
  the `rateLimit(...)` mount, `rateLimitOptions` param) · test: `server/test/rateLimit.test.js`
- **AC2** (log injection, #6) → `server/src/app.js` (`sanitizeLogValue` + its use in the request
  logger) · test: `server/test/requestLog.test.js` (`sanitizeLogValue` unit test)
- **AC3** (insecure temp file, #3) → `server/test/loadEnv.test.js` (`mkdtempSync` dir)
- **AC4** (clear-text logging, #2) → `server/src/index.js` (boot fingerprint line + dead import
  removed; `oauth.js` helpers + `oauthFingerprint.test.js` left intact)
- **AC5** (gate) → all of the above
- **AC6** (scope containment) → no product files beyond those listed

## Codex approach review (2026-07-26, base main, HEAD 914b660)

**Verdict:** The production shape is sound — it uses the existing rate-limit dependency
declaratively, localises Railway-specific IP handling, keeps sanitisation small, and touches
no OAuth/deauth code unnecessarily. One test-design concern remains. (The reviewer's "gate
inconclusive" note is its own read-only sandbox blocking Vitest temp files / listeners /
mkdtemp — not an assertion failure; the gate ran green locally.)

### IMPORTANT
- **Rate-limit tests exercise the dependency, not the custom IP policy** — *(two-way ·
  kludgy)* · locus: `server/test/rateLimit.test.js:26`.
  All three tests use the default socket address, so they verify `express-rate-limit`'s
  counting behaviour but never exercise the branch-owned `clientIpKey` policy. The accepted
  design's central invariant — requests sharing `X-Real-IP` share a bucket while a different
  client keeps its own — could break or collapse all clients together without failing these
  tests.
  **Alternative:** replace the low-value default-burst test with one integration test that
  sends `X-Real-IP: A` until A is limited, then sends `X-Real-IP: B` and confirms B still
  succeeds (include an IPv6 value if normalisation is an intended invariant).
  **Win:** tests the only custom, deployment-specific part of the limiter; guards against
  both cross-client starvation and ineffective per-IP limiting; drops one dependency-behaviour
  test.

## Codex review (2026-07-26, base main, HEAD 615d0ab)

**Summary:** The implementation satisfies the production-code requirements for all four CodeQL
alerts and stays within scope. One meaningful test-coverage gap leaves the custom,
deployment-specific IP-keying policy unverified. **Both passes converged on this same single
finding** (approach + correctness) — nothing else flagged.

### IMPORTANT
- **Custom client-IP policy is untested** · locus: `server/test/rateLimit.test.js:26`.
  All three new tests omit `X-Real-IP`, so they exercise `express-rate-limit`'s counting
  using one socket address but never verify the branch-owned `clientIpKey` policy. A
  regression that collapses distinct Railway clients into one bucket — or fails to group
  requests from the same forwarded IP — would still pass.
  **Suggestion:** add an integration test that exhausts the bucket with one `X-Real-IP`
  value, confirms another request with that value gets 429, then confirms a *different*
  `X-Real-IP` still succeeds. Include an IPv6 value if the /56 normalisation is an intended
  invariant.

## Decisions (2026-07-26)

Both the approach and correctness passes raised the **same single finding** this round; one
decision covers it.

- **IMPORTANT — Custom client-IP (`clientIpKey` / `X-Real-IP`) policy is untested**
  (`rateLimit.test.js:26`, both passes) → **FIX.** Thomas: *"Fix."* Add an integration test
  that exhausts the bucket with one `X-Real-IP`, confirms a second request with that value gets
  429, and confirms a different `X-Real-IP` still succeeds (plus an IPv6 value for the /56
  normalisation). Swap out the low-value default-burst test. Test-only; no production change.

To be applied in `/close`, which re-runs the gate and stops at the merge fork.

## Fixes (2026-07-26)

- **IMPORTANT — clientIpKey / X-Real-IP policy untested** (both passes) → **fixed** in
  `server/test/rateLimit.test.js`. Removed the low-value default-burst test and added two that
  exercise the branch-owned key policy directly: (1) two distinct `X-Real-IP` values get
  independent buckets — client A is throttled at the ceiling while client B still succeeds (no
  cross-client starvation, and not one collapsed bucket); (2) two IPv6 addresses in the same /56
  share a bucket (the `ipKeyGenerator` normalisation invariant). Kept the socket-fallback 429 test
  (the no-header path) and the /api/health-exempt test. No production code changed.
