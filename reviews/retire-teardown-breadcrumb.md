Date: 2026-07-12 · Branch: claude/retire-teardown-breadcrumb · Status: approved

# retire-teardown-breadcrumb — remove the pagehide teardown breadcrumbs, close BUG-1

## Problem

The `panel-teardown` / `overlay-teardown` breadcrumbs (shipped to instrument BUG-1's panel-close
freeze) are emitted on the browser `pagehide` event via `registerTeardownLog`
([client/src/lib/lifecycleLog.js](../client/src/lib/lifecycleLog.js)). A live diagnostic run on
**2026-07-12** (dev Railway env, commit `260f48b`, real Zoom session) proved the approach does not
work in the Zoom host:

- Across ~20 min covering several panel close→reopen cycles **and** a deliberate right-click →
  "Close the app", the dev `/api/log` sink recorded **zero** `panel-teardown` / `overlay-teardown`
  and **zero** new panel `boot` on reopen — while ordinary lifecycle beacons (`boot`,
  `panel-mounted`, `overlay-mounted`) delivered within seconds. So delivery works; `pagehide` is
  simply not dispatched/flushed when Zoom hard-kills the embedded webview.
- The absence of a fresh `boot` on every reopen also shows a normal panel "close" is a **hide, not a
  destroy** — the panel webview survives, its 1 s tick keeps accruing, the meter keeps running and
  re-syncs on reopen. **BUG-1's freeze symptom does not reproduce.**

Conclusion: the pagehide breadcrumb cannot observe Zoom teardown (the runbook's row-3 case,
confirmed), and BUG-1 is not currently replicable. Retire the dead instrument and close the bug.

## In scope

- Remove the pagehide teardown machinery and its two call sites (panel + overlay).
- Remove/adjust the unit tests that cover only the removed machinery.
- Reconcile the **live** docs that describe the breadcrumbs as a working signal.
- Close **BUG-1** in `BACKLOG.md` as *not currently replicable*, recording the retirement and naming
  heartbeat + server-side gap detection as the deferred candidate instrument (NOT built here).

## Non-goals

- **Do not build** any replacement teardown instrument (heartbeat/gap detection, `visibilitychange`,
  etc.). This story only retires; a replacement, if ever wanted, is a separate `/frame` story.
- No change to `logLifecycle` or the surviving lifecycle logs (`boot`, `panel-mounted`,
  `overlay-mounted`, `start-overlay:*`, `overlay-message`) or to `postLog`'s keepalive option (kept
  as a general capability; still exercised by `postLog.test.js`).
- Do not touch overlay accrual (`extrapolateOverlay`) or the camera off/on recovery poll.
- Historical `reviews/*.md` (the `panel-teardown-breadcrumb` and `overlay-teardown-diagnostics`
  stories) are immutable records — left as-is.

## Acceptance criteria

1. **Machinery removed.** `registerTeardownLog` and the private `teardownLog` no longer exist in
   `client/src/lib/lifecycleLog.js`; `logLifecycle` and its behavior are unchanged.
2. **Panel breadcrumb removed.** `client/src/App.jsx` no longer imports `registerTeardownLog` nor
   registers the `panel-teardown` effect; `panel-mounted`, the `start-overlay:*` checkpoints, and the
   `logLifecycle` used by the video-recovery path remain.
3. **Overlay breadcrumb removed.** `client/src/components/OverlayApp.jsx` no longer exports
   `registerOverlayTeardownLog`, registers its effect, or imports `registerTeardownLog`; the overlay's
   mount log, message subscription, 250 ms tick, and `runCameraDraw` are unchanged.
4. **Dead tests gone, survivors green.** The `registerTeardownLog` `describe` block in
   `lifecycleLog.test.js` is removed (with its now-unused `fakeTarget` helper and `afterEach` import);
   `OverlayApp.test.js` (which tested only `registerOverlayTeardownLog`) is deleted. The `instanceId`,
   `logLifecycle`, and `postLog` keepalive tests still pass, and no test imports a removed symbol.
