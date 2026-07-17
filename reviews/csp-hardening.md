Date: 2026-07-17 · Branch: claude/csp-hardening · Status: approved

# CSP hardening — narrow connect-src to same-origin, resolve frame-ancestors

Backlog item: **"CSP hardening — pin to exact origins"** (`reviews/backlog.md`,
deferred 2026-06-03). This story reopens it, and the research below materially
reframes what "done" is.

## Problem

`server/src/app.js` sets one CSP for every response. Two directives still carry
broad Zoom wildcards left over from an earlier, more networked design:

```
connect-src 'self' https://*.zoom.us https://*.zoom.com
frame-ancestors 'self' https://*.zoom.us https://*.zoom.com
```

The backlog item asks to "pin to exact origins." Two facts, both verified this
session, change the picture from what the 2026-06-03 note assumed:

1. **`connect-src` no longer needs Zoom at all.** The client's *entire*
   cross-origin network surface is a single **same-origin** call:
   `fetch('/api/log')` (`client/src/lib/postLog.js`). There is no other `fetch`,
   no `sendBeacon`, no `EventSource`, no cross-origin request anywhere in
   `client/src`. The `@zoom/appssdk` is **bundled** (`await import('@zoom/appssdk')`)
   and talks to the Zoom client host via **`postMessage`**, which CSP `connect-src`
   does **not** govern. The old `wss:` WebSocket that once justified a Zoom allowance
   was removed in the dead-simple pivot. So `connect-src 'self'` is sufficient — and
   it is exactly what Zoom's own recommended Zoom-App CSP uses.

