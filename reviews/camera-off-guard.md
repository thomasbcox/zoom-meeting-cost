Date: 2026-07-20 · Branch: claude/camera-off-guard · Status: approved

# camera-off-guard — don't silently fail when the camera is off

## Problem
Clicking **"Show cost on video"** with the camera off silently does nothing. `startOverlay` in
[`client/src/App.jsx`](../client/src/App.jsx) awaits `adapter.startCameraOverlay()` with **no
camera-state precheck and no `try/catch`**. With the camera off the SDK rejects
(`"Video is not sending."`), so:

- the rejection is **unhandled** — it reaches the global reporter and `/api/log`, but nothing
  user-facing happens;
- every statement after the `await` never runs: `setOverlayOn(true)`, the immediate
  `postOverlay()`, and the `start-overlay:posted` breadcrumb;
- worse, **two state mutations already happened before the failing call** — the session
  auto-starts (`sessionActions.start()` when idle), so cost begins accruing with no overlay,
  and `lastVideoOnRef.current = true` seeds the auto-recover poll baseline to a value that
  isn't true. The code's own comment states the assumption: *"the presenter is on-camera now."*

Net: the presenter clicks the app's headline action, sees nothing, gets no explanation, and the
session may be quietly counting. This is a path a Zoom Marketplace **functional reviewer** can
wander into, and one real users will hit constantly.

## In scope
- The overlay-start path in `client/src/App.jsx` (`startOverlay`): precheck camera state, guard
  the SDK call, and keep state coherent when the start is refused.
- A user-facing notice surfaced through `client/src/components/PresenterControls.jsx`.
- Unit tests for the camera-off and camera-on paths.

## Non-goals
- No change to the overlay **auto-recover poll** itself (the off→on rearm while the overlay is
  already on).
- No change to accrual/cost math, display cadence, or the overlay payload.
- **No auto-show** once the camera later turns on after a blocked attempt (possible follow-up).
- The **currency picker** filed to `reviews/backlog.md` on this branch is backlog-only — it is
  not built here and is not covered by these ACs.

## Acceptance criteria
1. Starting the overlay with the camera **off** produces **no unhandled rejection**.
2. That attempt surfaces a **prominent, user-visible warning** that names **both** steps — the
   text is *"Turn your camera on, then click 'Show cost on video.'"* — styled as a distinct
   warning block, not the ordinary muted panel line.
3. On that refused path **no state is mutated**: the session does not auto-start, `overlayOn`
   stays `false`, and the auto-recover poll baseline is not seeded to "on".
4. Starting with the camera **on** ends in the same successful state as today: the session is
   running (auto-started from `idle`), `overlayOn` is true, the immediate push has happened, and
   the `begin` / `context-started` / `posted` breadcrumbs have fired. The session now starts on
   the **success path** (after the overlay is confirmed) rather than before the SDK call — an
   outcome-equivalent reordering, not a behavior loss.
5. A **non-camera-off** rejection from `startCameraOverlay()` is also caught (no unhandled
   rejection) and surfaces the notice rather than blanking the panel via the ErrorBoundary.
6. The notice **clears** on a subsequent successful start.
7. Scope containment: the diff touches only `client/src/App.jsx`,
   `client/src/components/PresenterControls.jsx`, their test files, and — only if needed —
   `client/src/styles.css`.

## Test notes
- **AC1/AC3:** unit-test `startOverlay` with a stub adapter whose `getVideoState()` resolves
  `false`; assert `startCameraOverlay` was never called, `sessionActions.start` was not called,
  `overlayOn` stayed false, and no rejection escaped.
- **AC2/AC6:** assert the notice renders (with `role="alert"`) after a camera-off attempt, and
  is absent after a subsequent successful start.
- **AC4:** stub adapter with `getVideoState()` → `true`; assert the existing call sequence and
  all three breadcrumbs are unchanged.
- **AC5:** stub whose `startCameraOverlay()` rejects with a non-camera error; assert it is
  caught and the notice shows.
- **AC7:** run `git diff --name-only main...HEAD` and verify no files appear beyond those AC7
  enumerates — the `reviews/camera-off-guard.*` workflow artifacts and the separate
  `backlog: file currency picker` commit aside.
- **Gate:** `npm test && npm run build`.

