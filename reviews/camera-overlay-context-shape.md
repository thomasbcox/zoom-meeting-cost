# camera-overlay-context-shape

Date: 2026-06-06 · Branch: claude/camera-overlay-context-shape · Status: approved

> **Approved (2026-06-06, Thomas):** "discard the raw response; approve." Open
> question resolved: `RealZoom.init()` returns only the normalized
> `context: { runningContext }` and discards the raw `getRunningContext()` response.

## Problem

The live camera overlay never composites: clicking "Show cost on video" runs
`runRenderingContext` (logged `ok:true`) but **no `drawParticipant`/`drawWebView`
ever fire** — the spawned `inCamera` instance never reaches the draw path.

Root cause (found by Codex consultation, then verified against
`node_modules/@zoom/appssdk/dist/sdk.d.ts`): **`sdk.getRunningContext()` returns
`RunningContextResponse = { context: RunningContext }`** (sdk.d.ts:1101–1103) — the
running-context string is under `.context`. But `RealZoom.init()`
(`client/src/zoom/zoomAdapter.js:214`) returns that raw object as `context`, and
`Root.jsx:36` reads `context?.runningContext`. So for a real instance,
`context?.runningContext` is **always `undefined`** → `renderModeFor(undefined)`
→ `'panel'` (`client/src/lib/renderMode.js`). A real `inCamera` instance therefore
mounts `App` instead of `OverlayApp`, `drawCameraOverlay()` is never called, and
nothing composites — exactly matching the zero-draw logs.

Note the contrast: **`config()`** returns `ConfigResponse.runningContext`
(sdk.d.ts:1049, the `runningContext` name), while **`getRunningContext()`** uses
`{ context }`. We read the wrong one's property name off the latter.

Two things hid this:
- **The mocks used the non-SDK shape.** The fake SDK in `zoomAdapter.test.js`
  returns `{ runningContext: 'inMeeting' }`, and `MockZoom.init()`
  (`zoomAdapter.js:83`) returns `context: { runningContext: 'inMeeting', … }`. The
  real `getRunningContext()` `{ context }` shape was never exercised, so the gate
  stayed green over the bug.
- **`getRunningContext` was never instrumented**, so the live logs never showed the
  resolved value.

Full investigation + verified Codex output: `docs/camera-overlay-no-draw.md` and
`docs/camera-overlay-no-draw.codex.json` (currently uncommitted on `main`; folded
into this branch).

Codex also flagged a secondary robustness bug: in `RealZoom.drawCameraOverlay()`,
`drawParticipant` is awaited **before** `drawWebView`. `drawParticipant` is
Host/Co-Host-only (sdk.d.ts:4724) while `drawWebView` is broader, so a base-layer
permission failure currently aborts the whole draw and suppresses the meter even
when the meter itself could render.

## In scope

