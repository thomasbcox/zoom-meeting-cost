Date: 2026-07-24 · Branch: claude/presubmit-fixes · Status: approved

# presubmit-fixes — clear the agreed findings from the submission critique

## Problem
An external pre-submission critique (assessed 2026-07-24) raised eight points. Six are
confirmed-accurate against the code and worth fixing before a public Marketplace submission;
this story fixes exactly those. The three overstated/nuanced points are explicitly out of scope
(see Non-goals). The fixes span docs, one dependency bump, dead-code removal, and two small
server-side security hardenings.

The agreed findings:
- **Cadence mismatch** — the listing + reviewer test plan promise a "1 min" update option, but
  the app only offers 1 s / 10 s (`DISPLAY_INTERVALS = [1, 10]`). A functional reviewer
  following the test plan hits this immediately.
- **Panel-close doc wrong** — `docs/documentation.html` says closing the panel "pauses the
  meter"; BUG-1's live finding was that a normal close **hides** the panel and the meter keeps
  running.
- **Diagnostics probe reads participants** — the `?diag=1` probe (`zoomDiagnostics.js`) calls
  `getMeetingParticipants`, shipped in the prod bundle, contradicting the "never reads
  participants" claim in the listing/privacy/TDD. (`getMeetingContext` is a declared-but-unused
  capability, referenced only by that probe.)
- **body-parser advisory** — `npm audit --omit=dev` flags `body-parser <1.20.6` (low-sev DoS,
  GHSA-v422-hmwv-36x6); patch available.
- **`/api/log` unthrottled** — public endpoint accepting arbitrary JSON with a 100 kb cap but no
  rate limiting; a flood can bloat the logs.
- **OAuth lacks `state` + leaks upstream error** — `/auth/install` sends no `state`
  (no login-CSRF protection); `/auth/callback` returns Zoom's raw upstream error text to the
  browser.

## In scope
- Docs: `dev-docs/marketplace-submission/listing-copy.md`,
  `dev-docs/marketplace-submission/reviewer-test-plan.md`, `docs/documentation.html`.
- Remove the diagnostics probe: `client/src/zoom/zoomDiagnostics.js` (+ its test),
  `client/src/main.jsx` (drop the import/call), `client/src/zoom/zoomAdapter.js` (drop
  `getMeetingContext` from `ZOOM_CAPABILITIES`).
- Dependency: bump `body-parser` to the patched version (lockfile).
- Update any capability-list test touched by the `getMeetingContext` removal.

## Non-goals
**Deferred — agreed-real, descoped 2026-07-24 (Thomas: "do four now, defer the other two"); filed to `reviews/backlog.md`:**
- **OAuth `state` + generic errors (⑦)** — the OAuth flow is a token-discarding scaffold
  (`/auth/callback` runs `void token`), so no session or account-binding is established → no
  exploitable CSRF surface today. Harden when real OAuth (token persistence) is built, or if the
  Marketplace security audit flags it. The design is already scoped (see the deferred backlog item).
- **`/api/log` rate limiting (④)** — low-value log endpoint (worst case: log noise/cost, no data
  exposure). Add if abused or if the audit flags it.

**Not agreed — overstated in the critique:**
- **Privacy "contradiction" (⑤)** — no change. The privacy policy already discloses operational
  logging (retained a limited period, operator-only) and scopes its absolute claims to
  configuration/overlay data; there is no contradiction. Adding an exact retention number is a
  possible future enhancement, not a fix.
- **Production-credential reviewer test (⑧)** — not doable pre-submission: production credentials
  have no install path until the app is published. Out of scope.