## Open questions
1. **Precheck + catch, or catch only?** Recommend **both**. `getVideoState()` first gives a
   precise, friendly message *and* lets us refuse before mutating state (AC3). A catch-only
   design is simpler but can't cleanly undo the session-start and baseline writes that already
   happened before the failing call. Decide.
2. **Message wording** — proposed: *"Turn your camera on to show the cost on your video."*
   Confirm or reword.
3. **Notice styling** — reuse the existing `.muted small` line with `role="alert"` (minimum
   change), or add a distinct warning style? Recommend reusing what's there; say if you want it
   visually louder.
4. **Auto-show when the camera later comes on?** Recommend **no** — surprising, and it belongs
   with the auto-recover work. Flagged as a follow-up, not built.

## Design sketch — HOW
Restructure the overlay-start path as **check → commit → then mutate**, and extract it so it is
testable in this repo's node/vitest setup (no jsdom):

1. **Extract an exported async orchestrator** from `App.jsx` — e.g.
   `attemptStartOverlay({ adapter, status, sessionActions, seedBaseline, post, log })` returning
   a result (`'started' | 'blocked-camera-off' | 'error'`). The `startOverlay` hook callback
   becomes a thin wrapper that calls it and sets React state (`overlayOn`, `overlayNotice`) from
   the result. This gives a plain-function seam the existing node tests drive directly (finding ②).
2. In the orchestrator: `const videoOn = await adapter?.getVideoState?.()` — capability already
   declared and polled, so no new scope. Treat an unavailable/throwing probe as *unknown →
   proceed*, so a probe failure never blocks a legitimate start.
3. If explicitly `false`: return `'blocked-camera-off'` **before** any session start, baseline
   write, or SDK call; caller shows the warning and logs `start-overlay:blocked-camera-off`.
4. Otherwise `await adapter.startCameraOverlay()` inside `try/catch` — **this is the commit
   boundary** (finding ①). Only on success: auto-start the idle session, seed `lastVideoOnRef`,
   set `overlayOn`, push the snapshot, clear the notice, fire `context-started`/`posted`. On
   rejection: return `'error'`, caller shows the same warning, `overlayOn` stays false, log
   `start-overlay:error`. Nothing was mutated before the boundary → nothing to roll back.

Warning UI: thread `overlayNotice` into `PresenterControls` as a prop; render a **distinct
`role="alert"` warning block** (a new `styles.css` class) beside the overlay button row. New
React state + one CSS class — no new store, dependency, or SDK capability.

## Codex design review (2026-07-20)
**Verdict:** "The overall precheck-plus-catch design is appropriate and uses existing React and
adapter primitives, but the proposed mutation order retains a failure-state inconsistency and
lacks a clean test seam compatible with this repository's dependency and testing conventions."

**IMPORTANT — two-way × kludgy — "Failed SDK start can still mutate session and recovery state."**
The sketch still calls `sessionActions.start()` and writes `lastVideoOnRef.current = true`
*before* awaiting `startCameraOverlay()`. The camera can turn off between the precheck and the
SDK call, or the SDK can reject for another reason (AC5); the catch then leaves `overlayOn`
false but keeps the two mutations the story itself calls incoherent. "The precheck narrows the
bug without making the operation transactional."
- *Alternative:* treat the SDK call as the **commit boundary** — probe, await
  `startCameraOverlay()`, and only *after* it succeeds auto-start the idle session, seed
  `lastVideoOnRef`, set `overlayOn`, push the snapshot, and clear the notice.
- *Win:* eliminates the camera-state race and the generic-rejection partial state, with no
  rollback path; every refused start leaves session, overlay, and baseline untouched.

**IMPORTANT — two-way × nonstandard — "The sketch does not provide a viable App-level unit-test seam."**
The ACs need assertions on session/overlay/ref/notice transitions, but this repo has **no DOM
test environment and no React testing library** (verified: no `jsdom`/`happy-dom`/
`@testing-library` in `client/package.json`, no vitest `environment` config → node). Existing
component tests deliberately call the component and inspect the returned element tree. Adding
jsdom would touch manifests outside AC7; mocking hooks would be a brittle hand-rolled renderer.
- *Alternative:* extract the start-attempt orchestration as an **exported async function** with
  injected adapter / status / mutation callbacks / post / log; keep the hook callback a thin
  wrapper and test the function directly. Test the `PresenterControls` notice with the repo's
  existing element-tree inspection convention.
