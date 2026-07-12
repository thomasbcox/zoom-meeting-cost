# Camera overlay — live-test matrix

> **⚠️ SUPERSEDED BY DECISION (2026-07-01) — reference only, not an active gate.** Thomas chose to
> resolve the `drawWebView`/ZSEE-195647 live-render risk by **setting a minimum supported client
> version (Zoom Workplace 7.1.0+) and documenting a user-facing warning** (README + docs site),
> rather than running this matrix or building a `drawImage` fallback. The overlay is confirmed
> working across weeks of real meetings on current builds. This document (and the operator guide)
> are **kept for reference** in case a future issue reopens the question — they are no longer on the
> critical path. See [`roadmap.md`](roadmap.md) → live-render callout.

Status: **draft (superseded)** · Created 2026-06-11 · Owner: Thomas
Relates to: `dev-docs/roadmap.md` (🔴 live-render risk), `reviews/camera-overlay-message-bridge.md`,
`dev-docs/camera-overlay-no-draw.md`, `dev-docs/camera-overlay-no-update.md`,
memory `reference-zoom-prod-unknowns-research`.

## Why this exists

Two things about the camera overlay are **unverified in real Zoom** and block treating it
as production-ready:

1. **Does `drawWebView` actually composite the meter?** An active Zoom regression —
   **ZSEE-195647** — makes `runRenderingContext({view:'camera'})` + `drawWebView()` resolve
   `ok:true` but render **nothing** on **Zoom Workplace 6.7.8 / 7.0.2**. Reported workaround
   (2026-05-02): use **`drawImage` instead of `drawWebView`**. Our overlay is entirely
   `drawWebView`-based and logs success even when blank.
2. **Does the (already-working) live channel still drive the meter on current builds?**
   The panel→camera data channel was **verified live 1:1** at PR #17 (`overlay-payload-parse`,
   `overlay-logging-quiet`) and drawing/auto-recovery was confirmed 2026-06-10 — but both on
   the *then-current* client. The open risk is whether the same channel still updates visible
   pixels once `drawWebView` rendering is in question (item 1). This is a regression
   re-confirm, not a first-time verification.

This matrix is the protocol to settle both across the client builds our users actually run,
and to decide whether we need a `drawImage` fallback before launch.

