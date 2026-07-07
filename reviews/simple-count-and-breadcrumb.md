# simple-count-and-breadcrumb — Simple-mode count default + participant-fetch breadcrumb

Date: 2026-07-07 · Branch: claude/simple-count-and-breadcrumb · Status: approved

## Problem

Two small, related fixes from a live session (both about the Simple-mode attendee count and why it
can read wrong):

1. **Stale Simple-mode count.** `simpleUserCount` is **persisted** (`null` = track the live count; a
   number = a saved override — [usePresenterStore.js](../client/src/state/usePresenterStore.js#L97)).
   Switching to Simple mode shows the **stale saved number** from a past meeting, not the current
   headcount. In the live session it read "3" while the meeting's actual count was different.
2. **Participant-fetch failures are invisible.** When `getMeetingParticipants()` throws, the
   adapter's [`_refresh()` catch is silent](../client/src/zoom/zoomAdapter.js#L506) — it flips
   `_participantsAvailable=false` (the "Participants unavailable" banner) but logs nothing. So the
   server logs can't tell whether the cause is a **role** issue (not host/co-host) or a **config**
   issue (missing `getMeetingParticipants` capability/scope → a `40316`-style error) — the two have
   different fixes. The empty count in (1) is often downstream of this.

## In scope

- **Switching to Simple mode defaults the attendee count to the live/actual count** — reset
  `simpleUserCount` to `null` (track-live) on the transition into Simple mode, so a stale persisted
  override never carries in.
- **Every session boots in per-participant ("listed-member") mode** — on hydration, force
  `costModel` to `'perParticipant'` regardless of the saved value, so a persisted `'simple'` never
  carries across sessions. (Decided at the frame consult. Combined with the reset-on-switch above,
  this fully closes the stale-count-on-reload gap.)
- **Breadcrumb on the participant-fetch failure edge** — in RealZoom `_refresh()`, log the
  `getMeetingParticipants()` rejection reason (error message/code, shape only — never participant
  content) on the transition available→unavailable, and log recovery (with the aggregate count) on
  unavailable→available. **Edge-triggered** so a persistent failure doesn't spam every
  `onParticipantChange`.

## Non-goals

- Removing the "Collaborate" button — it is **Zoom platform chrome**, not our code (no "collaborate"
  in `client/src/**`); governed by the Marketplace app config, not changeable here.
- A self-heal retry/poll for participant recovery — separate follow-up (the breadcrumb is the
  prerequisite that tells us whether it's even needed).
- Changing the participant-unavailable banner UI or the matching/cost logic.
- The MockZoom adapter (its participant list is always available; breadcrumb is RealZoom-only).

## Acceptance criteria

1. **Switch-to-Simple resets the count.** Calling the cost-model action with `'simple'` sets
   `simpleUserCount` to `null`, so the Simple panel's attendee field shows the live count (not a
   stale override). Switching to `'perParticipant'` does not alter `simpleUserCount`.
1b. **Boots in per-participant mode.** After hydration, `costModel` is `'perParticipant'` even when
   the server-saved config had `'simple'`; a clean load does not write this override back (the
   `lastSavedRef` guard covers it).
2. **Failure breadcrumb (edge).** In RealZoom, when `getMeetingParticipants()` rejects and the list
   was previously available, `_refresh()` emits exactly one log entry carrying the error
   message/code (no participant data). A second consecutive failure emits **no** additional entry.
3. **Recovery breadcrumb (edge).** When a later `_refresh()` succeeds after a failure, it emits one
   recovery entry (may include the aggregate participant count; never names).
4. **No behavior regression.** `_refresh()` still sets `_participantsAvailable` exactly as before
   (true on success, false on throw); logging never changes the outcome or throws.
5. **Scope containment.** The diff touches only the files enumerated in Test notes.

## Test notes

- **AC1:** unit-test the pure cost-model transition helper (see sketch) — `'simple'` yields a patch
  with `simpleUserCount: null`; `'perParticipant'` yields none. Browser check: in Simple mode the
  attendee field reflects the live count after switching, not a previously-saved number.
- **AC2/AC3/AC4:** `client/src/zoom/zoomAdapter.test.js` — construct `new RealZoom(fakeSdk, { log })`
  with an injected log spy; a rejecting `getMeetingParticipants` → one failure log with the error;
  second reject → no new log; then a resolving call → one recovery log; assert `_participantsAvailable`
  transitions true→false→true regardless of logging.
- **AC5:** `git diff --name-only main...HEAD` shows no files beyond: `client/src/state/usePresenterStore.js`,
  `client/src/zoom/zoomAdapter.js`, `client/src/zoom/zoomAdapter.test.js`, and (if the helper is
  extracted) `client/src/lib/*.js` + its test — plus the review artifacts.
- Full gate: `npm test && npm run build` green.

## Open questions

_Both resolved at the frame consult — see Design decisions._
1. **Track-live vs. snapshot on switch** → **track-live** (null).
2. **Reload-in-Simple stale count** → solved not by dropping `simpleUserCount` persistence but by
   **booting every session in per-participant mode** (Thomas's call). `simpleUserCount` stays
   persisted; the boot-mode reset + reset-on-switch make its stale value unreachable.

## Design sketch — HOW

- **AC1 (Simple count):** in `usePresenterStore.setCostModel`, when `model === 'simple'`, the state
  patch also sets `simpleUserCount: null`. Extract a tiny pure helper — `costModelPatch(model) → {
  costModel, simpleUserCount? }` — in `client/src/lib/cost.js` (co-located with `simpleCountCommit`)
  and unit test it (design review approved this shape); the store spreads its result.
- **AC1b (boot in per-participant):** in the hydration effect, force the booted config's
  `costModel` to `'perParticipant'`: `const booted = { ...fixed, costModel: 'perParticipant' }`, and
  use `booted` uniformly — `setPersisted(booted)`, `lastSavedRef.current = booted`, and the dirty
  heal-save saves `booted`. So a clean load does **not** write the override back (guard:
  `persisted === lastSavedRef`), and new/mock loads already default `perParticipant` via
  `DEFAULT_CONFIG`. (Small enough to inline; a `bootConfig(config)` pure helper is optional.)
- **AC2–AC4 (breadcrumb) — with both adopted fixes:**
  - **Edge at commit time (fix 1):** centralize in `_setParticipantsAvailable(next, extra)` — it
    reads the *current* `this._participantsAvailable`, logs only on a change (unavailable edge with
    the error summary; available edge with the aggregate count via `logLifecycle`), then assigns
    `next`. `_refresh()` calls it **after** the await settles (success → `(true, {count})`, catch →
    `(false, {error: summary})`), so overlapping refreshes fired from `onParticipantChange` can't
    double-log or miss recovery.
  - **Structured error summary (fix 2):** a small `summarizeFetchError(err)` that **allowlists**
    scalar fields — `message`, `code`, `errorCode`, `status`, `reason` — with a safe string
    fallback, so the diagnostic `40316` code is captured and the payload is shape-bounded (never an
    arbitrary SDK object dump). Used only for the unavailable-edge log.
  - Reuses the injectable `this._log` + `logLifecycle` pattern (same as the media-change canary);
    best-effort, never alters `_participantsAvailable` or throws. No new capability/dependency/UI.
- **Error model:** logging is best-effort and swallowed (as the other adapter logs are); it never
  alters `_participantsAvailable` or rethrows.

## Build note (2026-07-07)

AC → file map:
- **AC1** (switch-to-Simple resets count) → `client/src/lib/cost.js` (`costModelPatch`) +
  `client/src/state/usePresenterStore.js` (`setCostModel`).
- **AC1b** (boot in per-participant) → `usePresenterStore.js` hydration effect (`booted`).
- **AC2–AC4** (participant-fetch breadcrumb, edge-triggered, shape-bounded) →
  `client/src/zoom/zoomAdapter.js` (`summarizeFetchError`, `_setParticipantsAvailable`, `_refresh`).
- **AC5** (scope) → also tests `client/src/lib/cost.test.js`, `client/src/zoom/zoomAdapter.test.js`.

## Codex design review (2026-07-07)

**Verdict:** *"The Simple-count half is sound — the `costModelPatch(model)` helper fits the repo's
pure-helper testing convention and no dependency would simplify it. The breadcrumb sketch is close,
but I would not build the edge guard exactly as written: the transition check should happen at
state-commit time, and the error payload should be an allowlisted structured summary rather than the
existing generic stringifier."*

### IMPORTANT — Edge detection snapshots availability too early _(two-way · kludgy)_
> The sketch reads `wasAvailable` **before** awaiting `getMeetingParticipants()`. `_refresh()` is
> fired from `onParticipantChange` without serialization, so overlapping refreshes can both snapshot
> `true` → duplicate "unavailable" logs, or snapshot `true` and then miss the recovery edge.
> - **alternative:** move the transition test to the **commit point** after the await settles —
>   centralize in a small `_setParticipantsAvailable(next, extra)` that reads current
>   `this._participantsAvailable`, logs only on change, then assigns.
> - **win:** one invariant owns edge logging; overlapping refreshes can't double-log or miss
>   recovery. Tests can assert the helper directly or via `_refresh()`.

### IMPORTANT — Generic `errMsg` doesn't satisfy "message/code, shape-only" _(two-way · nonstandard)_
> Reusing `errMsg(err)` returns only `.message` for `Error`s and JSON-stringifies arbitrary object
> rejections — it can **drop the error code** (the `40316` that distinguishes a config problem from
> a role problem) and fails the shape-only boundary for object errors.
> - **alternative:** a small participant-fetch error summarizer that **allowlists** scalar fields
>   (`message`, `code`, `errorCode`, `status`, `reason`) with a safe string fallback; log that
>   structured object.
> - **win:** the breadcrumb reliably carries the diagnostic code the ACs ask for, and the log
>   surface is constrained to known-safe fields instead of dumping unknown SDK error objects.

## Codex approach review (2026-07-07, base main, HEAD 696981d)

**Verdict:** *"Sound, modern shape for the spec. I would satisfy the ACs the same way: keep the
Simple-mode transition as a tiny pure state patch, force the hydrated boot config to `perParticipant`
while reusing the existing `lastSavedRef` clean-load guard, and centralize RealZoom
participant-availability edge logging at the commit point with an allowlisted error summary. No
dependency or framework construct would delete meaningful complexity here, and the branch stays
scoped to the story files."*

**Findings:** none.

## Design decisions (2026-07-07)

Thomas approved scope (Simple-mode count default + participant-fetch breadcrumb, one story) and
ratified:

- **Both codex breadcrumb fixes → adopt.** (1) Edge check at commit-time via a central
  `_setParticipantsAvailable(next, extra)` (race-safe). (2) Allowlisted `summarizeFetchError`
  capturing `message`/`code`/`errorCode`/`status`/`reason` so the `40316` code is logged.
- **Switch-to-Simple → track-live** (reset `simpleUserCount` to `null`).
- **Reload path → boot every session in per-participant mode** (force `costModel` to
  `'perParticipant'` on hydration), rather than dropping `simpleUserCount` persistence. Combined
  with reset-on-switch, the stale count is unreachable.