- *Win:* satisfies the behavioural assertions with no new dependencies or out-of-scope files,
  and centralizes the no-partial-mutation invariant in one directly testable command.

## Codex review (2026-07-24, base main, HEAD 6aa3818)
**Summary:** "The implementation is functionally aligned with the guarded check → commit →
mutate flow, but the AC6 transition lacks meaningful regression coverage and the required
warning text differs slightly from the specification." *(The reviewer's gate-can't-run note is
its own read-only sandbox, not our gate — ours is green.)*

### IMPORTANT
**AC6 test does not exercise notice clearing** — `client/src/components/PresenterControls.test.jsx:29`
- *Claim:* the test supplies `overlayNotice: null` directly and only checks that the warning is
  omitted; it never runs a blocked→successful sequence or observes the App wrapper clearing an
  existing notice. Deleting `setOverlayNotice(null)` from `App.jsx` would leave all tests green
  while breaking AC6.
- *Suggestion:* add a testable seam for applying an attempt result to the overlay UI state, use
  it from `startOverlay`, and test that blocked→successful clears the notice and sets `overlayOn`.

### NIT
**Warning text doesn't exactly match AC2 copy** — `client/src/App.jsx:228`
- *Claim:* AC2 specifies `… click 'Show cost on video'.` (single quotes); the constant renders
  double quotation marks around the button label. Understandable either way — copy mismatch only.
- *Suggestion:* align the constant + test fixture to AC2's single-quoted wording.

## Codex approach review (2026-07-24, base main, HEAD 3af0904)
**Verdict:** "Sound and idiomatic. I would build it this way: the extracted async command
provides the repository-compatible test seam, the SDK start is correctly treated as the commit
boundary, React owns the notice state, and the existing adapter/CSS primitives cover the
behavior without new dependencies or unnecessary machinery. No approach-level changes are
warranted."

**Findings: none** (empty array) — shape blessed; proceeded to the correctness pass in the same
round.

## Build note (2026-07-20)

| AC | What | File |
|---|---|---|
| 1 | Camera-off start raises no unhandled rejection | `client/src/App.jsx` (`attemptStartOverlay`) |
| 2 | Prominent two-step `role="alert"` warning | `client/src/components/PresenterControls.jsx`, `client/src/styles.css`, `client/src/App.jsx` (`CAMERA_OFF_NOTICE`) |
| 3 | Refused start mutates no state (no session start, `overlayOn` false, baseline unseeded) | `client/src/App.jsx`, `client/src/App.test.js` |
| 4 | Camera-on ends in the same success state; session starts on the success path | `client/src/App.jsx`, `client/src/App.test.js` |
| 5 | Non-camera-off SDK rejection is caught → warning, no ErrorBoundary blank | `client/src/App.jsx`, `client/src/App.test.js` |
| 6 | Warning clears on a subsequent successful start | `client/src/App.jsx`, `client/src/components/PresenterControls.test.jsx` |
| 7 | Scope containment | _scope check — no file_ |

## Scope decision (2026-07-20)
Thomas: "build it please." Approved: the camera-off guard as specced, with both reviewer fixes
and the two user-facing choices below. (The currency picker is backlog-only — filed separately
on this branch, not built here.)

## Design decisions (2026-07-20)
- **Finding ① — failed start still mutates state:** FIX. `startCameraOverlay()` is the commit
  boundary; session-start, baseline seed, `overlayOn`, push, and clear-notice happen only after
  it succeeds. AC4 reworded outcome-based. Named consequence accepted by Thomas: on success the
  cost clock starts a beat later (once the overlay is confirmed up).
- **Finding ② — no App-level test seam:** FIX. Extract the start-attempt orchestration as an
  exported async function with injected deps; test it directly, and test the warning markup via
  the repo's element-tree convention. No jsdom / testing-library added.
- **User choice — warning style:** PROMINENT distinct warning block (new `styles.css` class), not
  the quiet muted line.
- **User choice — auto-show after the camera comes on:** NO. The warning names both steps ("turn
  your camera on, then click 'Show cost on video'") so the user knows to click again. Auto-show
  stays a non-goal / possible follow-up.
