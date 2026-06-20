# Zoom Marketplace configuration (reference)

This file documents the Zoom App setup needed to run **Meeting Cost** inside the
real Zoom client. None of it is required for the local prototype.

## App type
Create a **Zoom Apps** app at <https://marketplace.zoom.us>.

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
Granular scopes — request only what the matching + participant list needs:

- `zoomapp:inmeeting` — run as an in-meeting app
- `meeting:read:participant` (or the in-client `getMeetingParticipants`
  capability) — read display names / participant changes
- `user:read:email` *(optional)* — only if you later match on email

## Zoom Apps SDK capabilities to enable
Add **every** API below under **Features → Zoom App SDK → Add APIs**. This list is the
**complete, authoritative set** and must match `ZOOM_CAPABILITIES` in
`client/src/zoom/zoomAdapter.js` exactly — if you add a capability in code, add it here
(and in the dashboard) too. A missing dashboard API fails a live run with a
`40316`-style capability error.

**Context & participants**
- `getRunningContext` — route the instance (panel vs. camera rendering context)
- `getMeetingContext` — meeting info
- `getMeetingParticipants` — read display names / the participant list (host/co-host)
- `getUserContext` — the presenter's own identity (seeds the name + base-video UUID)
- `getAppContext` — the signed Zoom app context; the client sends it to the server,
  which decrypts it (with the client secret) to the presenter's stable `uid` to key the
  encrypted server-side rate store (see `server/src/zoom/appContext.js`)
- `onParticipantChange` — live participant join/leave/rename

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
- The presenter's private rate config (rate table, aliases, default rate,
  multiplier, cost-model settings) is persisted **server-side, encrypted at rest**
  via `GET`/`PUT /api/rates` — keyed to the presenter's stable Zoom identity (the
  `uid` decrypted from the `getAppContext()` the client sends in the
  `x-zoom-app-context` header). At-rest encryption is AES-256-GCM with a per-user
  key derived (HKDF-SHA256) from a dedicated `RATE_STORE_KEY` secret salted by the
  `uid`, so a leaked volume/backup is useless without the env secret. The posture is
  **operator-decryptable** (the running server can decrypt; true zero-knowledge would
  need a user passphrase this app has nowhere durable to anchor). If the store is
  unconfigured or unreachable the client degrades to **session-only** state — no
  plaintext is ever written. (`localStorage` was removed; it isn't durable inside the
  Zoom client. The earlier "rates never leave the browser" framing is obsolete.)
- **Privacy boundary that still holds:** the rate table and per-person rates are never
  shown to *attendees*. The side panel pushes only sanitized **aggregate display state**
  via `postMessage` — `buildOverlayState` emits exactly `{ status, totalCost,
  costPerSecond, elapsedSeconds, attendees, currency, updatedAt, prefs:{} }` and
  **nothing else**: no names, aliases, rate table, or per-person rates (`prefs` is
  reserved and never carries private data). The overlay composited on the presenter's
  video is what every participant sees. (Privacy detail — what's stored, where, and the
  operator-decryptable posture — belongs in the README / privacy policy.)