- **Normalize the running context in `RealZoom.init()`** so the adapter's `init()`
  contract is "`context.runningContext` is the canonical running-context string."
  Read `getRunningContext()` as `raw?.context ?? raw?.runningContext` and return a
  normalized `context: { runningContext }`. `Root.jsx` and `renderModeFor` stay
  unchanged; a real `inCamera` instance then routes to overlay mode. (BLOCKER #1)
- **Fix the test fake to the real SDK shape** — the fake `getRunningContext()`
  returns `{ context: … }` — and **add an adapter routing test** proving a
  real-shaped `inCamera` response yields `context.runningContext === 'inCamera'`
  (→ `renderModeFor` → `'overlay'`). (IMPORTANT #2)
- **Make the participant base layer optional** in `RealZoom.drawCameraOverlay()`:
  catch a `drawParticipant` failure (it is still logged `ok:false` via the existing
  `_instrument` path) and continue to `drawWebView`, so the meter renders even if
  the base layer can't be drawn. (IMPORTANT #3)
- **Fold the investigation docs** (`docs/camera-overlay-no-draw.md`,
  `docs/camera-overlay-no-draw.codex.json`) into this branch.

## Non-goals

- **`onRenderedAppOpened` + Marketplace camera-mode surface/capability checks**
  (Codex QUESTION #4) — deferred to the post-fix live verification run. We are not
  registering that event or changing Marketplace config here.
- **Changing `MockZoom`'s internal `init()` shape.** `MockZoom` is the prototype's
  own object, not the real SDK; it already returns the canonical
  `context: { runningContext }`, so it needs no change. Only the `RealZoom`/real-SDK
  path consumed the wrong shape.
- **Using `config().runningContext`** as the source. `getRunningContext()` (now read
  correctly) remains the authority; we do not add a second source.
- Any change to the draw geometry, `renderTarget`, `participantUUID` resolution, the
  message bridge, or `CostOverlay` rendering.
- Running the live in-Zoom verification itself (manual, post-merge).

## Acceptance criteria

1. **Canonical context from `RealZoom.init()`.** Given a fake SDK whose
   `getRunningContext()` returns `{ context: 'inCamera' }`, `RealZoom.init()`
   resolves with `context.runningContext === 'inCamera'`; with `{ context: 'inMeeting' }`
   it resolves `'inMeeting'`. (Reads `raw?.context ?? raw?.runningContext`.)
2. **Real routing works end-to-end at the boundary.** `renderModeFor` applied to the
   `init()`-returned `context.runningContext` yields `'overlay'` for a real-shaped
   `inCamera` response and `'panel'` for `inMeeting` — proving a real camera instance
   would mount `OverlayApp`.
3. **Test fake uses the real SDK shape.** The fake `getRunningContext()` in
   `zoomAdapter.test.js` returns `{ context: … }` (not `{ runningContext: … }`), and a
   new test covers AC1/AC2. Existing RealZoom tests still pass.
4. **Participant base layer is optional.** In `RealZoom.drawCameraOverlay()`, when
   `drawParticipant` rejects, the failure is still logged (`ok:false`) and
   `drawWebView` is **still called** (asserted via a fake where `drawParticipant`
   rejects but `drawWebView` records its call).
5. **No regression to instrumentation/contract.** `drawParticipant` success still
   logs `ok:true`; `drawWebView` still logs its outcome; `MockZoom` call-sequence
   tests unchanged.
6. **Gate green.** `npm test && npm run build` passes; investigation docs are
   committed on this branch.

## Test notes

- **AC1/AC2/AC3** — extend `client/src/zoom/zoomAdapter.test.js`: change the fake
  `getRunningContext()` to `{ context: 'inMeeting' }`; add a case constructing a fake
  returning `{ context: 'inCamera' }`, call `RealZoom.init()`, assert the returned
  `context.runningContext`, and assert `renderModeFor(context.runningContext)` is
  `'overlay'`/`'panel'` accordingly. (`renderMode.js` already has its own unit test.)
- **AC4** — add a fake whose `drawParticipant` rejects (existing `drawRejects` makes
  both reject; add a `participantDrawRejects`-only switch) and assert `drawn` contains
  the `drawWebView` entry and a `drawParticipant` `ok:false` log entry was emitted,
  and `drawCameraOverlay()` does **not** reject.
- **AC5** — existing MockZoom and instrumentation tests remain green unchanged.
- **AC6** — `npm test && npm run build`.

## Open questions

1. After AC1, `RealZoom.init()` returns `context: { runningContext }` — a *normalized*
   object, not the raw SDK response. Confirm that discarding the raw `getRunningContext`
   response (we don't use any other field of it) is fine, vs. preserving it under a
   different key. Proposed: return only the normalized `{ runningContext }`.

## Build note (2026-06-06)

AC → file map:

- **AC1** (normalize running context) — `client/src/zoom/zoomAdapter.js` (`RealZoom.init`)
- **AC2/AC3** (routing + fake real shape + tests) — `client/src/zoom/zoomAdapter.test.js`
- **AC4** (participant base layer optional) — `client/src/zoom/zoomAdapter.js` (`RealZoom.drawCameraOverlay`)
- **AC5** (no instrumentation/MockZoom regression) — covered by existing tests
- **AC6** (gate + docs folded) — `docs/camera-overlay-no-draw.md`, `docs/camera-overlay-no-draw.codex.json`

`git diff --stat main...HEAD`:

```
 client/src/zoom/zoomAdapter.js          |  22 ++-
 client/src/zoom/zoomAdapter.test.js     |  54 ++++++-
 docs/camera-overlay-no-draw.codex.json  |   1 +
 docs/camera-overlay-no-draw.md          | 250 +++++++++++++++++++++++++++++++
 reviews/camera-overlay-context-shape.md | 124 +++++++++++++++
 5 files changed, 442 insertions(+), 9 deletions(-)
```

## Codex review (2026-06-06, base main, HEAD f061357)

**Summary:** Reviewed `git diff main...HEAD`, the spec, the background doc, and the
SDK type ground truth. The branch implements the requested running-context
normalization, updates the fake to the SDK `{ context }` shape with routing coverage,
and makes `drawParticipant` best-effort while preserving `drawWebView` failure
behavior. **No spec or diff-grounded issues found** (empty findings). (Codex could not
run the gate in its read-only sandbox — Vitest temp-file EPERM — but our gate is green:
95 tests + build.)
