# Camera overlay — live-test operator guide

> **⚠️ SUPERSEDED BY DECISION (2026-07-01) — reference only.** The live-test is no longer a launch
> gate: Thomas chose to set a **minimum supported version (Zoom Workplace 7.1.0+)** and document a
> user-facing warning instead of running the matrix / building a `drawImage` fallback. Keep this
> guide in case a future regression reopens the question. See
> [`overlay-live-test-matrix.md`](overlay-live-test-matrix.md) and [`roadmap.md`](roadmap.md).

Status: **draft (superseded)** · Created 2026-07-01 · Owner: Thomas

> **What this is.** The hands-on, click-by-click companion to
> [`overlay-live-test-matrix.md`](overlay-live-test-matrix.md). The **matrix** owns the *why*,
> the environment rows (E1–E5), the failure-isolation tree (D1–D4), the pass/fail criteria, and
> the results table — fill results in there. **This guide** owns the *how*: setup, exactly what to
> click, exactly what log line to expect, and what to look at with your eyes. Run this guide once
> per environment row in the matrix.

---

## The one thing that matters (read this first)

You are answering **one** question: **does the meter actually paint pixels on the camera video,
on the Zoom builds your users run?** Everything else is plumbing to make that answer trustworthy.

Two traps make the logs lie to you — internalize both before you start:

- **`drawWebView ok:true` is NOT proof of compositing.** The Zoom regression (ZSEE‑195647) makes
  the call succeed while rendering nothing. **Only your eyes — ideally a second participant's eyes
  — prove compositing.**
- **A moving number is NOT proof the live channel works.** The overlay extrapolates locally every
  250 ms off the last snapshot, so it ticks smoothly even if the data channel is frozen. **A
  pause/resume status change is the only cheap proof the channel is live.**

So the decisive evidence is always: **(1) you SEE the meter from a second view, and (2) a
pause/resume shows up on the overlay AND emits a fresh `overlay-message` log.**

---

## What you need

- **Two devices in the meeting** if at all possible: one as **presenter/host** (running the app),
  one as a plain **observer** (a phone or second laptop joined to the same meeting). The observer
  view is how you confirm compositing as others see it — self‑view can mislead.
- The presenter must be **host or co‑host** (`drawParticipant`, the base video layer, is
  host/co‑host only — the meter itself works for any role, but you want the full happy path).
- **The production build live on the Railway/Marketplace domain, built with `VITE_USE_ZOOM=1`**
  (RealZoom). A mock build will not exercise any of this. Confirm before you start (below).
- **A live view of the server log** (`[client-log]` lines) while you test — see *Watching the
  logs*.
- Each Zoom **client build string** you'll test on (Zoom → About). Coverage across builds is the
  entire point; "latest" drifts, so record the exact string per run.

---

## Pre‑flight setup

### 1. Confirm the right build is actually live

In a browser, hit the deployed health endpoint:

```
GET https://<your-app>.up.railway.app/api/health   →   {"ok":true,"zoomConfigured":true}
```

`zoomConfigured:true` means the server has the Zoom client id/secret (identity path is wired). It
does **not** confirm `VITE_USE_ZOOM=1` in the client bundle — verify that the last deploy was built
with that flag set (Railway build var), because the camera path is dead without it.

### 2. Marketplace config checklist (do once, re-verify if it's been a while)

In the Zoom Marketplace app config:

- **All `ZOOM_CAPABILITIES` added** under **Features → Zoom App SDK** (the "Add APIs" list) — in
  particular the camera/Layers set: `runRenderingContext`, `drawWebView`, `drawParticipant`,
  `clearWebView`, `closeRenderingContext`, `getVideoState`, `onMyMediaChange`, `postMessage`,
  `onMessage`, plus `getAppContext` (needed by the rate store / identity). **This list IS the gate**
  (see next bullet) and it must mirror exactly what the client passes to `zoomSdk.config()`.