5. **No dangling references in shipped code + live docs.** `registerTeardownLog`,
   `registerOverlayTeardownLog`, `panel-teardown`, and `overlay-teardown` no longer appear in
   `client/src/**`; the live runbooks (`dev-docs/panel-close-teardown.md`, and — only if AC-scope
   includes overlay-teardown, see Open question 1 — `dev-docs/overlay-live-test-guide.md` /
   `overlay-live-test-matrix.md`) and the `zoomAdapter.js` observer comments are reconciled to the
   retirement.
6. **BUG-1 closed.** `BACKLOG.md` moves BUG-1 to **Done**, noting: not currently replicable (normal
   close = hide; meter keeps running; re-syncs on reopen); the pagehide teardown breadcrumb retired
   (can't observe Zoom teardown); heartbeat + server-side gap-detection recorded as the deferred
   candidate. (This file also carries the BUG-2 addition filed earlier this session — see Open
   question 2.)
7. **Gate green.** `npm test && npm run build` passes.

## Test notes

- AC1–AC3: `git grep -nE "registerTeardownLog|registerOverlayTeardownLog|teardownLog|panel-teardown|overlay-teardown" client/src` returns nothing; read the three files to confirm the surviving logic is untouched.
- AC4: the gate runs the suite; confirm `lifecycleLog.test.js` retains `instanceId` + `logLifecycle` describes and `OverlayApp.test.js` is deleted.
- AC5: `git grep` (above) over `client/src`; manual read of the reconciled docs.
- AC6: read `BACKLOG.md` — BUG-1 under `## Done` with the stated notes.
- AC7: run `npm test && npm run build`.
- **Scope containment:** run `git diff --name-only main...HEAD` and verify no files appear beyond those enumerated in the Design sketch's file list.

## Open questions

1. **Retire `overlay-teardown` too, or only `panel-teardown`?** The live run *directly* disproved only
   `panel-teardown` (Zoom-initiated panel close). `overlay-teardown` fires on the **overlay** webview's
   `pagehide`, which is reached via `closeRenderingContext` when the presenter clicks **Hide** — an
   *app-initiated* teardown that was **not** exercised in this run, and which `overlay-live-test-matrix.md`
   still lists as an expected signal. The mechanism-level finding (Zoom doesn't flush `pagehide` on
   webview kill) *probably* makes `overlay-teardown` equally dead, and the stated scope removes it —
   but we have not re-tested the Hide path.
   **Recommendation:** retire both (matches the mechanism-level finding and keeps `lifecycleLog.js`
   free of a one-caller helper); accept the small doc churn in the two `overlay-live-test-*` files.
   **Alternative:** scope to `panel-teardown` only, keep `overlay-teardown` + `registerTeardownLog`
   pending a Hide-path test — narrower, evidence-matched, but leaves dead-weight if it also never fires.
2. **BUG-2 rides along.** `BACKLOG.md` already has the uncommitted BUG-2 addition (overlay 4 Hz vs
   panel 1 Hz refresh) you asked me to file earlier this session; it moved onto this branch. OK to
   commit it as part of this branch's BACKLOG.md change, or split it out?

## Design sketch — HOW

Pure deletion of the pagehide-breadcrumb layer plus prose reconciliation of the live docs — no new
structure, data shape, or dependency.

- **`client/src/lib/lifecycleLog.js`** — delete `teardownLog` (the keepalive sink) and
  `registerTeardownLog` (the pagehide registrar). Keep `logLifecycle` and the `postLog` / `instanceId`
  imports (still used by it).
- **`client/src/components/OverlayApp.jsx`** — delete the `registerOverlayTeardownLog` export + its
  header comment, the `useEffect(() => registerOverlayTeardownLog(...))`, and drop `registerTeardownLog`
  from the import (keep `logLifecycle`).
- **`client/src/App.jsx`** — delete the `panel-teardown` `useEffect` + comment (~L176–182) and drop
  `registerTeardownLog` from the import (keep `logLifecycle`).
- **Tests** — `client/src/lib/lifecycleLog.test.js`: remove the `registerTeardownLog` describe, its
  `fakeTarget` helper, the `registerTeardownLog` import, and the now-unused `afterEach` import.
  `client/src/components/OverlayApp.test.js`: delete the file. `client/src/lib/postLog.test.js`:
  minor — the keepalive test uses a `panel-teardown`-shaped example payload; keep the test, tidy the
  comment (L6) that points at `registerTeardownLog`.
- **Docs** — rewrite `dev-docs/panel-close-teardown.md` from a live procedure into a recorded outcome
  ("pagehide doesn't fire on Zoom teardown; normal close = hide; approach retired"). Reconcile the
  `overlay-teardown` mentions in `dev-docs/overlay-live-test-guide.md` + `overlay-live-test-matrix.md`
  and the `zoomAdapter.js` observer comments **iff** Open question 1 retires `overlay-teardown`.
- **`BACKLOG.md`** — BUG-1 → Done with the AC6 notes.

**File list (scope-containment AC):** `client/src/lib/lifecycleLog.js`,
`client/src/lib/lifecycleLog.test.js`, `client/src/components/OverlayApp.jsx`,
`client/src/components/OverlayApp.test.js` (deleted), `client/src/App.jsx`,
`client/src/lib/postLog.test.js`, `client/src/zoom/zoomAdapter.js`,
`dev-docs/panel-close-teardown.md`, `dev-docs/overlay-live-test-guide.md`,
`dev-docs/overlay-live-test-matrix.md`, `BACKLOG.md`. (The last three of the docs +
`zoomAdapter.js` drop out if Open question 1 keeps `overlay-teardown`.)

The one non-mechanical call is Open question 1 (how much of the shared machinery to remove); the rest
is deletion the gate verifies.

## Codex design review (2026-07-12)

**Verdict:** the deletion-first shape is modern and appropriately simple for the *disproven panel*
diagnostic — removes dead machinery/tests/docs with no replacement abstraction or dependency — **but**
it should not retire the *overlay* breadcrumb until its materially different, app-initiated teardown
path is tested or Thomas explicitly accepts losing that potentially valid signal.

### IMPORTANT
- **Overlay retirement extrapolates beyond the evidence** — [two-way · nonstandard] — *locus: Open
  question 1 / OverlayApp.jsx + overlay live docs.* The observed failure covers Zoom hard-killing/
  hiding the **panel** webview; `overlay-teardown` follows an app-initiated `closeRenderingContext`
  (the presenter's **Hide**), a different lifecycle path the run did not exercise — so the panel
  result does not establish the overlay instrument is dead.
  - **Alternative:** retire only `panel-teardown` now and keep the shared helper + overlay caller
    until a focused Hide-path run; or make a passing Hide-path check a prerequisite for the
    full-deletion branch.
  - **Win:** avoids deleting potentially-working overlay telemetry and stops the live test guide
    asserting an unverified behavior change; full deletion stays a small local change once evidence
    exists.

This exactly matches Open question 1 — it is the one decision to settle at the consult.

## Design decisions (2026-07-12)

Thomas's scope decision, verbatim: **"retire both now"** — full deletion, including `overlay-teardown`.
BUG-2 backlog addition: **committed on this branch** (Thomas's choice).

- **Codex IMPORTANT — "Overlay retirement extrapolates beyond the evidence": ACCEPTED, proceed with
  full deletion.** Rationale: teardown *observability* has no active consumer — resilience
  (`extrapolateOverlay` self-accrual + the camera off/on recovery poll) already covers the
  user-facing freeze risk — so keeping `overlay-teardown` pending a Hide-path test would preserve a
  diagnostic nothing reads. The finding is two-way/reversible: if a real freeze investigation ever
  needs it, it (or its heartbeat replacement) is re-added then.
  - **Mitigation binding on implementation:** docs must state teardown is *handled by recovery/
    extrapolation, not observed*. Leave no doc asserting `overlay-teardown` / `pagehide` fires; point
    the live-test docs at the surviving `closeRenderingContext` `zoom-overlay` SDK-call log instead.
    This makes AC5 definitely include `overlay-live-test-guide.md`, `overlay-live-test-matrix.md`,
    and the `zoomAdapter.js` observer comments.
