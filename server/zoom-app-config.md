# Zoom Marketplace configuration (reference)

This file documents the Zoom App setup needed to run **Meeting Cost** inside the
real Zoom client. None of it is required for the local prototype.

> **Setting up the hosting from scratch?** See **[`dev-docs/railway-setup.md`](../dev-docs/railway-setup.md)**
> for the step-by-step Railway guide (deploy, variables, persistent storage Volume,
> and the two-environment Dev/Prod layout). This file is the **Marketplace side**;
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
  `ZOOM_CLIENT_SECRET` / `ZOOM_REDIRECT_URI`), and that secret also decrypts the
  in-client app context. So **one deployment serves one credential block.**

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

## Persistent storage (required for saved rate tables)

The presenter's rate config is persisted **server-side, encrypted at rest** — this needs
two things on **each** environment, or it silently degrades:

> Note: "rate" here is hourly **opportunity cost**, not pay — see
> [`dev-docs/opportunity-cost-rate.md`](../dev-docs/opportunity-cost-rate.md).

- **`RATE_STORE_KEY`** (a strong secret, e.g. `openssl rand -base64 32`) — the master
  encryption key. **If unset, `GET/PUT /api/rates` returns `503` and the app runs
  session-only (nothing is saved).** Keep it separate from `ZOOM_CLIENT_SECRET`, use a
  **different** value per environment, and **never lose it** — all stored data is
  derived from it and becomes undecryptable if it changes.
- **A Railway Volume** mounted at **`/data`**, with `DATA_DIR=/data`. Railway's normal
  filesystem is **wiped on every redeploy**, so without the Volume saved rate tables
  vanish on the next deploy.

Quick check: `curl -s -i https://<domain>/api/rates | head -1` →
`503` means persistence is **off** (set `RATE_STORE_KEY`); `401` means it's configured.
Setup steps: [`dev-docs/railway-setup.md`](../dev-docs/railway-setup.md) Part C.

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
