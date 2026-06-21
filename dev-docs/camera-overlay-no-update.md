# Consult brief — camera overlay draws but never updates (data channel)

**For:** independent review (Codex). **Date:** 2026-06-07.
**Repo:** `zoom-meeting-cost` — Zoom App showing live meeting cost on the presenter's video.
**Branch state:** `main` @ `322cad3` (includes the merged `camera-overlay-context-shape`
fix, PR #14, which made the `inCamera` instance route correctly and draw).

## TL;DR question

The camera overlay now **composites and draws** (`drawParticipant` + `drawWebView`
both `ok:true`), but the meter is **frozen on its first/empty snapshot** and never
updates with the live numbers the side panel is computing. We feed it via the Zoom
**app-instance communication** APIs (`connect` / `postMessage` / `onMessage`), and the
**`inCamera` instance's `connect()` is rejected** by Zoom. We suspect that channel is
the wrong mechanism for `inMeeting → inCamera`. **Is it? And what is the supported way
to push live data from the `inMeeting` (side panel) instance into the `inCamera`
(Layers rendering) instance?**

## Architecture (relevant slice)

Single React app, two instances by running context (verified working after PR #14):
- **Panel** (`inMeeting`) → `App`: computes cost, holds the private rate table, calls
  `runRenderingContext({view:'camera'})` to spawn the camera instance, and pushes
  aggregate snapshots.
- **Camera** (`inCamera`) → `OverlayApp` → `CostOverlay`: draws the presenter video
  (`drawParticipant`) + the meter webview (`drawWebView`), and renders whatever
  snapshot it has received.

Data channel today (`client/src/zoom/zoomAdapter.js`, `RealZoom`):
- Both instances `init()` → register `onMessage`, register `onConnect`, call `connect()`.
- Panel `postMessage(payload)`: holds the latest in `_pendingMsg` until `_connected`,
  then `_send()`; flushes the held payload once on `onConnect` success; per-second
  ticks then call `_send()`. Only the FIRST send is logged; later rejections are
  swallowed.
- Payload = privacy-safe aggregates only (`client/src/lib/overlayState.js`
  `buildOverlayState`): `{ status, totalCost, costPerSecond, elapsedSeconds, attendees,
  currency, updatedAt }`. The private rate table never leaves the panel.
- `OverlayApp` (`client/src/components/OverlayApp.jsx`) sets state from `onMessage` and
  extrapolates between updates. `CostOverlay` renders `null` for a falsy snapshot.

## Evidence (live Railway logs, de-interleaved)

```
GET / + assets → connect ok:true                          ← panel (inMeeting)
GET / + assets → connect ok:false
                 "API can only be called when the Zoom app is running in a meeting."  ← camera (inCamera)
later (per user click): postMessage ok:true · drawParticipant ok:true ·
                 drawWebView ok:true · runRenderingContext ok:true · connect ok:true
```

- The camera instance **draws** (drawParticipant/drawWebView `ok:true`).
- The camera instance's **`connect()` is rejected** ("…running in a meeting") at least
  on first boot; the panel's `connect()` succeeds.
- The repeated `runRenderingContext`/`GET /` correspond to the **user clicking "Show
  cost on video" several times** — NOT an automatic loop. Between clicks the camera
  instance is stable; the overlay just never changes values.
- On screen: panel shows e.g. `$1.30 / 0:00:31 / 1 attendee / running`; the overlay
  shows `$0.00 / 0:00:00 / 0 people` and stays there.
- We have **no receive-side instrumentation** (the camera's `onMessage` isn't logged),
  so we cannot directly confirm whether the camera ever receives a message.

## SDK ground truth (from `node_modules/@zoom/appssdk/dist/sdk.d.ts`)

- `connect()` (sdk.d.ts:4485): *"The API can only be called in meeting. Allows the App
  to communicate with the instance of the app running on **the main client**."*
  Category: **App Instances Communication**. Error 10039 = "Failed to connect with the
  app in main client."
- `postMessage()` (sdk.d.ts:4505): *"Send a message with the current state of the
  **mirrored app**."* Error 10041 = "app instances aren't connected"; 10038 = "Failed
  to post message to connect app." Category: **App Instances Communication**.
- `RunningContextResponse = { context }`; `RunningContext` includes `inCamera`,
  `inMeeting`, `inMainClient`, etc.
- `onRenderedAppOpened` (sdk.d.ts:5254, `@hidden`): *"Notifies the inMeeting instance
  of an app that a second instance of the app has been opened in the meeting for Layers
  API related rendering purposes."*

## Our hypothesis

`connect`/`postMessage`/`onMessage` is the **meeting ↔ main-client app-mirroring**
feature, not a panel→camera (Layers) channel. The `inCamera` rendering instance is not
a valid peer for `connect()` (hence the rejection), so the panel→camera stream never
forms and the overlay is stuck on its initial frame. If true, the fix is to replace the
overlay's data path with an **out-of-band channel** — e.g. a server relay: the panel
`POST`s the aggregate snapshot to our existing backend keyed by meeting, and the camera
instance pulls it (SSE or short poll). Zoom instance-comms drops out of the overlay path.

## Questions for Codex

1. **Is `connect`/`postMessage`/`onMessage` valid for `inMeeting → inCamera`**, or is it
   strictly meeting ↔ main-client mirroring? Ground the answer in the SDK type docs
   (supported contexts / category wording) and any error-code semantics. Does the
   `inCamera` instance's `connect()` rejection mean the bridge fundamentally can't carry
   panel→camera data?
2. **What is the supported/intended way to get live, panel-computed data into the
   `inCamera` Layers rendering instance?** Options to assess: (a) `connect`/`postMessage`
   after a retry/different trigger; (b) `onRenderedAppOpened` as the push trigger;
   (c) an out-of-band server relay; (d) something else. If you can infer what the
   official `zoomapps-cameramode-vuejs` sample does for dynamic data, say so (no network;
   reason from the SDK types + general Layers API design).
3. **Is a server relay the right call** given our constraints (privacy: only aggregates
   leave the panel; we already run a Node backend; meeting-scoped ephemeral state)? Note
   any pitfalls (per-meeting keying without leaking identity, auth between the two
   instances, latency vs. the current 1s tick, cleanup).
4. **If `postMessage` IS viable**, what specifically are we doing wrong (trigger, retry,
   which instance initiates `connect`, `onRenderedAppOpened`), and what's the minimal fix?
5. Any **correctness/privacy risks** in the proposed server-relay direction we should
   design against up front?

## Constraints / non-negotiables

- The private rate table, names, aliases, and per-person rates **must never** leave the
  panel. Only aggregate numbers may reach the camera/overlay.
- Prefer reusing the existing Node backend over new infra.
- The overlay must update at roughly the current cadence (~1s) and survive the camera
  instance reloading (it re-mounts on each "Show cost on video" click).

---

## Codex consultation (2026-06-07, read-only, repo @ 322cad3) — VERIFIED

**Verdict:** the brief's hypothesis is confirmed. `connect`/`postMessage`/`onMessage`
is the meeting ↔ main-client (mirrored-app) channel and **cannot feed the `inCamera`
Layers instance**. The fix is an out-of-band **server relay**.

**Claude verified against `node_modules/@zoom/appssdk/dist/sdk.d.ts`:**
- `onMessage` — *"Running context: inMeeting, inWebinar, inMainClient, inCollaborate"*
  (sdk.d.ts:5006). **`inCamera` is NOT listed** → the camera instance cannot receive
  `onMessage`. Decisive.
- `onConnect` (sdk.d.ts:4986): *"the instance of the app running in the meeting must
  communicate with the instance of the app running in the main client … can only be
  received in meeting."* Meeting↔main-client, not panel↔camera.
- `connect` (sdk.d.ts:4485): *"can only be called in meeting … communicate with the
  instance running on the main client."* The `inCamera` `connect()` rejection is
  fundamental, not a timing/retry issue.

### BLOCKER

1. **SDK messaging cannot feed `inCamera`.** `RealZoom.init()` registers
   `onMessage`/`onConnect` + `connect()` for both instances and `postMessage`s panel→
   camera, but `onMessage` excludes `inCamera` (sdk.d.ts:5006) and `OverlayApp` only
   updates from `adapter.onMessage()` (`OverlayApp.jsx:15`). The camera has no supported
   receive path → the overlay freezes on its first/empty frame. **VERIFIED.**
   *Suggestion:* remove `connect`/`postMessage`/`onMessage` from the camera-overlay data
   path; replace with an out-of-band relay.

### IMPORTANT

2. **Add a backend relay for overlay snapshots.** The backend exposes only
   health/log/OAuth/static (`server/src/app.js`). Add e.g. panel `POST /api/overlay/:channel`
   + camera `GET /api/overlay/:channel/stream` (SSE; short-poll fallback). Store only the
   latest snapshot (+ seq/updatedAt), replay immediately on subscribe (handles camera
   reloads), expire stale channels, delete on stop/end.
3. **Relay must enforce aggregate-only privacy server-side.** `buildOverlayState()` is
   aggregate-only today, but once it crosses the server, trusting client shape isn't
   enough; **do NOT reuse `/api/log`** (it logs arbitrary bodies — would leak cost data).
   Validate an exact aggregate schema, reject extra/private fields, don't log snapshots,
   rate-limit, and key channels by a meeting+presenter-scoped id (not raw public meeting ID).

### QUESTION

4. **Channel-key identity needs a live check.** Both instances must derive the same key.
   We request `getMeetingContext` but not `getMeetingUUID`; SDK exposes `getMeetingUUID()`
   (`meetingUUID`/`parentUUID`). Confirm `inCamera` can call the chosen identity API and
   sustain SSE/poll. Next live run: log redacted `runningContext` + meeting/participant
   ids from both instances, test camera short-poll vs SSE.

### NIT

5. **Adapter comments/mocks encode the wrong (impossible) bridge model** and the mock
   loopback makes it look valid in tests — update once the relay lands.

_Raw Codex output: `dev-docs/camera-overlay-no-update.codex.json`._

---

## Tier-2 research (2026-06-07): official sample OVERTURNS the relay conclusion

Fetched the official Zoom sample `zoom/zoomapps-cameramode-vuejs` (client-only; no
backend, no sockets). The canonical camera-mode messaging pattern:

- **Sender — `client/CameraCard.vue` (in-meeting instance):**
  `this.zoomSdk.postMessage({ message: this.postMessageValue })` — called **directly,
  with NO `connect()` and NO `onConnect` gating.**
- **Receiver — `client/CameraMode.vue` (inCamera instance):** registers
  `addEventListener("onMessage", ...)` and uses `getUserContext()` for
  `participantUUID`; draws `drawParticipant` (z1) + `drawWebView({webviewId:"camera"})`
  (z2) sized from `config.media.renderTarget`. **No `connect()` on the camera side.**
- `connect()` appears **nowhere** in the camera-messaging path. Routing uses
  `config().runningContext`.

**This contradicts the earlier docs-only BLOCKER** ("onMessage unsupported in inCamera",
from sdk.d.ts:5006). In the canonical sample `onMessage` DOES reach the `inCamera`
instance — you simply must not gate it on `connect`. `connect`/`onConnect` is the
meeting↔main-client mirroring feature only.

### Revised root cause

Our overlay never updates because **we wrapped `postMessage` in a `connect`/`onConnect`
gate** (`RealZoom`: hold `_pendingMsg` until `_connected`, flush once on `onConnect`
success, then per-tick `_send`). `connect()` targets the **main client**, not the camera;
the gate is fragile (resets on reload, can stall pending forever), so the camera receives
at most the one flushed (early/zero) snapshot. The official pattern fires `postMessage`
unconditionally every tick.

### Revised fix — a SIMPLIFICATION, not a server relay

- Panel: `postMessage(snapshot)` directly each tick; **remove** `connect` / `onConnect` /
  `_connected` / `_pendingMsg` from the overlay data path.
- Camera: keep the plain `onMessage` listener; **remove** its `connect()`.
- No channel key / no server relay needed (`drawParticipant ok:true` already proves
  `getUserContext()` works in `inCamera`).
- Keep `connect`/mirroring only if a future main-client feature needs it (currently none).
- Update the now-wrong adapter comments + mock loopback to match.

Supersedes the "server relay" recommendation above. Sources:
`zoom/zoomapps-cameramode-vuejs` — `client/CameraCard.vue` (sender, postMessage no connect)
and `client/CameraMode.vue` (receiver, onMessage no connect).