> **⚠️ Two traps that produce false "it works" / false "it's broken" readings:**
> - **`drawWebView` returns `ok:true` even when it renders nothing** (the ZSEE regression).
>   So the **server log is NOT proof of compositing** — you must *visually* confirm the meter
>   on the video (ideally from a second participant's view, not just self-view).
> - **The overlay extrapolates locally** (`OverlayApp` re-renders every 250 ms and advances
>   the total from the last snapshot via `extrapolateOverlay`). So **"the numbers are moving"
>   does NOT prove the live channel is flowing** — a frozen channel still ticks smoothly off
>   one stale snapshot. The decisive channel-liveness probe is a **status change**
>   (pause/resume on the panel), which must appear on the overlay *and* emit a new
>   `overlay-message` log on the camera side.

## What is already instrumented (use these signals)

All client events POST to `/api/log` (kind shown). De-interleave by timestamp.

| Signal | Kind / method | Proves |
|---|---|---|
| Panel booted & routed | `panel-mounted` | inMeeting instance is the panel |
| Camera instance mounted | `overlay-mounted` (`transparentBody:true`) | a real `inCamera` instance exists & routed to `OverlayApp` |
| Routing/init failure | `init-error` | `Root` fell back to panel (no camera instance) |
| Context entered | `zoom-overlay` / `runRenderingContext` `ok` | camera rendering context opened |
| Base video drawn | `zoom-overlay` / `drawParticipant` `ok` | presenter video composited (host/co-host) |
| **Meter drawn** | `zoom-overlay` / `drawWebView` `ok` | **call accepted — NOT that pixels rendered** (see trap) |
| Panel → camera send | `zoom-overlay` / `postMessage` `ok` (**first success only** + every failure) | panel is pushing snapshots |
| **Camera received** | `overlay-message` (first + each status change) | **the channel actually reaches `inCamera`** |
| Teardown | `closeRenderingContext` | the camera instance/context went away |
| Camera on/off poll | `media-change` (+ overlay-rearm) | auto-recover sampling |

**Important — steady-state sends/receipts are silent by design** (`overlay-logging-quiet`,
PR #18). `postMessage` logs only the **first** successful send + every failure (a
`_firstPostLogged` guard), and `overlay-message` logs the first snapshot then only on
**status change** — neither logs per-tick, and never logs values. So the per-tick logs are
NOT available to prove the channel, which is exactly why:
- the protocol uses a **status change (pause/resume)** as the decisive liveness probe — it
  forces a fresh `overlay-message`; and
- **optionally, for the live run, temporarily re-enable verbose send/receipt logging** (the
  debug-era "log every send / every receipt") so you can see the 1:1 `postMessage`↔
  `overlay-message` cadence directly. Revert it after — it's a steady-state firehose.

> **Scope note (what this matrix is really testing).** The data channel itself was already
> **verified live 1:1** (panel `postMessage ok` ↔ camera `overlay-message`, every second) on
> the build current at PR #17 (`overlay-payload-parse`, `overlay-logging-quiet`). So the open
> question is **not** "does the channel work" — it's **does `drawWebView` still RENDER pixels
> on current Workplace builds** (ZSEE-195647), and does the (already-working) channel still
> drive those pixels there. Treat the liveness probe as a regression re-confirm, and weight
> the **visual** compositing check (step 4) as the primary unknown.

## Prerequisites

- A real Zoom meeting; the app installed and opened in-meeting (presenter = host or co-host,
  required for `drawParticipant`).
- Build served with `VITE_USE_ZOOM=1` (RealZoom), live on the Railway/Marketplace domain.
- Marketplace config complete for camera mode: all `ZOOM_CAPABILITIES` added under
  **Features → Zoom App SDK** (incl. `getAppContext`), mirroring `zoomSdk.config()`. **Surface-gate
  question RESOLVED (2026-07-01):** there is **no** separate "Camera" / Meeting Component surface —
  the API list under Features → Zoom App SDK (matching `config()`) + the **Domain Allow List**
  (app URL + `appssdk.zoom.us` + CDNs) are the real gates; the Surface step just selects the
  *product* (enable Meetings). See [`overlay-live-test-guide.md`](overlay-live-test-guide.md)
  → Pre-flight for detail + the user-managed-app caveat.
- Live access to the server `/api/log` stream while testing.
- At least **two** participants when possible (one presenter, one observer) so you can confirm
  the overlay as *others* see it, not only self-view.

## Environment matrix

Run the protocol on each row. The regression is client-version-specific, so version coverage
is the point.

| # | Zoom client | OS | Notes |
|---|---|---|---|
| E1 | **Workplace 7.0.2** | macOS | ⚠️ named in ZSEE-195647 — expected failure candidate |
| E2 | **Workplace 6.7.8** | macOS | ⚠️ named in ZSEE-195647 |
| E3 | Latest Workplace (current GA) | macOS | the build you confirmed working 2026-06-10 — baseline |
| E4 | Latest Workplace (current GA) | Windows | OS-portability check |
| E5 | One older GA (e.g. 6.5.x) | macOS | broader version sensitivity (devforum reports) |

Record the **exact** client build string (Zoom → About) for each run — "latest" drifts.

## Test protocol (per environment row)

1. Open the app panel in-meeting. **Expect:** `panel-mounted`, no `init-error`.
2. Configure a rate (or simple mode) so the panel computes a non-zero cost; start the session.
   **Expect:** panel shows a running, increasing total.
3. Click **"Show cost on video."** **Expect log:** `runRenderingContext ok` →
   `overlay-mounted (transparentBody:true)` → `drawParticipant ok` → `drawWebView ok`.
   - If `overlay-mounted` never appears → routing/instance failure (not the regression). See D1.
4. **VISUALLY confirm** the meter is composited on the presenter's video — **from another
   participant's view** if possible. This is the decisive compositing check, independent of
   the `drawWebView ok` log.
5. Watch the meter for ~15 s. It should *appear* to tick (extrapolation). (Not yet proof.)
6. **Liveness probe — pause then resume the session on the panel.** **Expect:** the overlay
   reflects paused→running within ~1 s, **and** the camera logs a new `overlay-message`
   with the changed `status`. This proves the live channel, not just extrapolation.
7. Toggle the camera off → on (>2 s). **Expect:** overlay auto-recovers (rearm), meter
   returns. (Already confirmed on baseline; re-confirm per build.)
8. Click **Hide**. **Expect:** `closeRenderingContext`; meter disappears.

Record each row's outcome in the results table below.

## Failure-isolation decision tree

- **D1 — No `overlay-mounted` / `init-error` present.** The `inCamera` instance never routed
  to `OverlayApp` (regression in context-shape routing, or a thrown init). Not ZSEE. Fix
  routing; re-run. (History: this was the `camera-overlay-context-shape` bug.)
- **D2 — `drawWebView ok:true` but NOTHING visible on the video (esp. confirmed from another
  participant).** → **This is the ZSEE-195647 regression.** Note the build. If it reproduces
  on any build our users run → trigger the **`drawImage` fallback** (below).
- **D3 — Meter draws, but the liveness probe (step 5) does NOT update / no new
  `overlay-message`.** The data channel isn't reaching `inCamera`. Re-examine `postMessage`
  (panel `postMessage ok`?) vs receive (`overlay-message` absent?). If panel sends but camera
  never logs receipt → the `postMessage`→`onMessage` path is failing on this build despite the
  canonical sample; consider the server-relay fallback (superseded earlier, but resurrect if
  the SDK path proves unreliable in the field).
- **D4 — Draws and updates correctly.** ✅ This build passes. Baseline-confirm and move on.

## Pass / fail criteria

- **PASS for a build** = steps 3–6 all succeed *visually* (compositing confirmed from a
  second view) AND the liveness probe (step 5) updates with a matching `overlay-message`.
- **Overall production gate** = PASS on the current GA build (E3/E4) at minimum. A failure on
  E1/E2 (6.7.8/7.0.2) that reproduces on builds our users run forces the `drawImage` fallback
  before launch.

## Results (fill in)

| Env | Client build (exact) | overlay-mounted | drawWebView ok | Composited (visual, 2nd view) | Liveness probe (pause/resume) | Verdict | Notes |
|-----|----------------------|-----------------|----------------|-------------------------------|-------------------------------|---------|-------|
| E1 | | | | | | | |
| E2 | | | | | | | |
| E3 | | | | | | | |
| E4 | | | | | | | |
| E5 | | | | | | | |

## Contingent follow-up — `drawImage` fallback (only if D2 reproduces)

> **⚠️ You probably can't feature-detect the failure at runtime.** The whole trap is that
> `drawWebView` returns `ok:true` while rendering nothing — there is no error to branch on.
> So "try `drawWebView`, fall back to `drawImage` on failure" is likely **not** implementable
> as runtime detection; the realistic options are (a) **always** use `drawImage`, or (b)
> **gate by client version** (the matrix tells you which builds are affected). Decide which
> before building — and note (b) needs a reliable client-version signal from the SDK.

If `drawWebView` no-ops on builds our users run, frame a story to render the meter to a
bitmap/canvas and composite via **`drawImage`** instead:

- Render `CostOverlay` to an offscreen canvas in the `inCamera` instance (or generate the
  meter image), then call `drawImage` with the same rect/zIndex the current `drawWebView`
  path uses (`runCameraDraw` / `RealZoom.drawCameraOverlay`).
- Keep the privacy invariant: still only aggregates reach the camera instance.
- Re-tick: redraw the image on each snapshot/extrapolation step (cadence vs cost tradeoff).
- Instrument `drawImage` like the others (`zoom-overlay` / `drawImage` ok/fail), and add it to
  `ZOOM_CAPABILITIES` + the Marketplace API list.
- Decide: fallback always, or feature-detect/branch by whether `drawWebView` composited.

Re-run this matrix against the fallback before closing the gate.
