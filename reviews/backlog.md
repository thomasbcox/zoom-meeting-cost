# Backlog

Deferred work, tracked so it isn't lost. Each item becomes its own `/frame`
story when picked up.

## Remove the unused shared-state WebSocket
- **Deferred from:** `reviews/camera-overlay.md` (2026-06-03, non-goal #2).
- **What:** After the camera-overlay rework the display flows presenter side panel
  → camera context via Zoom `postMessage`/`onMessage`. The WebSocket broadcast is
  no longer used for the display but the code remains:
  `client/src/sync/syncClient.js`, `client/src/lib/sharedState.js`,
  `server/src/rooms.js`, and the `/ws` proxy + server wiring.
- **Why defer:** Kept the camera-overlay story focused on the rendering change;
  ripping out the server path is mechanical and independent.
- **Done looks like:** dead WS client/server code removed (or repurposed if a
  non-display use emerges), `/ws` proxy dropped, tests/build green.

## CSP hardening — pin to exact origins
- **Deferred from:** `reviews/zoom-owasp-headers.md` (2026-06-03, Thomas's call).
- **What:** The Content-Security-Policy shipped for the Zoom blank-screen fix is
  intentionally permissive for dev:
  - `connect-src 'self' wss: https:` — allows the WebSocket/API to any HTTPS/WSS
    host, not just our origin.
  - `frame-ancestors 'self' https://*.zoom.us https://*.zoom.com` — broad Zoom
    wildcards.
- **Why defer:** Tightening needs the stable production origin(s) (tunnel today,
  a real domain later), which aren't fixed yet. Loosening for dev unblocked
  in-Zoom testing without risk to a prototype.
- **When to do:** Before any real distribution / Marketplace submission.
- **Done looks like:** `connect-src` pinned to our own origin + the specific WSS
  endpoint; `frame-ancestors` narrowed to the exact Zoom client origins Zoom
  documents; CSP verified to still render in the Zoom client.
