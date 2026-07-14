# Zoom Marketplace configuration (reference)

This file documents the Zoom App setup needed to run **Meeting Cost** inside the
real Zoom client. None of it is required for the local prototype.

> **Setting up the hosting from scratch?** See **[`dev-docs/railway-setup.md`](../dev-docs/railway-setup.md)**
> for the step-by-step Railway guide (deploy, variables, and the two-environment Dev/Prod
> layout). This file is the **Marketplace side**;
> that guide is the **hosting side** — they reference each other.

## App type
Create a **Zoom Apps** app at <https://marketplace.zoom.us>.

## Development vs Production credentials → two deployments

A Zoom Marketplace app exposes **two independent credential blocks — Development and
Production — each with its own `client_id` *and* secret** (and its own Home URL /
redirect / allow-list fields). They are not interchangeable:

- **`Local Test → Add` (how you install an *unpublished* app) uses the Development
  block.** Production credentials have **no install path until the app is published**.
- The server reads a **single** credential set per process (`ZOOM_CLIENT_ID` /
  `ZOOM_CLIENT_SECRET` / `ZOOM_REDIRECT_URI`) for the OAuth token exchange. So **one
  deployment serves one credential block.**

To run both, use **two Railway environments**, each holding one block and pointing the
matching Zoom block's URLs at its own domain:

| Zoom credential block | Railway env | `ZOOM_CLIENT_ID` | Home URL / redirect point at |
|---|---|---|---|
| **Development** | `development` | the Dev id | the **dev** Railway domain |
| **Production** | `production` | the Prod id | the **prod** Railway domain |

Mixing them (e.g. a Dev `client_id` with a Prod secret) yields
`400 invalid_client` at token exchange. Each block must be internally consistent and
point at the deployment that holds the matching secret. Full walkthrough:
[`dev-docs/railway-setup.md`](../dev-docs/railway-setup.md).

## Server-side storage — none

Meeting Cost persists **no** presenter data server-side. The attendee count, hourly rate, and display
cadence live only in the browser session (they reset each meeting). There is no rate store,
`RATE_STORE_KEY`, or Railway Volume to configure — the server only serves the built client,
`/api/health`, the `/api/log` diagnostics sink, and the OAuth callback. *(The encrypted rate store was
removed in `remove-rate-store`; see [`dev-docs/opportunity-cost-rate.md`](../dev-docs/opportunity-cost-rate.md)
for what "rate" means — hourly opportunity cost, not pay.)*

> **Deployment host.** The app is served from the **Railway** deploy
> (`railway.json`; see the README's "Deploy to Railway"), **not** a local tunnel.
> Below, `<app>.up.railway.app` is your live Railway host. Every URL/allow-list
> entry must match that **exact current host**.
>
> ⚠️ **If the app stops appearing in the Zoom client's app list, check here first.**
> A Home URL / OAuth redirect / domain-allow-list that points at a **dead or changed
> host** (an old tunnel, or a Railway subdomain that changed on redeploy) makes Zoom
> unable to load the app — it can be auto-deactivated and drop off the installable
> list. Reconcile every entry below against the running deployment, confirm the app
> is **Activated** (Manage → your app), and re-add it via **Local Test → Add**.

## OAuth
- **Redirect URL for OAuth:** `https://<app>.up.railway.app/auth/callback`
  (must equal the `ZOOM_REDIRECT_URI` env var set in Railway)
- **OAuth allow list:** `https://<app>.up.railway.app`

## Home / app URL
- **Home URL:** `https://<app>.up.railway.app/`

## Domain allow list
- `<app>.up.railway.app` host
- `appssdk.zoom.us`

## Scopes (minimum for the MVP)
Granular scopes — the dead-simple app needs only:

- `zoomapp:inmeeting` — run as an in-meeting app

(The participant-list scope `meeting:read:participant` / `getMeetingParticipants` and the
`user:read:email` scope were dropped — the attendee count is a manual input now, and there is no
name matching.)

## Zoom Apps SDK capabilities to enable
Add **every** API below under **Features → Zoom App SDK → Add APIs**. This list is the
**complete, authoritative set** and must match `ZOOM_CAPABILITIES` in
`client/src/zoom/zoomAdapter.js` exactly — if you add a capability in code, add it here
(and in the dashboard) too. A missing dashboard API fails a live run with a
`40316`-style capability error.

**Context & participants**
- `getRunningContext` — route the instance (panel vs. camera rendering context)
- `getMeetingContext` — meeting info
- `getUserContext` — the presenter's own identity; supplies the `participantUUID` for the base-video
  layer (`drawParticipant`)

**Camera overlay (Layers API)**
- `runRenderingContext` — enter the camera rendering context (`view: 'camera'`)
- `drawWebView` — composite the overlay webview onto the camera feed (called from the
  **camera** instance, not the panel; `webviewId` is an arbitrary string label)
- `clearWebView` — clear the overlay webview layer on unmount
- `closeRenderingContext` — tear down the camera rendering context (the "Hide", and the
  *close* half of auto-recovery's close→reopen)
- `drawParticipant` — composite the presenter's own video as the base layer
- `onMyMediaChange` — media info for `drawParticipant`. **Note:** it does NOT reliably
  fire in the panel (self-media events reach only the `inCamera` instance, which Zoom
  destroys on camera-off), so overlay auto-recovery does **not** depend on it — it is
  kept for `drawParticipant` and as a diagnostic only.
- `getVideoState` — the presenter's camera on/off, **polled by the panel** to
  auto-recover the overlay after a camera off→on (the reliable signal `onMyMediaChange`
  could not provide).

**Side panel → camera overlay state push (camera / Layers mode)**
- `postMessage` — the side panel pushes the live cost snapshot directly each tick
- `onMessage` — the `inCamera` overlay instance receives it
- No `connect`/`onConnect`: that is the separate meeting ↔ main-client app-mirroring
  feature and is **not** used here. In camera mode the panel posts directly and the
  `inCamera` instance receives via `onMessage` (per Zoom's official camera-mode
  sample); the `inCamera` instance cannot call `connect` anyway.

## How the prototype maps to production
- `client/src/zoom/zoomAdapter.js` has a `MockZoom` (used now) and a
  `RealZoom` implementation (wraps `@zoom/appssdk`). The app talks only to the
  adapter interface, so switching is a config flag.
- The presenter's config (attendee count, hourly rate, display cadence) is **session-only** — held in
  the browser for the meeting and never persisted. There is no server-side store, no presenter
  identity decryption, and no export/delete endpoint (all removed in `remove-rate-store`).
- **Privacy boundary that still holds:** the side panel pushes only sanitized **aggregate display
  state** to the camera overlay via `postMessage` — `buildOverlayState` emits exactly `{ status,
  totalCost, costPerSecond, elapsedSeconds, attendees, currency, updatedAt, prefs:{} }` and nothing
  else. The overlay composited on the presenter's video is what every participant sees; there is no
  per-person data to leak (the model is a single attendee count × one rate).
