# presenter-honesty

Date: 2026-06-04 · Branch: claude/presenter-honesty · Status: approved

> **Approved (2026-06-04, Thomas):** "default presenter name is 'Presenter'
> unless the presenter has set their name in Zoom in which case use that."
> Resolves the open question — fallback is `'Presenter'`, not `'Thomas Cox'`.

Combines backlog items **#1** (presenter identity) and **#3** (participant-fetch
failure UX) from `reviews/backlog.md` — both are the same concern: the real-Zoom
adapter→UI path should tell the truth instead of showing prototype defaults.

## Problem

1. **Wrong presenter name.** `App.jsx` seeds the presenter name from a hardcoded
   `'Thomas Cox'`, and `Root.jsx` destructures only `{ context, participants }`
   from `adapter.init()` — silently dropping the `self` the adapter already
   returns. So inside real Zoom the presenter's name never reflects the actual
   signed-in user.

2. **A failed participant fetch looks like a valid $0 meeting.** `RealZoom._refresh()`
   swallows `getMeetingParticipants()` errors and leaves the participant list
   empty. `getMeetingParticipants` needs host/co-host + scope, so a non-host sees
   a plausible-but-wrong **$0** meeting with no signal that the data is simply
   unavailable.

## In scope

- Thread `self` from `adapter.init()` through `Root` → `App`; seed the presenter
  name from `self.displayName`, falling back to the current default when `self`
  (or its `displayName`) is unavailable. The name stays user-editable.
- Track participant-list availability on the adapter and expose it; render a
  distinct "participants unavailable / need host access" state in the presenter's
  **side-panel readout** instead of the $0 cost screen when the fetch failed.

## Non-goals

- Propagating the "unavailable" state through the postMessage bridge to the
  **camera overlay** (`buildOverlayState` / `OverlayApp`). The overlay sanitized
  payload is unchanged; this story fixes the presenter-facing panel only. (Logged
  as a follow-up if wanted.)
- Any change to MockZoom's prototype behavior — it always has participants
  available, so the prototype looks and behaves exactly as today.
- The unresolved `drawWebView` `webviewId` question (backlog #4) and CSP
  hardening (#5) — separate items.

## Acceptance criteria

1. `Root.jsx` captures `self` from `adapter.init()` and passes it to `App`; the
   init-failure fallback path passes `self` as `undefined` (no crash).
2. A pure helper derives the seed presenter name from `self` — returns a trimmed
   `self.displayName` when present, otherwise the default `'Presenter'`. `App`
   seeds its editable name state from this helper.
3. Both adapters expose participant-list availability via
   `participantsAvailable()`: `MockZoom` always returns `true`; `RealZoom`
   returns `false` after a failed `getMeetingParticipants()` and `true` after a
   successful one (tracked in `_refresh()`).
4. When `participantsAvailable()` is `false`, `App`'s presenter readout shows an
   explicit "participants unavailable / need host access" notice **instead of**
   the cost screen; when `true`, behavior is unchanged.

## Test notes

- **AC2** — unit-test the pure name helper: `displayName` present → trimmed name;
  `self` undefined / `displayName` empty/whitespace → `'Presenter'`. (Node-env,
  no jsdom — same style as the existing `lib/*.test.js`.)
- **AC3** — extend `client/src/zoom/zoomAdapter.test.js`: drive `RealZoom` with a
  fake SDK whose `getMeetingParticipants` rejects → `participantsAvailable()` is
  `false` and the list is empty; with one that resolves → `true` and the list
  populates. Assert `MockZoom.participantsAvailable()` is `true`.
- **AC1 / AC4** — `App`/`Root` use hooks and aren't render-tested in this
  node-env harness; verified by reading the threaded prop + the gated render
  branch, and covered indirectly by the pure helper (AC2) and adapter flag (AC3).
  Confirmed green via `npm test && npm run build`.

## Open questions

_None — resolved at approval: fallback name is `'Presenter'`._

## Build note (2026-06-04)

AC → file map:
- **AC1** (thread `self`): `client/src/Root.jsx`
- **AC2** (seed name from `self`): `client/src/lib/presenterName.js` (+ `.test.js`), `client/src/App.jsx`
- **AC3** (`participantsAvailable()`): `client/src/zoom/zoomAdapter.js` (+ `.test.js`)
- **AC4** (unavailable notice): `client/src/App.jsx`

`git diff --stat main...HEAD`:
```
 client/src/App.jsx                   | 32 +++++++++++++--
 client/src/Root.jsx                  |  7 ++--
 client/src/lib/presenterName.js      | 15 +++++++
 client/src/lib/presenterName.test.js | 30 ++++++++++++++
 client/src/zoom/zoomAdapter.js       | 20 ++++++++-
 client/src/zoom/zoomAdapter.test.js  | 33 ++++++++++++++-
 reviews/presenter-honesty.md         | 78 ++++++++++++++++++++++++++++++++++++
 7 files changed, 205 insertions(+), 10 deletions(-)
```
