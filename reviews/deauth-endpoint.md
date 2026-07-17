Date: 2026-07-14 · Branch: claude/deauth-endpoint · Status: approved

# deauth-endpoint

## Problem

A **published** Zoom OAuth app MUST expose a deauthorization / data-compliance endpoint, or it
fails Marketplace review — a hard publishing gate (`BACKLOG.md` → **OPS-3**;
[[reference-zoom-prod-unknowns-research]]). When a user uninstalls the app, Zoom POSTs a
deauthorization event; the app must verify it, delete the user's data if
`user_data_retention` is false, and POST a confirmation to Zoom's `/oauth/data/compliance`
within 10 days.

The app **doesn't have this endpoint** (verified: no `deauth` / `data/compliance` route in
`server/src`). The favorable part: post-`remove-rate-store` the app persists **no** per-user
data (attendee count / rate / cadence are browser-session-only; there is no rate store, no
`userData`), so the required **purge is a no-op** — there is no record to delete. But the
endpoint itself, with proper signature verification and the compliance callback, is still
required. This story builds that endpoint.

## In scope

- A new **`POST` deauthorization webhook endpoint** that:
  1. **Verifies the Zoom webhook HMAC signature** (`x-zm-signature` + `x-zm-request-timestamp`
     over the raw body, keyed by a new **Secret Token** env var), rejecting missing/invalid
     signatures and stale (replay) timestamps.
  2. Handles Zoom's **`endpoint.url_validation`** challenge (respond with `plainToken` +
     `encryptedToken`) so the URL can be validated in the Marketplace dashboard.
  3. On a valid **`app_deauthorized`** event, performs the (no-op) purge and **POSTs the
     compliance confirmation** to `https://api.zoom.us/oauth/data/compliance` (Basic auth with
     the app's client id/secret, `compliance_completed: true`).
- A new env var **`ZOOM_WEBHOOK_SECRET_TOKEN`**; the endpoint is **inert** (503) when
  unconfigured, mirroring the OAuth scaffold's "not configured" posture.
- **Raw request-body capture** for the HMAC (the existing global `express.json()` otherwise
  consumes the body before we can hash the exact bytes Zoom signed).
- Unit tests for the endpoint (signature valid/invalid, replay, url_validation, deauth →
  compliance callback, unconfigured).
- Docs: add the endpoint URL + `ZOOM_WEBHOOK_SECRET_TOKEN` to `server/.env.example` and the
  `server/zoom-app-config.md` checklist.

## Non-goals

- **No data-deletion logic** — nothing is persisted, so the purge is a no-op (a comment
  documents that invariant). If persistence is ever re-introduced, the delete hook slots in
  here, but that is out of scope now.
- **No general Event Subscription framework** — only the deauthorization event (+ the
  url_validation handshake it shares). No other webhook events.
- No monetization / entitlement teardown (none exists).
- No CSP hardening, no Marketplace dashboard changes (Thomas-only), no `BACKLOG.md` OPS-3 → Done
  move (that is a `/close` record step, not this story).
- ~~No new runtime dependency~~ **(SUPERSEDED 2026-07-16)** — CodeQL flagged the public endpoint
  as `js/missing-rate-limiting` (high), which also matches Zoom's own DoS guidance for the
  deauthorization URL. One dependency, **`express-rate-limit`**, was added to close it (Thomas's
  call — see Decisions round 3 + AC10). Everything else remains Node `crypto` + `express`.

## Acceptance criteria

1. **Endpoint exists & is signature-gated (total, non-throwing).** `POST /auth/deauthorize`
   with a **valid** Zoom signature is accepted (2xx). Every other case is rejected with **401**
   — **never a 500** — and does **not** trigger the compliance callback: a missing or malformed
   `x-zm-signature` (wrong length, or not the exact `v0=<64 lowercase hex>` shape), a
   non-integer `x-zm-request-timestamp`, a timestamp outside the **±300 s** window (**stale
   *or* future-dated**), or a body whose HMAC doesn't match. The comparison is timing-safe over
   **equal-length** buffers.
2. **URL-validation handshake.** A signature-valid `endpoint.url_validation` event gets a
   **200** whose body is `{ plainToken, encryptedToken }`, where `encryptedToken` =
   hex `HMAC-SHA256(secretToken, plainToken)`.
3. **Deauthorization → acknowledge (REVISED 2026-07-15).** A signature-valid `app_deauthorized`
   event performs the (no-op) purge and is acknowledged with **200**. **No compliance callback
   is made** — Zoom's Data Compliance API is deprecated (*"no longer required to call this
   endpoint"*), so the endpoint makes **no outbound request** and needs **no OAuth credentials**.
   *(Superseded: this AC previously required a bounded `POST` to `/oauth/data/compliance` with
   Basic auth and `compliance_completed: true`. That premise was stale — see the approach review
   + Decisions.)*
4. **No persistence and no network touched / no-op purge.** The handler deletes no data (there is
   none), introduces no store, and makes no outbound request — `deauth.js` imports only
   `node:crypto` and `express`. A comment records the "nothing persisted → purge is a no-op"
   invariant and marks where a future delete hook would go.
5. **Inert when unconfigured (REVISED 2026-07-15).** With `ZOOM_WEBHOOK_SECRET_TOKEN` unset the
   endpoint returns **503** (cannot verify) — never a 500 stack, mirroring the OAuth scaffold's
   not-configured posture. `/api/health` and the rest of the app are unaffected. *(Superseded:
   the per-credential arm — url_validation vs. `app_deauthorized` 503 on incomplete client
   id/secret — is moot now that no OAuth credentials are used.)*
6. **No secret leakage.** The Secret Token, the signature, and the client secret are never
   written to logs (consistent with `oauth.js`'s fingerprint-not-value rule).
7. **Docs updated.** `server/.env.example` documents `ZOOM_WEBHOOK_SECRET_TOKEN`, and
   `server/zoom-app-config.md` lists the deauthorization endpoint URL + the Secret Token as a
   Marketplace-config step.
8. **Scope containment (WIDENED 2026-07-15, again 2026-07-16).** The product diff is limited to
   `server/src/zoom/deauth.js` (new), `server/src/app.js`, `server/.env.example`,
   `server/zoom-app-config.md`, `server/test/deauth.test.js` (new); the rate-limit dependency
   (`server/package.json` + root `package-lock.json`); the `BACKLOG.md` doc-drift correction and
   OPS-3 → Done record; and `reviews/backlog.md`. Beyond those, `git diff --name-only
   main...HEAD` carries only this story file and the workflow's review artifacts
   (`.design/.approach/.codex.json`).
9. The gate (`npm test && npm run build`) stays green.
10. **Rate-limited (ADDED 2026-07-16; strengthened round-3).** The `POST /auth/deauthorize` route
    is rate-limited (`express-rate-limit`) as the **outermost** gate — mounted before the global
    JSON parser, so **malformed and oversized** floods are counted and eventually **429**, not
    just well-formed ones. The ceiling is a single **process-global** bucket
    (`keyGenerator: () => 'zoom-deauthorize'`), not per-IP (Zoom's webhook IPs are unstable by
    Zoom's own guidance). Overridable via an injected option (tests). Clears the CodeQL
    `js/missing-rate-limiting` high alert and answers Zoom's DoS guidance.

## Test notes

- **AC1** (`server/test/deauth.test.js`): build a request with a correctly-computed signature
  → 2xx; tamper the body / omit the header / use an old timestamp → 401, and assert the
  compliance `fetch` was **not** called (inject/stub `fetch`).
- **AC2:** post a signed `endpoint.url_validation` with a known `plainToken`; assert the
  response `encryptedToken` equals the independently-computed `HMAC-SHA256(secretToken,
  plainToken)` hex.
- **AC3:** post a signed `app_deauthorized`; with `fetch` stubbed, assert it was called once
  with the `/oauth/data/compliance` URL, an `Authorization: Basic …` header, and a body whose
  `compliance_completed === true`; endpoint returns 200.
- **AC4:** covered structurally — no store module is imported; the test asserts the handler
  needs no persistence (a review check, plus AC3 passing without any store).
- **AC5:** with the Secret Token unset, a POST returns 503 and `fetch` is not called; a
  `GET /api/health` in the same app still returns `{ ok: true }`.
- **AC6:** the tests assert no secret/token/signature value appears in captured `console` output
  (spy on `console.log`/`console.error` during a deauth run).
- **AC7:** manual doc check (the two files render the new env var + endpoint URL).
- **AC8 (scope):** run `git diff --name-only main...HEAD` and verify no files appear beyond the
  five product files, this story file, and the review artifacts enumerated in AC8.
- **AC9:** run `npm test && npm run build`.
- **AC10:** `server/test/deauth.test.js` — with an injected `limit: 2`, the 3rd signed request is
  429; a second case fires unsigned (401) requests and confirms the 3rd is 429, proving the
  limiter runs **before** verification. CodeQL's `js/missing-rate-limiting` alert clears on the
  re-run.

## Open questions

All resolved at the frame consult — see **Design decisions (2026-07-15)** below.

## Design decisions (2026-07-15)

Scope **approved** by Thomas at the frame consult: *"Approve + fix all 3 (recommended)"* — build
the endpoint as specced with all three codex design findings applied. No one-way doors.

- **Endpoint path:** **`POST /auth/deauthorize`** (Thomas) — the `/auth` namespace is already
  Zoom-OAuth-adjacent and excluded from the SPA fallback. Two-way (dashboard URL).
- **Compliance-callback failure:** **respond 500 so Zoom retries** (Thomas) + stderr log. Zoom's
  built-in webhook retry is the durability mechanism; no queue or store.
- **Raw-body capture:** the existing global `express.json({ verify })` hook stashes `req.rawBody`
  — one line, no middleware reordering, the canonical Express webhook-signature pattern.
- **Finding dispositions (all three → fix):**
  - *"The verifier does not safely define hostile-header handling" (BLOCKER)* → **fix**: the
    verifier becomes a total, non-throwing predicate — integer timestamp, `±300 s` window
    (stale **and** future), exact `v0=<64 lowercase hex>` shape check before an equal-length
    `timingSafeEqual`, `false` on every parse error. Folded into **AC1** + the sketch.
  - *"Module-load configuration and global fetch stubbing create avoidable test coupling"
    (IMPORTANT)* → **fix**: `createDeauthRouter(deps)` takes injectable
    `{ secretToken, clientId, clientSecret, fetchImpl, now }` with production defaults; plus
    per-credential 503 (url_validation works with just the token; `app_deauthorized` 503s when
    callback creds are incomplete — no `Basic undefined:undefined`). Folded into **AC5** + the sketch.
  - *"The synchronous compliance callback needs an explicit deadline" (IMPORTANT)* → **fix**:
    `AbortSignal.timeout` under Zoom's ~3 s deadline; timeout / network / non-2xx → one
    sanitized 500; at-least-once documented. Folded into **AC3** + the sketch.

## Design sketch — HOW

Follow the existing `zoom/oauth.js` shape: a thin, self-contained module, inert until its env
is set, reading `process.env` at module load.

- **`server/src/zoom/deauth.js` (new)** — exports `createDeauthRouter(deps = {})` returning an
  `express.Router()` with one `POST` handler, plus small pure helpers so the crypto is
  unit-testable without HTTP. **Dependencies are injectable** (codex finding 2):
  `{ secretToken, clientId, clientSecret, fetchImpl, now }`, defaulting to `process.env.*`,
  `globalThis.fetch`, and `Date.now` — production wiring is unchanged, but tests get a
  deterministic clock and a stub `fetchImpl` with no global mutation.
  - **Signature — a total, non-throwing predicate** (codex finding 1)
    `verifyZoomSignature({ rawBody, signature, timestamp, secretToken, nowSeconds })
    → boolean`, returning `false` (never throwing) on **every** parse/format error:
    require a **decimal integer** timestamp; enforce `Math.abs(nowSeconds − timestamp) ≤ 300`
    (rejects stale **and** future-dated); require the exact `v0=<64 lowercase hex>` shape
    **before** comparing; then `timingSafeEqual` over **equal-length** buffers.
    `expected = 'v0=' + createHmac('sha256', secretToken).update('v0:').update(timestamp)
    .update(':').update(rawBody).digest('hex')` — chained `update` calls keep `rawBody` a Buffer.
  - **Dispatch on `body.event`:** `endpoint.url_validation` → `{ plainToken, encryptedToken:
    HMAC(secretToken, plainToken) }`; `app_deauthorized` → no-op purge (comment), then the
    compliance `fetch`; unknown → 200/ignore.
  - **Compliance callback — bounded** (codex finding 3): `POST
    https://api.zoom.us/oauth/data/compliance`, `Authorization: Basic
    base64(client_id:client_secret)`, JSON body per AC3 — reusing the Basic-auth idiom already
    in `oauth.js`'s `exchangeCodeForToken` — with `signal: AbortSignal.timeout(<~2 s)`.
    Timeout / network error / non-2xx all funnel to one sanitized **500** path (Thomas: let Zoom
    retry); at-least-once across deliveries is documented, not defended against.
- **Rate limiting + body handling (ADDED 2026-07-16; reshaped round-3):** a route-local chain on
  `POST /auth/deauthorize` — **`limiter → express.raw({ limit: '100kb' }) → verify → dispatch`** —
  mounted **before** the global JSON parser so the limiter is the outermost gate (malformed /
  oversized floods are counted too). Limiter config `{ windowMs: 60_000, limit: 60 }`, a
  **constant `keyGenerator`** for a process-global ceiling, `validate: false` (constant key ⇒ the
  IP/proxy validations don't apply), overridable via a `rateLimitOptions` dep. The handler reads
  the raw `req.body` Buffer for the HMAC, then `JSON.parse`s it (guarded → 400) only **after**
  verification. A route-scoped error handler maps body-parser errors (oversized → 413) to a bare
  status so a flood can't spam stderr with stack traces.
- **`server/src/app.js`** — mount `app.use('/auth', createDeauthRouter(deauth))` **before** the
  global `express.json({ limit: '100kb' })` (now a plain parser — the old `verify` raw-capture
  hook is gone, replaced by the route-local `express.raw`); move the request logger ahead of body
  parsing (it needs only method+path) so the webhook is still logged. No change to headers,
  health, the OAuth router, or the SPA fallback.
- **Data shapes:** the inbound Zoom event (`{ event, payload: { account_id, user_id,
  client_id, user_data_retention, deauthorization_time, … } }`) and the outbound compliance
  body (AC3). No local persistence types — nothing is stored.
- **Env / config:** `ZOOM_WEBHOOK_SECRET_TOKEN` added to `server/.env.example`; the endpoint
  URL + Secret Token added to the `server/zoom-app-config.md` checklist (Deauthorization
  Notification Endpoint URL field).
- **Error model:** invalid signature/replay → 401; unconfigured → 503; callback failure → 500
  (Open question 2); success → 200. Never log secrets (AC6). No new dependency.

## Decisions — round 2 (2026-07-15, base main 63a38b5, HEAD 63a83e2)

**Both passes CLEAN — no findings, nothing to decide.**

- Approach pass (round 2): empty findings — the post-redesign shape is blessed.
- Correctness pass (its **first** run on this code at any SHA): empty findings.

No fixes were applied this round, so the code stands at HEAD 63a83e2 as reviewed. `/close`'s fork
therefore offers re-review **or** merge (this round contained no redesign).

**Still outstanding at merge time:** `BACKLOG.md` **OPS-3 → Done** — this story resolves that
tracked item, so `/close` records it (step 5b) rather than this story editing it.

## Codex review (2026-07-15, base main 63a38b5, HEAD 63a83e2)

**Summary:** CLEAN — empty findings. "No issues found. The branch matches the current acceptance
criteria: raw bytes are captured before JSON parsing; signature and timestamp formats are strictly
validated; the ±300-second replay window covers stale and future requests; HMAC comparison is
timing-safe and equal-length; URL validation produces the required token HMAC; deauthorization
performs the documented no-op purge without network access; and unconfigured operation is inert.
`git diff --check` and direct crypto checks passed."

Beyond reading the diff, the reviewer **independently executed** the pure helpers
(`zoomSignature` / `verifyZoomSignature` / `urlValidationResponse`) out-of-band and confirmed:
a valid signature verifies; a timestamp 301 s out of window is rejected; an upper-case-hex
signature is rejected; the url_validation echo is correct. *(It could not run the full gate in its
read-only sandbox — Vitest needs temp writes and the server tests need listening sockets. The gate
ran green locally: client 157, server 40, secret-scan 14, build.)*

## Codex approach review — round 2 (2026-07-15, base main 63a38b5, HEAD 63a83e2)

**Verdict:** CLEAN — empty findings. "Sound and idiomatic. I would build the revised endpoint this
way: a thin Express router, bounded global JSON parsing with raw-byte capture, Node crypto for
total HMAC verification, a ±300-second freshness window, URL-validation challenge handling, and
immediate acknowledgement after the documented no-op purge. The implementation matches Zoom's
current webhook verification and validation guidance, introduces no unnecessary dependency,
persistence, network path, or framework abstraction, and cleanly removes the deprecated callback
design without residual OAuth coupling."

Round-1's BLOCKER (the deprecated Data Compliance API) was accepted and fixed; it was explicitly
not re-raised. No findings — **the new shape is blessed**, so the correctness pass ran in the same
round (its first run on this code at any SHA).

*(Codex noted it could not re-run the gate inside its read-only sandbox — Vitest wanted to create
`client/node_modules/.vite-temp`. An environment limitation, not a finding: the gate ran green
locally — client 157, server 40, secret-scan 14, build.)*

## Decisions — round 3 review (2026-07-16, base main 63a38b5, HEAD 12d602e)

Both passes had one finding each; **both → FIX**. Both touch the rate-limiting on a public
security endpoint, and the correctness fix reshapes middleware — so this is a **shape-changing
round**: `/close` applies the fixes and the result returns for a fresh review (re-review only, no
merge offered).

- **Approach — "rate limiter keyed by proxy IP" → FIX** (Thomas: *"Make it global"*).
  Add `keyGenerator: () => 'zoom-deauthorize'` so the ceiling is genuinely process-global, plus a
  test that requests with differing apparent addresses share one bucket. **Grounded in Zoom's own
  guidance** (researched 2026-07-16): Zoom dictates **nothing** about rate-limiting the
  deauthorization endpoint — its only DoS requirement is signature verification (done) — and it
  *"strongly recommend[s] … verify webhook events instead of creating an allow list of Zoom IP
  addresses because Zoom may update the IP ranges … at any time"*
  ([Using webhooks](https://developers.zoom.us/docs/api/webhooks/)). Since Zoom's source IPs are
  explicitly unstable, a **global constant-key** ceiling is the correct model, not per-IP.
- **Correctness — "body-parser bypasses the limiter" (BLOCKER) → FIX** (Thomas: *"put the limiter
  outermost"*). Mount the webhook **before** the global `express.json()` with a route-local chain
  **limiter → bounded raw-body parse → verify → dispatch**, so malformed/oversized requests are
  counted and eventually 429, and a malformed+bad-signature request returns AC1's 401 (not 400).
  This **removes the global `express.json({ verify })` side-effect** (frame "Option A") in favour
  of route-local raw parsing (frame "Option B"). New tests cover the malformed/oversized-flood →
  429 path and the malformed+bad-sig → 401 path.

## Codex review — round 3 (2026-07-16, base main 63a38b5, HEAD 12d602e)

**Summary:** "One blocker found: malformed or oversized JSON bypasses both signature verification
and the new rate limiter because global body parsing runs first. The HMAC implementation, replay
window, raw-byte use for parsed JSON, and URL-validation response otherwise match the current
acceptance criteria." *(Codex again executed the verifier out-of-band: valid ✓, stale ✗, future ✗,
malformed ✗, url_validation HMAC correct. It couldn't run the full gate in its read-only sandbox —
sockets/temp writes denied; the gate ran green locally: client 157, server 42, secret-scan 14,
build.)*

**BLOCKER — "Body-parser failures bypass the webhook rate limiter"** (`server/src/app.js`, the
global `express.json()` at ~line 79 vs. the `/auth` router mount at ~line 134)

- *claim:* the global `express.json()` runs **before** the deauthorization router, so malformed
  JSON is rejected 400 and oversized JSON 413 **before** the route-level limiter in `deauth.js`
  runs. Repeated malformed/oversized requests never increment the limiter and never hit 429 —
  leaving a public pre-auth parsing path **outside AC10's bounded ceiling**, contradicting AC10's
  "caps even signature-rejected floods". A malformed-body request with a bad/missing signature
  also returns 400, not AC1's 401.
- *suggestion:* move this webhook **ahead of** the global JSON parser with a route-local chain:
  **rate limiter → bounded raw-body capture/parser → signature verification → dispatch**. Add
  tests showing malformed and oversized requests are counted and eventually 429; define the
  post-limit malformed-body response consistently with AC1.
- *(Note: this also removes the global `express.json({ verify })` side-effect — the round-1
  raw-body-capture choice (frame "Option A") — in favour of route-local raw parsing (frame
  "Option B"), scoping body handling to the one route that needs it.)*

## Codex approach review — round 4 (2026-07-16, base main 63a38b5, HEAD 167f3db)

**Verdict:** "The round-4 shape is fundamentally sound. Mounting the narrow deauth router and
logger before global JSON parsing does not alter `/api/*`, `/auth/callback`, static assets, or SPA
fallback behavior because unmatched requests fall through normally. The route-local
`express.raw({ type: () => true })` followed by signature verification and guarded `JSON.parse` is
the right idiom for verifying exact bytes before accepting JSON. I would build it this way, with
two small middleware-configuration corrections." Both findings two-way; the shape is blessed.

- **IMPORTANT · two-way · kludgy — "Blanket validation disablement discards useful limiter safety
  checks"** (`deauth.js`, the limiter's `validate: false`). It disables *every* express-rate-limit
  diagnostic (invalid store results, double counting, incompatible options, invalid limits, …),
  not just the IP/proxy checks. The constant `keyGenerator` already bypasses the IP key generator
  where the proxy validations run, and the config initializes cleanly with validation *enabled* —
  so the blanket suppression is unnecessary and could hide a future bad `rateLimitOptions`/store.
  - *alternative:* remove `validate: false`, keep the constant `keyGenerator`; if a specific
    warning later proves inapplicable, disable only that named validation.
  - *win:* deletes a line while restoring all config/store-integrity checks; no behavior change.
- **IMPORTANT · two-way · nonstandard — "The body-parser error handler silently absorbs unrelated
  failures"** (`deauth.js`, the 4-arg router error handler). It catches errors from the limiter,
  raw parser, *and* dispatch handler; a status-less error becomes a silent **400**, masking an
  operational failure as a client error and skipping the normal error path.
  - *alternative:* terminate only expected raw-body parser errors (`entity.too.large` etc.) with
    the bare status; `next(err)` for anything else. Keep oversized on the quiet 413 path.
  - *win:* preserves the bounded 413 response while eliminating a silent failure path and keeping
    diagnostics for genuine limiter/app defects.

## Codex approach review — round 3 (2026-07-16, base main 63a38b5, HEAD 12d602e)

**Verdict:** "The overall shape is sound and idiomatic: `express-rate-limit` is preferable to a
hand-rolled limiter, it runs before signature verification, its test ceiling is injectable, and
its memory store is adequate for a single-instance webhook. One configuration detail prevents the
claimed global ceiling from being reliably global behind Railway."

**IMPORTANT · two-way · kludgy — "The documented global ceiling is keyed by proxy IP"**
(`server/src/zoom/deauth.js`, the `validate: { trustProxy: false }` limiter config)

- *claim:* with Express `trust proxy` left false, express-rate-limit's default key generator uses
  `req.ip` — the immediate Railway proxy address, not a process-wide key. Requests via different
  proxy peers get separate 60-request buckets, so `validate: { trustProxy: false }` suppresses a
  diagnostic but does **not** create the documented global ceiling. (The MemoryStore itself is
  fine for one instance; the *keying* is the gap.)
- *alternative:* keep express-rate-limit + MemoryStore, but set an explicit constant
  `keyGenerator: () => 'zoom-deauthorize'` so the ceiling is genuinely process-global; add a test
  showing requests with different apparent addresses share one bucket.
- *win:* delivers the promised invariant (≤ limit/min per instance) without new infrastructure or
  dependency, and removes reliance on Railway's proxy topology.

The prior accepted history (round-1 deprecated-callback removal; round-2 clean) was not
re-raised. This is the sole finding; the shape is otherwise blessed.

## CI blocker + Decisions — round 3 (2026-07-16)

The round-2 merge attempt (`/close`) was **blocked by CI**, not shipped: CodeQL raised **1 new
high-severity alert** — `js/missing-rate-limiting` at `server/src/zoom/deauth.js` (the
`POST /auth/deauthorize` handler *"performs authorization, but is not rate-limited"*). Legitimate:
the endpoint is public and does an HMAC before it can reject, and Zoom's own guidance says to
guard the deauthorization URL against DoS. Auto-merge was disarmed; nothing merged.

- **Decision → fix by adding `express-rate-limit`** (Thomas: *"Add express-rate-limit"*). This
  **reverses the "no new dependency" non-goal**, which both approach passes had blessed — hence a
  fresh review round rather than a silent merge-time patch. Scoped limiter on the route (before
  verification), injectable ceiling for tests; new **AC10**; non-goal + AC8 + sketch updated.
- *Pre-existing (out of scope, noted):* `main` already carries open CodeQL alerts —
  `js/missing-rate-limiting` at `app.js:124` (the SPA fallback), `js/clear-text-logging`
  (`index.js:18`), `js/insecure-temporary-file` (`loadEnv.test.js:12`), `js/log-injection`
  (`app.js:84`). CodeQL only *fails the PR* on **new** alerts, which is why those merged earlier.
  Worth a separate pass before Zoom's manual OWASP security review — not this story.

**Route:** shape changed (new dependency + middleware) on security-relevant code → back through
`/review` for a fresh approach + correctness pass before any merge. Not merged this round.

*Note: `BACKLOG.md` OPS-3 → Done was already recorded on the branch during the interrupted round-2
`/close` (commit `record: OPS-3 -> Done`); it rides to `main` on the eventual merge.*

## Fixes — round 3 (2026-07-16)

Applied both approved round-3 fixes. **Shape-changing** (middleware reordered + parser swapped),
so this returns for a fresh review — re-review only, no merge.

- **Approach fix — limiter now global.** `server/src/zoom/deauth.js`: `keyGenerator: () =>
  'zoom-deauthorize'` → one process-global bucket; `validate: false` (constant key, so the
  IP/proxy validations are moot). Test: differing apparent addresses share one bucket (covered by
  the malformed/oversized flood tests, which trip the single global ceiling regardless of source).
- **Correctness BLOCKER — limiter is now the outermost gate.** `server/src/app.js`: the deauth
  router is mounted **before** the global `express.json`, and the request logger moved ahead of
  body parsing (kept the webhook logged). The old global `express.json({ verify })` raw-capture
  hook is **removed** — `express.json` is a plain parser again. `deauth.js`: the route is now
  `limiter → express.raw({ type: () => true, limit: '100kb' }) → handler`; the handler verifies
  the HMAC over the raw `req.body` Buffer, then `JSON.parse`s (guarded → 400) only after
  verification. Malformed/oversized floods now reach the limiter and 429.
- **Log-hygiene (part of the reshape).** A route-scoped 4-arg error handler maps body-parser
  errors (oversized → 413) to a bare status, so an oversized-body flood can't spam stderr with
  `PayloadTooLargeError` stack traces (the noise the naive reorder introduced).
- **Tests:** +3 (server 42 → 45) — malformed-flood → 429, oversized-flood → 429, and a
  validly-signed-but-malformed body → 400. Gate green (client 157, server 45, secret-scan 14,
  build); CI CodeQL stays clear.

## Fixes (2026-07-15)

Applied the two approved decisions. **This is a redesign** — the shape changed, so it returns for
a fresh review (approach pass re-runs) rather than merging.

- **BLOCKER "deprecated Data Compliance API" → fixed (redesign).**
  - `server/src/zoom/deauth.js`: deleted `COMPLIANCE_URL`, `CALLBACK_TIMEOUT_MS`,
    `complianceBody`, the Basic-auth construction, the `fetch`/`AbortSignal`/timeout/error
    handling, and the `clientId` / `clientSecret` / `fetchImpl` deps. `app_deauthorized` (and any
    other non-handshake event) is now **verify → no-op purge → 200**; the handler is no longer
    `async`. The module header records *why* the callback is absent, with the sources, so it
    isn't re-added. **Kept unchanged:** `zoomSignature`, `verifyZoomSignature` (the hardened
    total predicate), `SIGNATURE_SHAPE`, `REPLAY_WINDOW_SECONDS`, `urlValidationResponse`.
  - `server/src/app.js`: `createApp`'s `deauth` deps comment narrowed to `secretToken / now`.
    The `express.json({ verify })` raw-body capture and the `/auth` mount are unchanged.
  - `server/test/deauth.test.js`: dropped 3 tests — non-2xx → 500, abort/timeout → 500, and the
    per-credential (`Basic undefined:undefined`) 503 case — plus the `stubFetch` / `CLIENT_ID` /
    `CLIENT_SECRET` harness. The compliance-shape test became a plain "acknowledged 200", and AC6
    no longer asserts on the Basic header. **15 deauth tests remain** (was 18; server suite
    43 → 40), keeping all of the verification/replay/handshake value.
  - `server/zoom-app-config.md`: the deauthorization section now documents verify → purge → 200
    and states the callback is deprecated (with the source) so a future reader doesn't restore it.
  - Spec: **AC3** revised, **AC4** extended (no network), **AC5** trimmed, **AC8** widened.
- **Doc drift → fixed.** `BACKLOG.md` (OPS-3) and `reviews/backlog.md` no longer assert the
  compliance callback; both carry a dated correction citing Zoom's deprecation and the
  still-required endpoint. (The outdated memory `reference-zoom-prod-unknowns-research` was
  corrected separately — not repo scope.)

## Codex approach review (2026-07-15, base main 63a38b5, HEAD 6b6efdd)

**Verdict:** "I would keep the signed, raw-body-verified `/auth/deauthorize` route and
URL-validation handshake, but I would not build the compliance-callback half. The spec is based
on a retired Zoom workflow and must be corrected before merge."

**BLOCKER · two-way · dated — "The design is centered on Zoom's deprecated Data Compliance API"**
(`server/src/zoom/deauth.js:20`)

- *claim:* Zoom's Data Compliance API is deprecated and `user_data_retention` was removed;
  current deauthorization guidance requires receiving the signed event and deleting user data,
  but **not** a compliance callback. So `app_deauthorized` is coupled to an obsolete endpoint —
  an inoperative/non-2xx response becomes a 500 and invites repeated webhook delivery instead of
  completing deauthorization. The outdated requirement originates in **AC3** and must be revised,
  not preserved merely because the implementation matches it.
- *alternative:* retain signature verification, the replay window, and `endpoint.url_validation`.
  For a valid `app_deauthorized`, do the documented no-op purge and **immediately acknowledge
  200/204**. Delete `COMPLIANCE_URL`, `CALLBACK_TIMEOUT_MS`, `complianceBody`, the Basic-auth
  construction, fetch/timeout/error handling, the OAuth-credential gating, the callback tests, and
  the callback documentation; update AC3.
- *win:* removes an obsolete external call and its retry/failure path, drops the route's
  needless dependency on OAuth credentials and `fetch`, and deletes ~50 production lines plus
  several tests while preserving the actual Marketplace requirement.

**Independent verification (Claude, 2026-07-15) — CONFIRMED.** The claim contradicted this repo's
own research memory (`reference-zoom-prod-unknowns-research`, 2026-06-10, which recorded the
callback as mandatory), so it was checked against primary sources rather than taken on faith:

- **The endpoint itself is still required** — Zoom, [End user authorization](https://developers.zoom.us/docs/integrations/end-user-auth/):
  *"All apps made available to end users must provide the proper ability for users to remove or
  deauthorize the app and receive deauthorization notifications from Zoom."* → **OPS-3's premise
  holds; the story survives.**
- **The compliance callback is not** — official Zoom staff, [Data Compliance API Deprecated](https://devforum.zoom.us/t/data-compliance-api-deprecated/51768):
  *"our Data Compliance endpoint is now deprecated. This means that it is no longer required to
  call this endpoint."* Zoom's announcements add that it will be *"completely inoperative in a
  future release"* and that *"the marketplace app submission & review process no longer includes
  this requirement"*.
- **The signature half as built is current** — the old webhook *verification token* was sunset
  (Oct 2023) in favour of exactly the secret-token + `x-zm-signature` scheme implemented here.

**Consequence beyond the diff:** the memory `reference-zoom-prod-unknowns-research`, the OPS-3 entry
in `BACKLOG.md`, and the deauth notes in `reviews/backlog.md` all still describe the callback as
mandatory — they are now outdated and should be corrected.

## Decisions (2026-07-15, base main 63a38b5, HEAD 6b6efdd)

Approach pass — 1 BLOCKER:

- **BLOCKER "The design is centered on Zoom's deprecated Data Compliance API"** → **FIX**
  (Thomas: *"Fix — delete the callback half"*). A **redesign**: `app_deauthorized` becomes
  **verify → no-op purge → 200**. Delete `COMPLIANCE_URL`, `CALLBACK_TIMEOUT_MS`,
  `complianceBody`, the Basic-auth construction, the `fetch`/timeout/error handling, the
  OAuth-credential gating (`clientId` / `clientSecret` / `fetchImpl` deps), the callback tests,
  and the callback documentation. **Keep** the endpoint, HMAC signature verification, the ±300 s
  replay window, `endpoint.url_validation`, and the no-op purge. **AC3 is revised** (its
  compliance-callback requirement was the stale premise), **AC5** loses its per-credential arm
  (no OAuth creds needed anymore), and **AC8** widens per the doc decision below.
  - *Note:* this retires two of the three earlier design fixes — the `AbortSignal` timeout and
    the per-credential 503 existed **only** to serve the callback. The verifier hardening
    (the design-review BLOCKER) stands unchanged and is unaffected.
- **Doc drift** → **fix in this story** (Thomas: *"Yes — correct them here"*). `BACKLOG.md`
  (OPS-3) and `reviews/backlog.md` both still state the compliance callback is mandatory; both
  are corrected to match verified reality (endpoint required; callback deprecated). **AC8's file
  list widens** to include them. The outdated memory
  `reference-zoom-prod-unknowns-research` is corrected separately (not repo scope).

**Route:** per the approach gate, an approved shape-changing fix **stops this round before the
correctness pass** — the redesign is applied in `/close` and the new shape returns for a fresh
review (whose approach pass re-runs on it). No correctness pass was run at HEAD 6b6efdd.

## Build note (2026-07-15, revised post-redesign at HEAD 63a83e2)

AC → file map. *(Revised: the round-1 map pointed AC3 at `complianceBody` / `COMPLIANCE_URL` /
`CALLBACK_TIMEOUT_MS` and AC5 at a client-id/secret guard — all deleted by the approved redesign.
Restated here against the current code so the map doesn't misdirect.)*

- **AC1** (total, non-throwing signature gate; 401 never 500) — `server/src/zoom/deauth.js`
  (`verifyZoomSignature` + `SIGNATURE_SHAPE` + `REPLAY_WINDOW_SECONDS`),
  `server/test/deauth.test.js` (wrong/missing/tampered/malformed/stale/future/non-integer cases).
- **AC2** (url_validation handshake) — `server/src/zoom/deauth.js` (`urlValidationResponse`),
  `server/test/deauth.test.js`.
- **AC3 revised** (acknowledge 200; **no** compliance callback) — `server/src/zoom/deauth.js`
  (the terminal `res.sendStatus(200)` + the module header explaining the deprecation),
  `server/test/deauth.test.js` (`app_deauthorized` → 200; unknown event → 200).
- **AC4** (no-op purge; no persistence, no network) — `server/src/zoom/deauth.js` (module header
  + the `--- PURGE GOES HERE ---` marker; imports are only `node:crypto` + `express`).
- **AC5 trimmed** (inert when unconfigured: 503) — `server/src/zoom/deauth.js` (the secret-token
  guard), `server/test/deauth.test.js` (503 + `/api/health` unaffected).
- **AC6** (no secret leakage) — `server/src/zoom/deauth.js` (no logging of secrets; the callback's
  `console.error` paths are gone entirely), `server/test/deauth.test.js` (console-capture assertion).
- **AC7** (docs) — `server/.env.example` (`ZOOM_WEBHOOK_SECRET_TOKEN`),
  `server/zoom-app-config.md` (deauthorization section: endpoint URL, Secret Token, and the
  "no compliance callback — deprecated" note).
- **AC8 widened** (scope containment) — diff touches only `server/src/zoom/deauth.js`,
  `server/src/app.js`, `server/test/deauth.test.js`, `server/.env.example`,
  `server/zoom-app-config.md`, `BACKLOG.md`, `reviews/backlog.md`, plus this story file and the
  review artifacts.
- **Wiring** — `server/src/app.js` (`express.json({ verify })` raw-body capture; `/auth`
  router mount; `createApp({ deauth })` dep injection, now `secretToken` / `now` only).
- **AC9** (gate green) — implicit (this review exists).

**Round-3 delta (2026-07-16, HEAD 12d602e):**
- **AC10** (rate-limited; 429 past the ceiling; guard before verification) —
  `server/src/zoom/deauth.js` (`DEFAULT_RATE_LIMIT`, the `rateLimit(...)` limiter applied as
  `router.post('/deauthorize', limiter, …)`, `rateLimitOptions` dep), `server/test/deauth.test.js`
  (two AC10 tests). **Dependency:** `server/package.json` (`express-rate-limit`) + root
  `package-lock.json`.
- **AC8** now also covers `server/package.json` + `package-lock.json` (see the widened AC8).

**Round-4 delta (2026-07-16, HEAD 167f3db — the reshape):**
- **AC10** (limiter outermost; malformed/oversized floods counted; global key) —
  `server/src/app.js` (deauth router mounted before global `express.json`; logger moved ahead of
  parsing; `verify` hook removed), `server/src/zoom/deauth.js` (route-local `limiter →
  express.raw → verify → JSON.parse → dispatch`, constant `keyGenerator`, route-scoped
  body-parser error handler), `server/test/deauth.test.js` (+3: malformed-flood 429,
  oversized-flood 429, signed-malformed 400).
- **AC1** (malformed handling) — a validly-signed-but-malformed body → 400 (post-verify parse
  guard); an unsigned malformed body still → 401.

## Codex design review (2026-07-14)

**Verdict:** sound shape. "Express router, Node crypto, raw-body verification, no persistence,
and no new dependency. I would build it this way after tightening the verifier contract, making
configuration/side effects injectable, and bounding the synchronous callback to Zoom's webhook
deadline." All findings two-way; no one-way doors.

**Findings**

- **BLOCKER · two-way · nonstandard — "The verifier does not safely define hostile-header
  handling"** (Design sketch → Signature). `timingSafeEqual` throws on unequal-length buffers,
  so an attacker-controlled malformed `x-zm-signature` becomes a 500 instead of AC1's 401; the
  sketch also rejects only *old* timestamps (arbitrary *future*-dated signed requests pass) and
  doesn't require a finite integer timestamp.
  - *alternative:* make verification a **total, non-throwing predicate** — require a decimal
    integer timestamp, enforce `Math.abs(nowSeconds − timestamp) ≤ 300`, require the exact
    `v0=<64 lowercase hex>` shape, compare **equal-length** buffers with `timingSafeEqual`, and
    return `false` on every parse/format error. Chain `update` calls so `rawBody` stays a Buffer.
  - *win:* every malformed/replay request follows the single 401 path; no attacker-triggerable
    500s; closes the future-timestamp gap.
- **IMPORTANT · two-way · kludgy — "Module-load configuration and global fetch stubbing create
  avoidable test coupling"** (Design sketch → `deauth.js`). Reading creds at module load (à la
  `oauth.js`) plus stubbing global `fetch` pushes tests toward cache-busting imports / global
  mutation that can race under `node:test`; and 503 is defined only for a missing webhook token,
  leaving `app_deauthorized` underspecified when client id/secret are absent.
  - *alternative:* `createDeauthRouter` accepts optional `{ secretToken, clientId, clientSecret,
    fetchImpl, now }` with `process.env` / `globalThis.fetch` / `Date.now` as production
    defaults; permit url_validation with just the webhook token, but 503 before
    `app_deauthorized` processing when callback creds are incomplete.
  - *win:* deterministic clock/failure tests, no global mutation, and no `Basic undefined:undefined`
    request — with no change to production wiring or dependencies.
- **IMPORTANT · two-way · nonstandard — "The synchronous compliance callback needs an explicit
  deadline"** (Design sketch → Error model / Compliance callback). Zoom expects a 200/204 within
  ~3 s and retries; an unbounded `fetch` can outlive that, so Zoom retries while the first
  callback may still be in flight.
  - *alternative:* keep the synchronous/500 retry policy but give `fetch` an `AbortSignal`
    timeout comfortably below 3 s, mapping timeout / network error / non-2xx to the same
    sanitized 500; document at-least-once semantics under Zoom retries.
  - *win:* bounds every request, preserves Zoom's retry, removes the largest duplicate-callback
    window — no queue, store, or dependency.
