Date: 2026-06-09 · Branch: claude/session-restart-controls · Status: approved

> Approved by Thomas 2026-06-09: "approve" (as-is). Keeps the explicit Start at
> `idle` and the "Resume" label for the ended-state continue (Open Questions 1 & 2).

Combines backlog **#4** (session lifecycle — no way to start/resume after "End
session") as the product change, plus **bookkeeping** for backlog **#3**
(secret-leak guardrails) and a newly-recorded gap in the shipped overlay
auto-recover. Per Thomas (2026-06-09): #3 gets no new guardrail *code* — Part A
already shipped and Part B is a manual GitHub toggle — so this story's #3 work is
correcting the stale backlog; the camera off/on auto-recover is recorded as
not-working.

## Problem

**#4 — the session state machine is a dead-end at `ended`.** In
`PresenterControls.jsx` the Pause / Resume / End buttons all gate on
`running` / `paused` / `active`, so once `session.status === 'ended'` **none of
them render** — only the overlay Show/Hide button remains. And `startOverlay`
only calls `sessionActions.start()` from `idle` (`App.jsx`), so from `ended`
showing the overlay leaves status `ended` and the tick loop (gated on `running`)
stays frozen. There is also **no explicit "Start" control at all** — a session is
only ever started implicitly by the overlay button. Net effect, observed live:
after "End session" there is no way to begin or continue a session.

**#3 — the backlog entry is stale.** Backlog #3 lists Parts A/B/C as if undone,
but Part A (local `.githooks/pre-commit` scanner + detector + tests) already
shipped and merged (`reviews/secret-scan-guardrails.md`). Part B
(`secret_scanning_non_provider_patterns`) is feature-gated — the REST API returns
200 but silently leaves it disabled — so it is a one-click **GitHub UI toggle only
Thomas can do**. Part C (CI Action) and a pre-push hook were deferred and, per
Thomas, are **not pursued** now.

**Overlay auto-recover gap (live).** The `overlay-teardown-diagnostics` story
shipped an auto-recover meant to restore the camera overlay after the presenter
toggles their camera off/on. In live use it does **not** fire — the presenter
still has to manually toggle the cost-display button (Hide → Show) to get the
meter back. This needs recording so it isn't assumed solved.

## In scope

**A — Session restart controls (product code):**
- A pure `sessionControls(status)` helper returning which controls the presenter
  sees per status, so the state→controls contract is unit-testable without jsdom.
- `PresenterControls` renders from it: an explicit **Start session** from `idle`,
  and from `ended` **both** "Start new session" (reset elapsed+total to $0 via
  `sessionActions.start()`) **and** "Resume" (continue the frozen total via
  `sessionActions.resume()`). Pause / Resume-counting / End for
  running/paused are preserved unchanged.

**B — Bookkeeping (docs only):**
- Update `reviews/backlog.md` #3 to reflect reality: Part A shipped, Part B
  pending Thomas's manual GitHub UI toggle, Part C / pre-push not pursued
  (2026-06-09).
- Add a `reviews/backlog.md` item recording the overlay auto-recover gap (camera
  off/on still needs a manual Hide→Show), with the live repro, for a future
  diagnostic story.

## Non-goals

- **No new secret-guardrail code** — no CI Action, no pre-push hook, no attempt to
  flip Part B via API (it's a manual UI toggle). #3's only change here is the
  backlog correction.
- **No fix for the overlay auto-recover** — this story only *records* it; the
  diagnostic/fix is a separate story.
- No change to the session transition semantics themselves (`start` already resets
  elapsed+total; `resume` already continues them; `end` already freezes) — only
  which controls are *exposed*, and when.
- No change to the cost engine, overlay, adapter, or message bridge.

## Acceptance criteria

1. `sessionControls(status)` (new pure helper) returns the correct control set:
   - `idle` → `start` only.
   - `running` → `pause` + `end`.
   - `paused` → `resume` + `end`.
   - `ended` → `startNew` + `resume` (NOT empty — this is the fixed dead-end).
   It is table-tested over all four statuses (plus a safe default for unknown).
2. `PresenterControls` renders its session buttons from `sessionControls(...)`:
   an explicit **Start session** appears at `idle`; from `ended`, **both** a
   **Start new session** button (calls `sessionActions.start` → resets to $0) and a
   **Resume** button (calls `sessionActions.resume` → continues the frozen total)
   appear. Running/paused keep Pause / Resume counting / End exactly as before, and
   the overlay Show/Hide button is unaffected in every state.
3. No regression: existing tests pass and `npm test && npm run build` is green; the
   overlay, cost, and session-transition behavior are unchanged (only control
   visibility changed).
4. `reviews/backlog.md` #3 is updated to: Part A shipped (link
   `secret-scan-guardrails.md`), Part B pending a manual GitHub UI toggle, Part C /
   pre-push not pursued (2026-06-09, Thomas).
5. `reviews/backlog.md` gains an item recording the overlay auto-recover gap
   (shipped recovery does not fire on camera off/on; manual Hide→Show still needed)
   with the live repro, marked as needing a follow-up diagnostic story.
6. Scope containment: run `git diff --name-only main...HEAD` and verify no files
   appear beyond `client/src/lib/sessionControls.js`,
   `client/src/lib/sessionControls.test.js`,
   `client/src/components/PresenterControls.jsx`, `reviews/backlog.md`, and this
   story file (`reviews/session-restart-controls.md`).

## Test notes

- **AC1:** `sessionControls.test.js` — assert the exact control object for `idle`,
  `running`, `paused`, `ended`, and an unknown status (safe default). The `ended`
  case is the key regression guard: it must include `startNew` and `resume`.
- **AC2:** verified by reading `PresenterControls.jsx` — buttons gate on
  `sessionControls(session.status)`; `start`/`startNew` wire to
  `sessionActions.start`, `resume` to `sessionActions.resume`. The reset-vs-continue
  semantics are the existing, unchanged `sessionActions` (start zeroes
  elapsed/total refs; resume re-arms the tick from the frozen refs), so exposing the
  buttons is sufficient. Manual: from `ended`, "Start new session" shows $0 climbing;
  "Resume" continues from the ended total.
- **AC3:** `npm test && npm run build` green; existing `PresenterControls`-adjacent
  and cost/overlay tests unchanged.
- **AC4/AC5:** read `reviews/backlog.md` — #3 reflects A/B/C reality; a new
  auto-recover gap item exists with the repro.
- **AC6:** `git diff --name-only main...HEAD` shows no files beyond those AC6
  enumerates.

## Open questions

1. **Explicit Start at `idle`.** I included an explicit "Start session" button at
   `idle` (the overlay button still implicitly starts too) to close the backlog's
   "no explicit Start control at all" point. If you'd rather leave `idle` as-is and
   only fix the `ended` dead-end, say so and I'll drop it.
2. **Resume-from-ended label.** I'll label the ended-state continue button
   "Resume" (vs "Resume counting" used for paused). Fine, or prefer one consistent
   label?
