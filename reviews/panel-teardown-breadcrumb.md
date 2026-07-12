Date: 2026-07-10 · Branch: claude/panel-teardown-breadcrumb · Status: approved

# panel-teardown-breadcrumb — diagnose BUG-1's panel-close freeze

> Step 1 of BUG-1 ("Panel-close stops the meter"), scoped **diagnose-first** per Thomas's
> 2026-07-10 decision: confirm the real mechanism before committing to a fix. This story lands the
> instrumentation + runbook that a live run needs; the actual re-architecture is a follow-up story
> informed by that run.

## Problem

BUG-1 ([BACKLOG.md:10](../BACKLOG.md#L10)) says the cost-accrual `setInterval` lives in the side
panel ([App.jsx:207](../client/src/App.jsx#L207)), so closing the panel "freezes the on-camera
meter at its last value," and proposes re-architecting the overlay to "self-accrue from the last
cost-rate."

Reading the code complicates that framing: the camera overlay **already self-accrues**.
[`OverlayApp`](../client/src/components/OverlayApp.jsx) runs its own 250 ms re-render loop and calls
[`extrapolateOverlay`](../client/src/lib/overlayState.js), which advances `totalCost` as
`costPerSecond × (now − updatedAt)`, **unbounded, while `status === 'running'`**. That code shipped
in the same commit that introduced the overlay (`d65b573`) — it predates BUG-1 — yet
`simple-default-role-gate` still deferred the panel-close freeze as a genuine bug
([simple-default-role-gate.md:38](simple-default-role-gate.md#L38)).

So the freeze is very likely **not** a data-accrual gap (extrapolation covers that) but a
**lifecycle** one: closing the panel — the instance that called `runRenderingContext` — tears down
the spawned camera *rendering context*, destroying the overlay webview so its last frame freezes on
the video. If that hypothesis is right, BUG-1's stated fix ("self-accrue from the last rate") is
already present and **not sufficient**; the real work is decoupling the overlay's *lifetime* from
the panel. If it's wrong (the overlay survives panel close), the freeze is something else entirely.

We cannot tell which from code alone — it's a real-Zoom runtime fact, and the whole camera-overlay
path is still being instrumented live. The one breadcrumb that would settle it is missing: the
camera instance logs `overlay-teardown` on `pagehide`
([OverlayApp.jsx:31](../client/src/components/OverlayApp.jsx#L31)), but the **panel has no teardown
breadcrumb** — only `panel-mounted`. Without it, a live run can't correlate "panel closed" with
"camera context died."

## In scope

- A **`panel-teardown` lifecycle breadcrumb**, emitted on `pagehide` of the side-panel instance,
  mirroring the camera instance's `overlay-teardown`.
- A small **shared, injectable helper** (`registerTeardownLog`) so the pagehide→log wiring is
  unit-testable without jsdom and not duplicated; the existing overlay teardown logger delegates to
  it (its public API and behavior unchanged).
- A short **runbook** documenting the live diagnostic: what to do, what to grep, and a decision
  table mapping the outcome to the BUG-1 fix direction.

## Non-goals

- **The actual BUG-1 fix.** No change to accrual, the overlay lifecycle, `extrapolateOverlay`, the
  `postMessage`/`onMessage` bridge, cost math, or the "keep the panel open" doc wording. Those wait
  on the live confirmation this story enables.
- Running the live test — that requires real Zoom and is Thomas's to run; this story only makes the
  run legible.
- Any new SDK capability, dependency, or server endpoint (reuses the existing `/api/log` sink and
  `logLifecycle` channel).

## Acceptance criteria

1. **Panel teardown breadcrumb.** On a `pagehide` in the side-panel instance, the app emits exactly
   one `logLifecycle('panel-teardown')` entry — shape `{ kind:'lifecycle', event:'panel-teardown',
   instanceId }` — to the `/api/log` sink, carrying no participant names, rates, or private config.
2. **Shared, testable helper.** The pagehide→log wiring is a plain function
   `registerTeardownLog(event, { target, log })` unit-tested (node env, injected fake target + sink)
   for: it registers a `pagehide` listener; it logs the given `event` when the listener fires; it
   returns a cleanup that removes the listener; it is a safe no-op (returning a callable cleanup)
   when no event target is available; and a throwing log sink never escapes the handler.
3. **Overlay breadcrumb preserved.** `registerOverlayTeardownLog` still logs `overlay-teardown`
   only for the real camera mount (`shouldLog` true) and is a no-op otherwise; its existing tests in
   [OverlayApp.test.js](../client/src/components/OverlayApp.test.js) still pass unchanged.
4. **Runbook.** A dev-doc records the diagnostic: close the panel while the overlay runs, grep the
   Railway `/api/log` stream, and a decision table — if `overlay-teardown` fires immediately after
   `panel-teardown`, the camera context is coupled to the panel (lifecycle bug → the BUG-1 fix must
   keep the context alive independent of the panel); if it does **not**, the overlay survives and
   the freeze lies elsewhere (extrapolation stalling, or a static last frame) → re-diagnose. It also
   notes the null result: if `panel-teardown` never appears, `pagehide` is the wrong signal for panel
   close and the breadcrumb itself needs revisiting.
5. **Scope containment.** `git diff --name-only main...HEAD` shows no files beyond: the lifecycle-log
   module (`client/src/lib/lifecycleLog.js`) + its test, `client/src/App.jsx`, the overlay teardown
   logger (`client/src/components/OverlayApp.jsx`) + its test, the log transport
   (`client/src/lib/postLog.js`) + a transport test, and the runbook doc
   (`dev-docs/panel-close-teardown.md`) — plus this story file and the review-loop artifacts it
   generates (`.design.json`, `.approach.json`, `.codex.json`). *(Amended 2026-07-10, see Decisions:
   the review-pass JSONs are `/review`'s own committed outputs, not product-scope files.)*
6. **Gate green.** `npm test && npm run build` passes.

## Test notes

- **AC1/AC2** — new unit test for `registerTeardownLog` using the `fakeTarget()` + `vi.fn()` sink
  pattern already established in [OverlayApp.test.js](../client/src/components/OverlayApp.test.js):
  assert `addEventListener('pagehide', …)`, that firing calls `log('panel-teardown')` (and, in a
  generic case, the passed event name) exactly once, that cleanup calls `removeEventListener`, the
  no-target no-op, and the throwing-sink case via `expect(() => target.fire('pagehide')).not.toThrow()`.
- **AC1 (wiring)** — assert in an `App`/panel-level test (or by the shared helper being invoked from
  the mount effect) that the panel registers the `panel-teardown` logger on mount; the privacy shape
  is guaranteed structurally (the helper only ever passes the event name to `logLifecycle`, which
  merges `kind`/`instanceId` and nothing else).
- **AC3** — run the existing `OverlayApp.test.js` suite unchanged; it exercises the delegated path.
- **AC4** — reviewer reads the runbook: hypothesis, the two breadcrumbs, the live procedure, and the
  outcome→direction decision table (including the null result).
- **AC5** — run `git diff --name-only main...HEAD` and verify no files appear beyond those AC5
  enumerates.
- **AC6** — `npm test && npm run build`.

## Open questions

1. **Shape of "diagnose first."** This story deliberately lands only the breadcrumb + runbook and
   defers the actual re-architecture to a follow-up story informed by the live run (which only
   Thomas can perform). Confirm that's the intended shape, vs. also pre-staging a candidate fix here.
2. **Runbook location.** Proposed as a standalone `dev-docs/panel-close-teardown.md`, mirroring the
   existing diagnostic docs (`camera-overlay-no-update.md`). Alternative: fold the procedure into the
   BUG-1 backlog entry or an existing doc. (Recommend standalone — discoverable for the follow-up.)
3. **Reuse vs mirror.** Intended approach extracts a shared `registerTeardownLog` and has the overlay
   logger delegate (DRY, one tested primitive). The minimal-diff alternative is a standalone
   panel-only logger leaving `registerOverlayTeardownLog` untouched (no overlay churn, but duplicates
   the pagehide+swallow+cleanup pattern). Design-review call.
4. **`pagehide` reliability.** Assumes `pagehide` fires when the Zoom app panel is closed — the same
   signal the overlay already relies on. The live run validates this: no `panel-teardown` line means
   the signal is wrong and the breadcrumb needs a different hook (e.g. `visibilitychange`).

## Design sketch — HOW

Central move: make the panel's teardown observable with the *same* primitive the overlay uses, then
document how to read a live run.

- **`registerTeardownLog(event, { target = window, log = logLifecycle })`** — new plain function in
  [`client/src/lib/lifecycleLog.js`](../client/src/lib/lifecycleLog.js) (co-located with
  `logLifecycle` and its privacy contract). Adds a `pagehide` listener that calls `log(event)` inside
  a `try/catch` (logging must never break teardown), and returns a cleanup that removes the listener.
  Safe no-op (`() => {}`) when the target has no `addEventListener`. This is the existing
  `registerOverlayTeardownLog` body, generalized over the event name — extracted as a testable plain
  function, matching the codebase's `runCameraDraw` / `createVideoRecovery` idiom.
- **`registerOverlayTeardownLog(shouldLog, opts)`** in
  [`OverlayApp.jsx`](../client/src/components/OverlayApp.jsx) becomes a thin wrapper:
  `shouldLog ? registerTeardownLog('overlay-teardown', opts) : () => {}`. Public API and observable
  behavior unchanged, so its tests stay green.
- **Panel wiring** in [`App.jsx`](../client/src/App.jsx): a `useEffect(() =>
  registerTeardownLog('panel-teardown'), [])` beside the existing `panel-mounted` effect (~line 172).
  The panel is a single instance that always wants the breadcrumb, so no `shouldLog` gate.
- **Tests**: a `lifecycleLog.test.js` covering `registerTeardownLog` with an injected fake target +
  sink (mirrors `OverlayApp.test.js`); existing overlay tests unchanged.
- **Runbook**: `dev-docs/panel-close-teardown.md` — hypothesis (lifecycle coupling), the two
  breadcrumbs, the live procedure (grep the `/api/log` stream on Railway), and the outcome→direction
  decision table.
- **Cross-cutting**: privacy — only `event` + `instanceId` ever leave (no PII), same contract as
  every lifecycle log; error model — the handler swallows sink errors; no retries, no new deps.

## Codex design review (2026-07-10)

Verdict: *the shared registration helper is a sound, repo-consistent extraction, but the design is
not yet sufficient for its diagnostic purpose — teardown logging still uses an ordinary async fetch
the browser may cancel during page destruction. Retain the helper/wrapper/effect shape, but first
make the teardown log path unload-safe, then test that transport.*

Verified against the code: [`postLog`](../client/src/lib/postLog.js) does a plain
`fetch('/api/log', …)` with **no `keepalive`**, and the existing `overlay-teardown` breadcrumb rides
this same path — so both findings are accurate, and finding 1 also strengthens the existing overlay
breadcrumb.

**BLOCKER · two-way · kludgy — The teardown breadcrumb has no teardown-safe delivery.**
The `pagehide` handler calls `logLifecycle` → `postLog`'s non-`keepalive` fetch, un-awaited, while
the webview is being destroyed, so the request may be canceled. A dropped breadcrumb is then
indistinguishable from "`pagehide` never fired," which breaks AC4's null-result branch and AC1's
"reaches the sink" requirement.
- *alternative*: give teardown logs an unload-safe transport — let `postLog` accept a `keepalive`
  option and have the teardown path use `fetch(…, { keepalive: true })` (or `navigator.sendBeacon`);
  keep `registerTeardownLog` responsible only for registration + injected logging.
- *win*: removes a false-negative path from the diagnostic, makes the decision table actionable, and
  centralizes reliable teardown delivery in the existing transport (no retries / lifecycle heuristics).
- **My recommendation: FIX.** It's the difference between a trustworthy diagnostic and one that can
  silently lie. Smallest shape: `postLog(payload, { keepalive })`; a teardown-safe lifecycle sink
  passes `keepalive:true`; the overlay logger delegates to the same path so `overlay-teardown` also
  becomes reliable (consistency win). Adds `postLog.js` + a transport test to the scope.

**IMPORTANT · two-way · nonstandard — `target = window` default throws outside a browser.**
The sketch's `{ target = window }` default throws `ReferenceError` in Node, contradicting the
safe-no-target contract and regressing the existing helper's `typeof window !== 'undefined' ? window
: null` guard.
- *alternative*: keep the guarded default `{ target = typeof window !== 'undefined' ? window : null }`.
- *win*: removes an environment-dependent exception; the no-target invariant holds by construction.
- **My recommendation: FIX (trivial).** This is a wording slip in the sketch — the implementation
  will reuse the existing guarded default verbatim.

Both findings are two-way (reversible); neither is a one-way door. No new dependency. If both are
fixed, the added scope over the original sketch is: a `keepalive` option on `postLog.js` + one
transport test.

## Design decisions (2026-07-10)

Thomas: *"approve, fix both, standalone runbook."*

- **Scope**: approved as framed — diagnose-first. This story lands only the breadcrumb + shared
  helper + runbook; the actual BUG-1 fix is a follow-up story informed by the live run (OQ1
  resolved: breadcrumb + runbook only).
- **Finding 1 (teardown-safe delivery) → FIX.** Add a `keepalive` option to `postLog`; the teardown
  log path uses a `keepalive:true` sink so `panel-teardown` (and, via the shared helper, the existing
  `overlay-teardown`) reliably reaches `/api/log` during page destruction. `registerTeardownLog` stays
  registration-only; the transport option lives in `postLog`. Pulls `postLog.js` + one transport test
  into scope (reflected in AC5's file list).
- **Finding 2 (`target = window` default) → FIX.** Implementation reuses the existing guarded default
  `typeof window !== 'undefined' ? window : null`.
- **OQ2 resolved**: runbook is a standalone `dev-docs/panel-close-teardown.md`.

The approved shape above is binding on implementation.

## Build note (2026-07-10)

AC → file map:

- **AC1** (panel-teardown reaches `/api/log`, PII-free) → [client/src/App.jsx](../client/src/App.jsx)
  (pagehide effect beside `panel-mounted`); [client/src/lib/lifecycleLog.js](../client/src/lib/lifecycleLog.js)
  (`registerTeardownLog` + keepalive `teardownLog` sink).
- **AC2** (shared, testable helper) → [client/src/lib/lifecycleLog.js](../client/src/lib/lifecycleLog.js);
  [client/src/lib/lifecycleLog.test.js](../client/src/lib/lifecycleLog.test.js) (register/fire/cleanup/
  no-target/throwing-sink/default-keepalive).
- **AC3** (overlay breadcrumb preserved) → [client/src/components/OverlayApp.jsx](../client/src/components/OverlayApp.jsx)
  (`registerOverlayTeardownLog` delegates); [OverlayApp.test.js](../client/src/components/OverlayApp.test.js)
  unchanged, still green.
- **AC4** (runbook) → [dev-docs/panel-close-teardown.md](../dev-docs/panel-close-teardown.md).
- **AC5** (scope containment) → the diff itself.
- **Finding 1 fix** (keepalive delivery) → [client/src/lib/postLog.js](../client/src/lib/postLog.js);
  [client/src/lib/postLog.test.js](../client/src/lib/postLog.test.js).

## Codex approach review (2026-07-10, base main, HEAD b2aaaf4)

Verdict: *"Sound and idiomatic. I would build it this way: a shared injectable pagehide registrar,
an unload-safe sink using the existing transport, thin React effects/wrappers, focused tests, and a
standalone runbook. It adds no dependency and does not hand-roll a framework feature."*

**Findings: none** (empty array). The shape is blessed → continued to the correctness pass in the
same round. (Codex noted it couldn't run the gate itself because its read-only sandbox blocked
Vitest's temp-config write — an environment limitation, not a finding; the gate passes outside the
sandbox.)

## Codex review (2026-07-10, base main, HEAD 866aaac)

Summary: *"The functional implementation matches the approved design, but the branch violates the
spec's explicit scope-containment criterion."* (Gate not independently verifiable in the read-only
sandbox — passes outside it.)

**BLOCKER — Branch includes a file outside the scope allowlist** ·
`reviews/panel-teardown-breadcrumb.approach.json:1`
> AC5 permits only the listed implementation/test/runbook files plus the story file and its
> `.design.json`. `git diff --name-only main...HEAD` also includes this `.approach.json`, so the
> branch does not satisfy the stated criterion. *Suggestion: remove it, or record Thomas's explicit
> amendment to AC5 allowing this artifact.*

## Decisions (2026-07-10)

Thomas: *"amend ac5 and push + open a PR"*.

- **Approach pass** — clean, nothing to decide.
- **Correctness BLOCKER (AC5 allowlist vs `.approach.json`)** → **amend AC5** (answer, no code change).
  AC5 above now covers the review loop's own artifacts (`.approach.json`, `.codex.json`) alongside
  `.design.json`; these are process outputs `/review` generates and commits, not product-scope creep —
  the implementation diff touches exactly the enumerated code/test/doc files. Nothing is removed. No
  shape-changing fix was approved this round, so the review is complete.
- **PR** → push the branch + open a PR targeting `main` now, so CI runs ahead of `/close`.

## Fixes (2026-07-10)

**No code fixes.** The single correctness BLOCKER was resolved by the AC5 wording amendment (a
doc-only change already applied in the Decisions round above) — not an approach/redesign fix and not
a line-level code change. The implementation is unchanged since the reviewed HEAD. Gate re-run green;
proceeding to the step-4 re-review/merge fork.