- **✅ Surface-gate question — RESOLVED (researched 2026-07-01).** There is **no separate "Camera"
  or "Meeting Component" surface** to enable. The Marketplace **Surface** step ("Select where to use
  your app") picks the *product* — enable **Meetings** — it is **not** a UI-layer toggle; no
  "Camera"/"video_layer" surface exists. The camera/Layers APIs are permitted purely by the
  **API/capability list under Features → Zoom App SDK matching `config()`**. Documented failure
  causes are all SDK-side, not a missing classification: capabilities not in `config()`, calling
  `runRenderingContext` before the camera is on, client version, or the domain allowlist. *(One live
  caveat: the Zoom Apps SDK feature is only exposed for a **user-managed** app — an admin-managed
  Meetings app shows no in-client features. Confirm the app is user-managed if the SDK feature/APIs
  aren't visible.)* Sources in `reviews/` research note / memory `reference-zoom-prod-unknowns-research`.
- **Domain Allow List (hard requirement — blank panel / silent no-op if missing):** the app URL
  **plus `appssdk.zoom.us`** and any CDN domains must be on the Marketplace Domain Allow List.
- Home/redirect URLs point at the Railway domain; the domain is allowlisted.

### 3. Watching the logs

All client events POST to `/api/log` and the server prints them as single lines. Tail them:

- **Railway dashboard:** the service's *Deploy logs* / *Observability* log stream, or
- **CLI:** `railway logs` (follow mode), or
- the Railway MCP `get_logs` if you're driving from here.

**Filter to `[client-log]`** — that prefix is every client event. Genuine errors
(`"kind":"client-error"`) go to **stderr**; benign telemetry (`lifecycle`, `zoom-overlay`,
`zoom-diagnostics`) goes to **stdout**. Lines are compact JSON; **de‑interleave by reading
top‑to‑bottom in timestamp order** — two instances (panel + camera) are both logging.

> Routine traffic (`/api/health`, `/api/log` itself, `/favicon.ico`, `/assets/*`) is **not**
> request‑logged, so the stream stays signal. You'll only see `[server] …` lines for real
> navigations/API calls plus the `[client-log] …` telemetry.

### 4. (Optional but recommended) Enable verbose 1:1 channel logging

By design the channel is **quiet in steady state**: the panel logs only the **first** successful
`postMessage`, and the camera logs `overlay-message` only on the **first** snapshot and thereafter
**only on a status change** (`overlay-logging-quiet`, PR #18). That's great for production, but for
a live test you may want to *see* the per‑tick 1:1 send↔receive cadence directly. Two small,
**temporary** edits turn the firehose on. **Revert both after the run** (see the checklist at the
end) — they are a steady‑state flood.

**(a) Log every send** — `client/src/zoom/zoomAdapter.js`, in `RealZoom.postMessage()`:

```js
// TEMP live-test: log every successful send (revert — normally first-only)
.then(() => {
  this._emitLog({ kind: 'zoom-overlay', method: 'postMessage', ok: true });
})
```

(replacing the `if (!this._firstPostLogged) { … }` first‑success‑only block).

**(b) Log every receipt** — `client/src/components/OverlayApp.jsx`, in the `onMessage` effect, log
unconditionally instead of only on a status change:

```js
const unsub = adapter?.onMessage?.((payload) => {
  const status = payload?.status ?? null;
  // TEMP live-test: log every receipt (revert — normally status-change only)
  logLifecycle('overlay-message', {
    type: payload === null ? 'null' : typeof payload,
    keys: payload && typeof payload === 'object' ? Object.keys(payload) : null,
    status,
  });
  lastStatusRef.current = status;
  setState(payload);
});
```

Rebuild + redeploy with `VITE_USE_ZOOM=1`. Now every tick logs a `postMessage ok` and an
`overlay-message` — a visible 1:1 heartbeat. **The privacy invariant still holds**: `overlay-message`
logs only `type`/`keys`/`status`, never the aggregate values, and `postMessage` logs only the
outcome. Don't add value‑logging.

> You do **not** strictly need (a)/(b): the pause/resume status‑change probe forces a fresh
> `overlay-message` even in quiet mode, which is enough to prove liveness. Use verbose mode when
> you want to *watch* the cadence rather than infer it.

---

## Log cheat‑sheet — the happy path, annotated

Read these in order during a clean run. Field shapes are exact.

| # | Line you should see (`[client-log] …`) | Means |
|---|----------------------------------------|-------|
| 0 | `{"kind":"lifecycle","event":"boot","mode":"real","runningContext":"inMeeting","routedMode":"panel"}` (and a second with `"runningContext":"inCamera","routedMode":"overlay"`) | The **earliest** routing signal. `mode:"real"` confirms the `VITE_USE_ZOOM=1` build. Two boots — one `inMeeting`/`panel`, one `inCamera`/`overlay` — is the healthy shape. |
| 1 | `{"kind":"lifecycle","event":"panel-mounted","instanceId":"…"}` | The in‑meeting **panel** instance booted and routed. |
| 2 | `{"kind":"lifecycle","event":"overlay-mounted","instanceId":"…","transparentBody":true}` | A real **camera** (`inCamera`) instance exists and routed to `OverlayApp`. `transparentBody:true` = the real camera mount (not the mock preview). |
| 3 | `{"kind":"zoom-overlay","method":"runRenderingContext","ok":true}` | Camera rendering context opened. |
| 4 | `{"kind":"zoom-overlay","method":"drawParticipant","ok":true}` | Presenter base video composited (host/co‑host). `ok:false` here is tolerated — the meter still draws. |
| 5 | `{"kind":"zoom-overlay","method":"drawWebView","ok":true}` | Meter draw **call accepted** — ⚠️ **NOT proof pixels rendered** (the trap). |
| 6 | `{"kind":"zoom-overlay","method":"postMessage","ok":true}` | Panel pushed a snapshot to the camera instance (first success only, unless verbose). |
| 7 | `{"kind":"lifecycle","event":"overlay-message","type":"object","keys":[…],"status":"running"}` | The camera instance **received** a snapshot — the channel reaches `inCamera`. First receipt + every status change (every tick if verbose). |

Recovery / teardown lines you'll also see:

- `{"kind":"lifecycle","event":"media-change",…}` + `overlay-rearm:begin` / `overlay-rearm:done` —
  the camera off→on auto‑recover poll firing and re‑opening the context.
- `{"kind":"lifecycle","event":"overlay-teardown",…}` and `{"kind":"zoom-overlay","method":"closeRenderingContext",…}`
  — the camera instance/context went away (you clicked Hide, or Zoom tore it down).

A missing **#2 (`overlay-mounted`)**, or a `{"kind":"client-error",…}` on **stderr**, means a
routing/init failure — **not** the ZSEE regression. That's branch **D1** in the matrix.

---

## The run — per environment row

Do this whole sequence on each matrix row (E1–E5). Record the build string and outcome in the
**matrix results table**, not here.

1. **Open the app panel in‑meeting.**
   - *Watch the log:* expect **#1 `panel-mounted`**, and **no** `init-error` / `client-error`.
   - *Tip:* you can append **`?diag=1`** to the app URL to fire the (shape‑only) Zoom diagnostics
     probe — handy for capturing SDK shape if something's off. It logs `zoom-diagnostics` lines;
     leave it off for the clean run.

2. **Configure a non‑zero cost and start counting.**
   - Set a rate (per‑participant) or switch to **Simple** cost model and set values so the panel
     shows a **non‑zero, increasing total**.
   - If the session isn't already running, click **"Start session"**.
   - *See:* the panel's total ticking up.
   - **⚠️ Turn your camera ON before the next step.** Starting the overlay while the camera is off
     produces `{"kind":"zoom-overlay","method":"runRenderingContext","ok":false,"error":"Video is
     not sending."}` **plus** a `client-error` unhandled rejection — observed in production logs. It
     self‑recovers once the camera turns on (a `media-change video:true` re‑arms it), but it's noise
     and a known rough edge (backlog: *In‑Zoom client‑error hardening*). Camera on = clean run.

3. **Click "Show cost on video."**
   - *Watch the log, in order:* **#3 `runRenderingContext ok`** → **#2 `overlay-mounted
     (transparentBody:true)`** → **#4 `drawParticipant ok`** → **#5 `drawWebView ok`** (→ **#6
     `postMessage ok`** shortly after).
   - If **`overlay-mounted` never appears** → stop; that's **D1** (routing/instance failure), fix
     that first, it is not the regression.

4. **⭐ VISUALLY confirm the meter is on the video — from the observer device.**
   - Look at the **presenter's video tile on the second participant's screen**. The cost card
     should be composited in a corner of the video.
   - This is **the** decisive check. `drawWebView ok` in step 3 does **not** count.
   - **Nothing visible but `drawWebView ok:true` logged** → that's **D2 = the ZSEE‑195647
     regression**. Record the exact build; if it reproduces on any build your users run, you'll
     need the `drawImage` fallback (matrix's contingent follow‑up).

5. **Watch ~15 s.** The meter should *appear* to tick. Remember: this is extrapolation, **not yet
   proof** of a live channel. Don't over‑weight it.

6. **⭐ Liveness probe — click "Pause counting", then "Resume counting" on the panel.**
   - *See:* the overlay reflect paused→running within ~1 s (from the observer view).
   - *Watch the log:* a **fresh #7 `overlay-message`** with the changed `"status"` (`"paused"`
     then `"running"`). In verbose mode you'll also see the per‑tick `postMessage`/`overlay-message`
     heartbeat.
   - Meter updates but **no new `overlay-message`** → **D3**: the channel isn't reaching the camera
     instance. Check whether the panel still logs `postMessage ok` vs. the camera logging nothing.

7. **Camera off → on (hold off > 2 s), with the overlay on.**
   - *See:* the meter disappears, then **auto‑recovers** on its own (no manual Hide→Show).
   - *Watch the log:* `media-change` → `overlay-rearm:begin` → `overlay-rearm:done`.
   - (A *sub‑1.5 s* flicker may slip the poll and not recover — that's a **known, separately
     tracked** limitation, not a failure of this test. Toggle deliberately slowly.)

8. **Click "Hide from video."**
   - *See:* the meter disappears from the video.
   - *Watch the log:* `overlay-teardown` / `closeRenderingContext`.

---

## Reading the result (maps to the matrix tree)

- **D1 — no `overlay-mounted` / a `client-error`.** Camera instance never routed. Routing/init bug,
  not ZSEE. Fix and re‑run.
- **D2 — `drawWebView ok:true` but nothing visible (esp. from the observer).** **The ZSEE‑195647
  regression.** Note the build; if it hits builds your users run → trigger the `drawImage` fallback.
- **D3 — draws, but pause/resume doesn't update / no new `overlay-message`.** Data channel not
  reaching `inCamera`. Inspect `postMessage` (panel) vs. `overlay-message` (camera).
- **D4 — draws AND the liveness probe updates with a matching `overlay-message`.** ✅ This build
  **PASSES**. Record it and move to the next row.

**Production gate (from the matrix):** PASS on the current GA build (E3/E4) at minimum. A failure
on E1/E2 (Workplace 6.7.8 / 7.0.2) that reproduces on builds your users run forces the `drawImage`
fallback before launch.

---

## Verbose‑logging revert checklist (do this after the run)

If you enabled step 4 verbose logging, **undo both edits** and redeploy — they flood the log in
steady state:

- [ ] `client/src/zoom/zoomAdapter.js` — restore the `if (!this._firstPostLogged) { … }`
      first‑success‑only guard in `postMessage()`.
- [ ] `client/src/components/OverlayApp.jsx` — restore the `lastStatusRef.current !== status`
      guard so `overlay-message` logs first + status‑change only.
- [ ] `npm test && npm run build` stays green; redeploy with `VITE_USE_ZOOM=1`.
- [ ] If you used `?diag=1`, drop it from the URL (and consider the *"retire the diagnostics probe"*
      backlog item once the overlay is stable).

---

## Quick per‑build checklist (copy per E‑row)

```
Build: ____________________  (Zoom → About, exact string)   OS: ________

[ ] 1  panel-mounted, no client-error
[ ] 3  runRenderingContext ok → overlay-mounted(transparentBody:true) → drawParticipant ok → drawWebView ok
[ ] 4  ⭐ meter VISIBLE on presenter video, confirmed from 2nd participant
[ ] 6  ⭐ pause/resume → overlay updates + fresh overlay-message(status changed)
[ ] 7  camera off>2s → auto-recovers (overlay-rearm:done)
[ ] 8  Hide → overlay-teardown / meter gone

Verdict (D1/D2/D3/D4): ______    Notes: ____________________________
```