2. **`frame-ancestors` cannot be pinned to "exact origins."** Zoom does **not**
   publish an exact list of embedding origins, its official recommended CSP for
   embedded apps **omits `frame-ancestors` entirely**, and Zoom staff explicitly
   warn against restrictive frame-ancestors (the embedding parent differs across
   desktop / web-PWA / mobile clients). The current
   `frame-ancestors 'self' https://*.zoom.us https://*.zoom.com` is therefore
   already *tighter* than Zoom's own guidance (which leaves embedding unrestricted),
   and narrowing it further to guessed exact origins risks a blank screen in some
   Zoom surface — a failure only a live in-Zoom test would catch.
   (Sources: Zoom OWASP headers doc; Zoom Developer Forum "appropriate CSP for
   embedding" thread.)

Net: the real, safe hardening here is **connect-src → `'self'`**. The
frame-ancestors half of the old backlog item resolves to a documented *decision to
leave as-is*, not a code change.

## In scope

_(Scope: **all four add-ons** — Thomas's consult decision, 2026-07-17.)_

1. Narrow `connect-src` in `server/src/app.js` CSP from
   `'self' https://*.zoom.us https://*.zoom.com` to `'self'`.
2. Add four hardening directives to the same `CSP` array:
   `object-src 'none'`, `frame-src 'none'`, `worker-src 'none'`, and
   `upgrade-insecure-requests`. (The app has no `<object>`/`<embed>`, embeds no
   iframes, and uses no web workers; `upgrade-insecure-requests` is defense-in-depth.)
3. Update the `CSP` block comment in `server/src/app.js` to record the new
   rationale (only same-origin `/api/*`; SDK uses postMessage; wildcards retired;
   the four added denies) and to record *why `frame-ancestors` keeps its Zoom
   wildcards* (Zoom documents no exact origins; tighter risks breakage).
4. Update `server/test/headers.test.js` so the CSP-content assertions match:
   `connect-src` is exactly `'self'` with **no** `zoom.us`/`zoom.com`, and the four
   new directives are present. Keep the existing `frame-ancestors` assertions
   (unchanged).
5. Update the backlog entry (`reviews/backlog.md`) to reflect the connect-src
   narrowing + added denies done, and the frame-ancestors decision.

## Non-goals

- **Not narrowing `frame-ancestors` to exact origins** — Zoom documents none and
  advises against it (see Problem). It keeps `'self' https://*.zoom.us https://*.zoom.com`.
- **Not touching `script-src`** — stays `'self'`. The SDK is bundled, not loaded
  from `appssdk.zoom.us`, so Zoom's `script-src … appssdk.zoom.us` allowance is not
  needed and would only widen the policy.
- **Not moving `default-src` from `'self'` to `'none'`** — the strictest posture
  needs every resource type enumerated and is higher-breakage; out of scope for a
  wildcard-pinning story.
- **Not adding Cross-Origin-Embedder-Policy / -Resource-Policy** — Zoom recommends
  these, but they are separate headers (not CSP) and `COEP: require-corp` can break
  embedding; a distinct concern for its own item.

## Acceptance criteria

1. The served CSP's `connect-src` directive is exactly `connect-src 'self'` — no
   `*.zoom.us` / `*.zoom.com` / bare `https:` / `wss:`.
2. The served CSP still renders the app: `default-src 'self'`, `script-src 'self'`,
   `style-src 'self' 'unsafe-inline'`, `img-src`/`font-src`, `base-uri 'self'`,
   `form-action 'self'`, and `frame-ancestors 'self' https://*.zoom.us https://*.zoom.com`
   are all still present and unchanged.
3. The served CSP additionally contains `object-src 'none'`, `frame-src 'none'`,
   `worker-src 'none'`, and `upgrade-insecure-requests`.
4. `server/test/headers.test.js` asserts the tightened `connect-src` (exactly
   `'self'`, no Zoom hosts) and the four new directives, and the gate
   (`npm test && npm run build`) passes.
5. The `server/src/app.js` CSP comment records the connect-src rationale, the four
   added denies, and the frame-ancestors keep-as-is decision.
6. The backlog item is updated to reflect what shipped and what was decided.
7. (Human) Live in-Zoom smoke: app still renders and the `/api/log` sink still
   receives client logs inside the real Zoom client. Owned by Thomas — cannot be
   closed by the automated gate.

## Test notes

- **AC1 / AC2 / AC3 / AC4:** `server/test/headers.test.js` fetches `/api/health`
  (always 200, never hits the SPA fallback, so the CSP is delivered intact) and
  asserts the `content-security-policy` header. Add an exact-match assertion for
  `connect-src 'self'` (directive-bounded — `connect-src 'self'` followed by `;` or
  end-of-string) and keep the existing negative guards
  (`!/connect-src[^;]*\bzoom\./`, no `wss:`, no bare `https:`). Add presence
  assertions for `object-src 'none'`, `frame-src 'none'`, `worker-src 'none'`, and
  `upgrade-insecure-requests`. Existing frame-ancestors assertions stay green
  unchanged. `npm test` runs this; `npm run build` confirms the client still builds.
- **AC5 / AC6:** inspection of the diff — comment present in `app.js`, backlog
  entry updated. Run `git diff --name-only main...HEAD` and verify no files appear
  beyond: `server/src/app.js`, `server/test/headers.test.js`, `reviews/backlog.md`,
  and this story file (`reviews/csp-hardening.md`).
- **AC7:** manual, in the real Zoom client. The automated gate proves the header
  string; it cannot prove the Zoom client still renders under it. This is the one
  residual risk of any CSP change and is Thomas's live-test step (as with prior
  in-Zoom UX work).

## Open questions

1. ~~Optional adjacent hardening — in or out?~~ **RESOLVED (Thomas, 2026-07-17):
   all four add-ons.** See `## Design decisions` below.
2. **Runtime SDK script injection (residual risk, not a scope question).** If the
   bundled `@zoom/appssdk` ever *injects a script tag* from `appssdk.zoom.us` at
   runtime (rather than only postMessage), `script-src 'self'` would block it — but
   the app already runs in Zoom under `script-src 'self'` today, so this is believed
   fine. Flagged only so the live smoke (AC7) watches for a script-src violation.

## Design decisions (2026-07-17)

- **Scope — Thomas's consult call:** *"All four add-ons."* Ship the connect-src pin
  plus `object-src 'none'`, `frame-src 'none'`, `worker-src 'none'`, and
  `upgrade-insecure-requests`. Keep `frame-ancestors` unchanged (Zoom documents no
  exact origins; tighter risks a blank screen).
- **Design review:** clean pass, no findings, no one-way doors — nothing to
  disposition. The approved shape is the single-array CSP edit + string-assertion
  tests, no new abstraction.

## Codex design review (2026-07-17)

**Verdict: clean pass — no findings.** "Sound, modern design. The one-line
declarative CSP change directly satisfies the acceptance criteria, matches the
repository's existing CSP and native `node:test` conventions, and keeps the policy
invariant centralized in the exported `CSP` array. Adding Helmet or a CSP-building
abstraction would introduce dependency and migration cost without eliminating a
meaningful error path for this narrowly scoped change. The proposed
directive-bounded served-header assertions are appropriate; the live in-Zoom smoke
test correctly owns the only material residual compatibility risk."

No one-way doors, no best-practice flags. (Artifact: `reviews/csp-hardening.design.json`.)

## Design sketch — HOW

Mechanical, single-point change. The CSP is one exported array of directive
strings in `server/src/app.js` (`export const CSP = [ … ].join('; ')`). The change
is editing the `connect-src` line of that array from
`"connect-src 'self' https://*.zoom.us https://*.zoom.com"` to
`"connect-src 'self'"`, and (if Thomas opts into Q1) inserting one or more
`"object-src 'none'"`-style entries. No new module, structure, dependency, or
pattern — the policy shape, the `securityHeaders` middleware, and the test harness
all stay exactly as they are. The comment above the `CSP` array is rewritten to
carry the new rationale + the frame-ancestors decision. Tests are string
assertions against the served header, already the established pattern in
`headers.test.js`. Reversibility: two-way — the directive can be widened back in
one line if a live test regresses.
