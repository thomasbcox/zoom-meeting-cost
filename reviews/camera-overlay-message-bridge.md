# camera-overlay-message-bridge

Date: 2026-06-07 · Branch: claude/camera-overlay-message-bridge · Status: approved

> **Approved (2026-06-07, Thomas):** "1 remove; 2 log every one — we're still
> debugging and we need data; approve." Open questions resolved: (1) remove
> `connect`/`onConnect` entirely; (2) log **every** `postMessage` send outcome
> (ok/fail), not just the first, to aid live debugging.

## Problem

After `camera-overlay-context-shape` (PR #14), the overlay **draws** on the camera
(`drawParticipant` + `drawWebView` both `ok:true` live) but the meter is **frozen on
its first/empty snapshot** — it never updates with the panel's live numbers.

We feed the camera via the Zoom **app-instance communication** APIs and wrapped
`postMessage` in a `connect`/`onConnect` handshake (`RealZoom`: hold `_pendingMsg`
until `_connected`, flush once on `onConnect` success, then per-tick `_send`). But:

- The official Zoom camera-mode sample (`zoom/zoomapps-cameramode-vuejs`) shows the
  correct pattern: the in-meeting instance calls `zoomSdk.postMessage({...})`
  **directly — no `connect()`, no `onConnect` gating** (`client/CameraCard.vue`), and
  the `inCamera` instance just listens via `onMessage` with **no `connect()`**
  (`client/CameraMode.vue`). `connect`/`onConnect` is the meeting↔**main-client**
  mirroring feature only (sdk.d.ts:4485 — *"communicate with the instance running on the
  main client"*).
- Our `connect()` targets the main client, not the camera; the gate it drives is
  fragile (resets on each instance reload, can strand `_pendingMsg` forever). Live logs
  match: the camera received at most one early (zero) snapshot, then nothing.

So the data channel is right (`postMessage`→`onMessage` **does** reach `inCamera`, per
the sample), but we throttled it behind a handshake that doesn't apply. The fix is a
**simplification**: send directly, drop the `connect` machinery from the overlay path.

Full investigation + sources: `docs/camera-overlay-no-update.md`,
`docs/camera-overlay-no-update.codex.json`, `docs/camera-overlay-no-draw.md`
(uncommitted on `main`; folded into this branch).

> Note: this supersedes the earlier "build a server relay" idea (Codex's docs-only
> read that `onMessage` can't reach `inCamera`). The canonical sample shows it can — no
> relay, no channel key needed.

## In scope

- **Remove the `connect`/`onConnect` handshake from the overlay path.**
  - Drop `'connect'` and `'onConnect'` from `ZOOM_CAPABILITIES`.
  - `RealZoom.init()` no longer calls `sdk.connect()` or registers `sdk.onConnect`.
  - `RealZoom` constructor drops `_connected` and `_pendingMsg`.
- **Panel sends directly.** `RealZoom.postMessage(payload)` calls `sdk.postMessage`
  unconditionally (no pending/gating), matching the sample. Keep the `onMessage`
  receive registration in `init()` and `RealZoom.onMessage()` subscription unchanged.
- **Log every send (debugging).** Each `postMessage` send logs a `zoom-overlay`/
  `postMessage` `ok:true`/`ok:false` outcome (not just the first), and a send rejection
  must not throw. (Resolves OQ2.)
- **Docs/comments/mocks.** Update `server/zoom-app-config.md` and the adapter comments
  to stop describing `connect`/`onConnect` as part of the overlay bridge; keep `MockZoom`
  (already connect-free, direct loopback) as the local model.
- **Fold in the investigation docs** (`docs/camera-overlay-no-update.md`,
  `docs/camera-overlay-no-update.codex.json`, `docs/camera-overlay-no-draw.md`,
  `docs/camera-overlay-no-draw.codex.json`).

## Non-goals

- **No server relay**, no new endpoints, no channel key — superseded (the sample proves
  `postMessage`→`onMessage` reaches `inCamera` directly).
- **No `onRenderedAppOpened`** wiring (not needed for the data channel).
- **No change to the payload / privacy contract** — `buildOverlayState` stays
  aggregate-only; nothing new leaves the panel.
- **No change to the draw path** (`drawCameraOverlay`/`renderTarget`/`participantUUID`)
  or `CostOverlay` rendering.
- **Main-client app-mirroring**: we have no feature that needs it, so `connect`/
  `onConnect` are removed rather than kept dormant (can be re-added if a mirroring
  feature is ever built). See Open questions.
- Running the live in-Zoom verification (manual; this branch makes it pass).

## Acceptance criteria

1. **No connect in the overlay path.** `ZOOM_CAPABILITIES` does not contain `'connect'`
   or `'onConnect'`; `RealZoom.init()` calls neither `sdk.connect()` nor `sdk.onConnect`;
   `RealZoom` has no `_connected`/`_pendingMsg` state.
2. **Direct send.** `RealZoom.postMessage(p)` forwards to `sdk.postMessage(p)`
   immediately and unconditionally. A sequence of calls reaches the fake SDK in order
   with no held/dropped messages.
3. **Receive intact.** `init()` still registers `sdk.onMessage` and dispatches to
   `RealZoom.onMessage()` subscribers; `OverlayApp` updates from it. The camera instance
   never calls `connect()`.
4. **Every send logged.** Each send logs a `zoom-overlay`/`postMessage` `ok:true` (and
   `ok:false` on rejection) — every call, not just the first; `postMessage` never throws
   synchronously and never surfaces an unhandled rejection.
5. **Docs/comments updated.** `server/zoom-app-config.md` no longer lists
   `connect`/`onConnect` under the overlay state bridge; adapter comments reflect the
   direct-send model.
6. **Tests green + docs folded.** `npm test && npm run build` passes (connect-gating
   tests replaced per Test notes); investigation docs committed on the branch.

## Test notes

- **`zoomAdapter.test.js`** —
  - Capability assertion: drop `'connect'`/`'onConnect'`; keep `'postMessage'`/`'onMessage'`.
  - **Remove** the gating tests: `calls sdk.connect() during init`, `holds messages
    until onConnect, then replays the latest`, `ignores a failed onConnect…`, and the
    `connect` success/failure `/api/log` tests.
  - **Add** a direct-send test: two `postMessage` calls land on the fake `sdk.posted`
    immediately and in order (no `fireConnect` needed).
  - **Keep** `does not throw/reject when sdk.postMessage rejects`. **Replace** the
    "logs only the FIRST postMessage send" test with one asserting **every** send logs
    an outcome (e.g. two sends → two `postMessage` log entries); keep the `ok:false`
    failure-log test.
  - Trim `makeFakeSdk`: remove `connect`/`onConnect`/`fireConnect`/`connectRejects`.
  - `MockZoom` loopback tests (`loops postMessage back…`, `replays the latest…`) unchanged.
- **AC6** — `npm test && npm run build`.

## Open questions

_Both resolved at approval (see header):_
1. **Remove `connect`/`onConnect` entirely vs. keep dormant?** → **Remove entirely.**
2. **Send-failure logging granularity.** → **Log every send outcome** (ok/fail), not
   just the first, while we're still debugging the live overlay.

## Build note (2026-06-07)

AC → file map:

- **AC1** (no connect in overlay path) — `client/src/zoom/zoomAdapter.js` (`ZOOM_CAPABILITIES`, `RealZoom` ctor + `init`)
- **AC2** (direct send) — `client/src/zoom/zoomAdapter.js` (`RealZoom.postMessage`)
- **AC3** (receive intact) — `client/src/zoom/zoomAdapter.js` (`init` onMessage; `onMessage`), `OverlayApp.jsx` unchanged
- **AC4** (every send logged) — `client/src/zoom/zoomAdapter.js` (`RealZoom.postMessage`)
- **AC5** (docs/comments) — `server/zoom-app-config.md`, adapter comments
- **AC6** (tests + docs folded) — `client/src/zoom/zoomAdapter.test.js`, `docs/`

`git diff --stat main...HEAD`:

```
 client/src/zoom/zoomAdapter.js           |  89 ++++---------
 client/src/zoom/zoomAdapter.test.js      |  92 +++----------
 docs/camera-overlay-no-update.codex.json |   1 +
 docs/camera-overlay-no-update.md         | 217 +++++++++++++++++++++++++++++++
 reviews/camera-overlay-message-bridge.md | 118 +++++++++++++++++
 server/zoom-app-config.md                |  13 +-
 6 files changed, 383 insertions(+), 147 deletions(-)
```

## Codex review (2026-06-07, base main, HEAD 4b2e4dc)

**Summary:** The branch implements the Zoom sample pattern — `connect`/`onConnect`
removed from capabilities and `init()`, `_connected`/`_pendingMsg` gone, direct sends
in place, docs mostly match. (Codex couldn't run the gate in its read-only sandbox; ours
is green: 92 tests + build.) 2 IMPORTANT + 1 NIT.

### IMPORTANT

1. **Synchronous postMessage throws still escape** — `zoomAdapter.js:353`. AC4 requires
   `postMessage` never throws synchronously, but `Promise.resolve(this._sdk.postMessage(payload))`
   calls the SDK before the promise chain exists; a *synchronous* throw escapes with no
   `ok:false` log. (The real SDK returns a Promise, so this is defensive, but AC4 says so.)
   *Suggestion:* wrap the SDK call in try/catch, emit `postMessage ok:false` on a caught
   throw, then chain on the result. Add a fake-SDK case where `postMessage` throws sync.
2. **RealZoom receive path is untested** — `zoomAdapter.test.js:186`. AC3 depends on
   `init()` registering `sdk.onMessage` and dispatching to `onMessage()` subscribers, but
   `makeFakeSdk` has no `onMessage` hook, so that path is never exercised — a regression
   breaking the inCamera receive path would still pass. *Suggestion:* add `onMessage(cb)` +
   a `fireMessage(payload)` helper to the fake and test that subscribers receive both
   `{ payload }` events and raw payloads.

### NIT

3. **Stale connect-bridge comment** — `zoomAdapter.js:177` still says RealZoom is exported
   so the "connect/postMessage bridge" can be tested. *Suggestion:* reword to the direct
   `postMessage`/`onMessage` model (part of AC5 cleanup).

## Decisions (2026-06-07)

Thomas: "let's do option 2 — cross your fingers and make it happen." Dispositions
chosen to be consistent with the **Option 2 (feedback-loop-first)** sequence:
restore sight → ship → verify live → harden.

- **IMPORTANT #1 (sync postMessage throw escapes) — FIX (clean, no try/catch).**
  Use `Promise.resolve().then(() => this._sdk.postMessage(payload))` so a synchronous
  throw becomes a rejected promise and is logged `ok:false` alongside async rejections.
  Rationale: a sync throw currently escapes *unlogged* — a blindness gap, which is
  exactly what Option 2's first step removes. (Test for the synchronous-send-order
  assertion will await microtasks since the send now defers one tick.)
- **IMPORTANT #2 (RealZoom receive path untested) — DEFER to the immediate post-verify
  hardening pass.** Adding a fake-based receive-path test now would ratchet a model we
  have not yet confirmed live — the trap our own critique named. Option 2 schedules
  fake-ratchet tests *after* live verification; revisit right after the next live run.
- **NIT #3 (stale connect-bridge comment) — FIX.** Reword to the direct
  postMessage/onMessage model (part of AC5 cleanup).

## Fixes (2026-06-07)

- **IMPORTANT #1 — applied (clean wrap, no try/catch).** `RealZoom.postMessage` now
  defers the SDK call via `Promise.resolve().then(() => this._sdk.postMessage(payload))`,
  so a synchronous throw becomes a rejected promise and is logged `ok:false` like any
  async rejection — never escaping to the caller (which posts from a React effect).
  Added a fake `postMessageThrowsSync` option + a test asserting a sync throw neither
  escapes nor goes unlogged; updated the in-order send test to await microtasks (send
  now defers one tick).
- **NIT #3 — applied.** Reworded the `RealZoom` export comment from "connect/postMessage
  bridge" to "direct postMessage/onMessage overlay bridge."
- **IMPORTANT #2 — deferred** (per Decisions): receive-path fake test revisited after the
  next live verification, to avoid ratcheting an unverified model.