- **App icon (②)** — already uploaded to the Marketplace (Thomas). No repo change.
- **Domain verification (②/#5)** — tracked separately as task #5 (Marketplace-side); not a code
  change here.
- No functional change to the meter, overlay, cost math, or cadence set (still {1, 10}).

## Acceptance criteria
1. No shipped (non-test) client code references `getMeetingParticipants`: `zoomDiagnostics.js` and
   its test are deleted, `main.jsx` no longer imports or calls `maybeRunZoomDiagnostics`, and no
   `?diag` path remains. A production-source grep (excluding `*.test.*`) returns nothing; the only
   remaining reference is the intentional `zoomAdapter.test.js` negative assertion that the
   capability is *not* requested.
2. `getMeetingContext` is removed from `ZOOM_CAPABILITIES` in `client/src/zoom/zoomAdapter.js`
   (it was referenced only by the removed probe); any test asserting the capability set is
   updated to match.
3. The listing and reviewer test plan no longer claim a 1-minute cadence — they state **1 s / 10 s**
   only, matching `DISPLAY_INTERVALS`.
4. `docs/documentation.html` correctly states that a normal panel close **hides** the panel while
   the meter keeps running (per BUG-1), not that it pauses the meter.
5. `npm audit --omit=dev` reports **0 vulnerabilities**; the gate (`npm test && npm run build`)
   stays green.
6. Scope containment: `git diff --name-only main...HEAD` shows no files beyond those the In-scope
   list enumerates (plus `package-lock.json` for the dep bump and the `reviews/presubmit-fixes.*`
   workflow artifacts).

## Test notes
- **AC1/AC2:** grep assertion (no `getMeetingParticipants` in `client/src`); the client suite
  stays green with the probe + its test removed; update/confirm any `ZOOM_CAPABILITIES` test.
- **AC3/AC4:** doc greps — no "1 min"/"1-minute" in the two submission docs; documentation.html
  no longer says "pauses the meter" on close.
- **AC5:** `npm audit --omit=dev` → 0; gate green.
- **Gate:** `npm test && npm run build`.

## Open questions
1. **RESOLVED — scope (2026-07-24):** Thomas chose "four now, defer the other two." OAuth
   `state` + `/api/log` rate limiting are out (deferred to backlog). See Scope decision.
2. **Dashboard sync (not code):** removing `getMeetingContext` from the code capability list
   means it should also be removed from the Marketplace **Features → Add APIs** list to stay in
   sync. That's Thomas's dashboard action — confirm alongside the merge.

## Design sketch — HOW
- **Docs (AC3/AC4):** text edits only. Change "(1s / 10s / 1 min)" → "(1 s / 10 s)" in the two
  submission docs; rewrite the documentation.html sentence to "closing the panel hides it; the
  meter keeps running" (matching BUG-1).
- **Diag removal (AC1/AC2):** delete `zoomDiagnostics.js` + `zoomDiagnostics.test.js`; remove the
  `maybeRunZoomDiagnostics` import + call from `main.jsx`; drop `'getMeetingContext'` from
  `ZOOM_CAPABILITIES`. Confirmed safe: the probe is imported only by `main.jsx`, and every
  `postLog` consumer imports it from `lib/postLog.js` (not the probe's re-export), so nothing
  dangles.
- **body-parser (AC5):** `npm audit fix` (or a targeted `body-parser` bump) to reach ≥ 1.20.6;
  regenerate the lockfile; verify `npm ci` accepts it and the gate is green.

## Codex design review (2026-07-24)
**Verdict:** "The overall shape is lean and repo-consistent: delete the diagnostic path, make
narrow documentation edits, update the transitive dependency through the lockfile, and reuse
`express-rate-limit`. I would build it this way after tightening the OAuth state verifier and
cookie contract; neither requires a new dependency." *(Both findings are on the OAuth sub-part
only; the other five fixes are blessed as-is.)*

**IMPORTANT — two-way × nonstandard — "State comparison is not a total, non-throwing predicate."**
The sketch calls `timingSafeEqual` on the cookie vs `req.query.state` without constraining types
or lengths. Express query values can be arrays/non-strings, cookies are attacker-controlled, and
`timingSafeEqual` **throws on unequal byte length** — so an ordinary mismatch could 500 instead of
AC7's required 400.
- *Alternative:* a small verifier accepting only two non-empty strings → buffers → `false` on
  length diff → `timingSafeEqual` inside a non-throwing path; every absent/duplicate/malformed/
  array/mismatch value → the same 400 **before** token exchange; clear the state cookie on every
  terminal callback path. *(This mirrors the existing `verifyZoomSignature` total-predicate
  pattern in `deauth.js`.)*
- *Win:* removes an attacker-triggerable exception path; centralizes AC7's "every invalid state
  rejected before token exchange" invariant.

**IMPORTANT — two-way × nonstandard — "The OAuth cookie omits the modern secure-cookie boundary."**
The sketch's cookie is `httpOnly; SameSite=Lax; short Max-Age` but not `Secure`, no explicit
`Path`, no host prefix — so it could travel over HTTP and is open to path/domain shadowing.
- *Alternative:* an opaque `__Host-zoom-oauth-state` cookie with
  `Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=<short>` and no `Domain`; use Express's
  built-in `res.cookie`/`res.clearCookie` for serialization (no hand-built `Set-Cookie`), with a
  narrow defensive parser only for the inbound read. (Refs: MDN secure-cookie guidance; RFC 9700
  OAuth 2.0 Security BCP.)
- *Win:* keeps the CSRF cookie off plaintext HTTP and blocks cookie shadowing, using an existing
  Express construct, no new dependency.

## Fixes (2026-07-25)
- **① config doc out of sync:** removed `getMeetingContext` from the authoritative
  capability list in `server/zoom-app-config.md` (§"Zoom Apps SDK capabilities to enable"), so
  the doc no longer instructs enabling a capability the code dropped. `server/zoom-app-config.md`
  added to scope per the decision.
- **② AC1 grep + dead stub:** removed the obsolete fake-SDK `getMeetingParticipants` method from
  `client/src/zoom/zoomAdapter.test.js` (plus its now-orphaned `participantsReject`/`participants`
  factory params and the lone `participants: []` caller). Kept the intentional negative assertion
  (line 30). Reworded AC1 to a production-source grep (excluding `*.test.*`).

## Decisions (2026-07-25)
Thomas: "fix as recommended."

- **① Authoritative capability doc out of sync:** **FIX.** Add `server/zoom-app-config.md` to
  scope and remove `getMeetingContext` from its "must match `ZOOM_CAPABILITIES` exactly"
  capability list (the doc currently instructs re-enabling a capability we dropped).
- **② AC1 grep + dead stub:** **FIX.** Remove the obsolete fake-SDK `getMeetingParticipants`
  stub from `zoomAdapter.test.js` (RealZoom no longer calls it; keep the intentional negative
  assertion at line 30); reword AC1 to a production-source grep so the negative assertion is not
  fought.
- **Approach pass:** clean — nothing to decide.

## Codex review (2026-07-25, base main, HEAD b526e34)
**Summary:** "The implementation largely matches the four approved fixes, but it leaves the
authoritative Marketplace capability documentation inconsistent with the runtime configuration,
and AC1's prescribed grep still fails because participant-method references remain in client
tests."

### IMPORTANT
**① Authoritative capability list remains out of sync** — `client/src/zoom/zoomAdapter.js:30` → `server/zoom-app-config.md:121`
- *Claim:* the diff removes `getMeetingContext` from `ZOOM_CAPABILITIES`, but
  `server/zoom-app-config.md` still calls its API list authoritative ("must match
  `ZOOM_CAPABILITIES` exactly") and instructs operators to **enable** `getMeetingContext` — so
  following the repo guidance would re-add it in the dashboard, contradicting this change.
- *Suggestion:* add `server/zoom-app-config.md` to scope and remove `getMeetingContext` from its
  capability list; then do the noted Marketplace dashboard removal.

**② AC1's required grep assertion still fails** — `client/src/zoom/zoomAdapter.test.js:30, ~217`
- *Claim:* AC1 requires `grep -rn getMeetingParticipants client/src` to return nothing, but it
  finds the intentional negative assertion (line 30) and an obsolete fake-SDK
  `getMeetingParticipants` method (~217–220). Test-only — no shipped privacy regression — but the
  literal AC check isn't met.
- *Suggestion:* remove the obsolete fake-SDK method if unused; reconcile AC1 to a
  production-source grep (the negative assertion is intentional and should stay).

*(No BLOCKER/QUESTION/NIT. The reviewer's "couldn't rerun the gate/npm audit" note is its own
sandbox — our gate + CI are green.)*

## Codex approach review (2026-07-25, base main, HEAD 63b9f33)
**Verdict:** "The approach is sound, lean, and idiomatic. It deletes the diagnostic subsystem,
removes its capability and startup wiring, applies literal documentation corrections, and updates
transitive dependencies through the existing lockfile without adding abstractions or
dependencies. I would build it this way."

**Findings: none** (empty array) — shape blessed; proceeded to the correctness pass in the same
round. *(The reviewer's "runtime verification was environment-limited" note is its own read-only
sandbox — our gate + CI are green.)*

## Build note (2026-07-24)

| AC | What | File(s) |
|---|---|---|
| 1 | Diag probe removed — no shipped code references `getMeetingParticipants` | `client/src/zoom/zoomDiagnostics.js` (del), `client/src/zoom/zoomDiagnostics.test.js` (del), `client/src/main.jsx` |
| 2 | `getMeetingContext` dropped from `ZOOM_CAPABILITIES` + locked with a negative assertion | `client/src/zoom/zoomAdapter.js`, `client/src/zoom/zoomAdapter.test.js` |
| 3 | Cadence stated as 1 s / 10 s (no "1 min") | `dev-docs/marketplace-submission/listing-copy.md`, `dev-docs/marketplace-submission/reviewer-test-plan.md` |
| 4 | Panel-close corrected (hides; meter keeps running) | `docs/documentation.html` |
| 5 | `body-parser` → 1.20.6; `npm audit --omit=dev` clean | `package-lock.json` |
| 6 | Scope containment | _scope check — no file_ |

## Scope decision (2026-07-24)
Thomas: "do four now and defer the other two." Approved scope = **four fixes**: cadence docs,
panel-close doc, diag-probe removal (+ `getMeetingContext`), body-parser bump. **Deferred:** OAuth
`state`/generic-errors and `/api/log` rate limiting — filed to `reviews/backlog.md`, to be done
only if the security audit flags them (rationale: the OAuth flow is a token-discarding scaffold
with no exploitable CSRF surface; `/api/log` is a low-value log endpoint).

## Design decisions (2026-07-24)
- **Both codex design-review findings** (state-comparison total-predicate; `__Host-` secure-cookie
  boundary) were on the OAuth sub-part, which is now **out of scope → both MOOT for this story.**
  They are preserved above and referenced from the deferred backlog item, so the design is ready
  when OAuth hardening is picked up.
- The **four in-scope fixes** drew no design findings (blessed as-is) — the story is a clean
  scope-nod.
