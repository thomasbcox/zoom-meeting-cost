# Zoom Marketplace configuration (reference)

This file documents the Zoom App setup needed to run **Meeting Cost** inside the
real Zoom client. None of it is required for the local prototype.

## App type
Create a **Zoom Apps** app at <https://marketplace.zoom.us>.

## OAuth
- **Redirect URL for OAuth:** `https://<tunnel>/auth/callback`
- **OAuth allow list:** `https://<tunnel>`
- `<tunnel>` is your HTTPS dev tunnel (e.g. ngrok) pointing at this server.

## Home / app URL
- **Home URL:** `https://<tunnel>/`

## Domain allow list
- `<tunnel>` host
- `appssdk.zoom.us`

## Scopes (minimum for the MVP)
Granular scopes — request only what the matching + participant list needs:

- `zoomapp:inmeeting` — run as an in-meeting app
- `meeting:read:participant` (or the in-client `getMeetingParticipants`
  capability) — read display names / participant changes
- `user:read:email` *(optional)* — only if you later match on email

## Zoom Apps SDK capabilities to enable
Configure these under **Features → Zoom App SDK → Add APIs**:

These match the `ZOOM_CAPABILITIES` list in `client/src/zoom/zoomAdapter.js`:

- `getRunningContext`
- `getMeetingContext`
- `getMeetingParticipants`
- `getUserContext`
- `onParticipantChange`
- **Camera overlay (Layers API):**
  - `runRenderingContext` — enter the camera rendering context (`view: 'camera'`)
  - `drawWebView` — composite the overlay webview onto the camera feed (called
    from the **camera** instance, not the panel; `webviewId` is an arbitrary
    string label)
  - `drawParticipant` — composite the presenter's own video as the base layer
    under the overlay
  - `onMyMediaChange` — media info used by `drawParticipant`
  - `clearWebView`
  - `closeRenderingContext`

> **Marketplace dashboard:** `drawParticipant` and `onMyMediaChange` must be
> added under **Features → Zoom App SDK → Add APIs** (same as the other camera
> APIs). Without them a live run fails with a `40316`-style capability error.
- **Side panel → camera overlay state push (camera/Layers mode):**
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
- The presenter's private rate table stays in the browser (localStorage) and is
  never sent anywhere. The side panel pushes only sanitized aggregate numbers
  (`buildOverlayState`) to the camera rendering context via `postMessage`; the
  overlay composited on the presenter's video is what every participant sees.
