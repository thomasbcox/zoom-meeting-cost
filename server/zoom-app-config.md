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

- `getRunningContext`
- `getMeetingContext`
- `getMeetingParticipants`
- `onParticipantChange`
- `onMeeting`
- `getUserContext`
- `sendAppInvitationToAllParticipants` *(to push the shared view to everyone)*
- `connect` / `postMessage` / `onConnect` *(collaborate / in-client messaging)*
- `onCollaborateChange`, `getAppContext`

## How the prototype maps to production
- `client/src/zoom/zoomAdapter.js` has a `MockZoom` (used now) and a
  `RealZoom` implementation (wraps `@zoom/appssdk`). The app talks only to the
  adapter interface, so switching is a config flag.
- The presenter's private rate table stays in the browser (localStorage) and is
  never sent to the server — only resolved/sanitized shared state is broadcast.
