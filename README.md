# Meeting Cost — Zoom App (MVP prototype)

Shows the **live estimated cost of a Zoom meeting** as a "taxi meter" overlay on
the presenter's video, exactly like Zoom's Timer app. The presenter owns a
private, best-guess table of hourly rates in the in-meeting **side panel** and
clicks **Show cost on video**; the live total then renders onto their camera
feed (via Zoom's camera rendering context) so every participant sees it
natively — no second app, no shared screen, no collaborate space.

> The app does **not** integrate with HR, payroll, SSO, or any employee
> directory. The presenter is asked to estimate each person's hourly rate; the
> app computes the cost from those numbers and does not verify them.

![Meeting Cost shared screen — live total, cost/minute, elapsed time, and attendee count](docs/screenshot.png)

## What's in this repo

This is a **runnable browser prototype** with **Zoom-ready structure**:

- `client/` — React + Vite frontend (the in-meeting UI)
- `server/` — Node + Express + WebSocket backend (broadcasts shared state)
- The Zoom Apps SDK, OAuth, and Marketplace config are scaffolded behind
  adapters so you can flip to a real in-Zoom app without rewriting the app.

The presenter's private rate table lives only in the browser (localStorage) and
is **never sent to the server** — only resolved, sanitized shared state is
broadcast.

## Quick start

```bash
npm install            # installs root + client + server workspaces
npm run dev            # starts server (:8787) and Vite client (:5173)
```

Then open <http://localhost:5173>.

### Try it (mock mode)

In the browser prototype the running context is mocked as the **side panel**, so
you see the presenter view with a **simulated camera frame** beneath the live
readout:

1. Click **Show cost on video**. The taxi meter appears in the corner of the
   simulated camera frame and starts ticking.
2. Add/remove simulated participants and edit rates — the readout and the
   overlay update together.
3. **Hide from video** stops the overlay; **End session** stops counting.

Inside real Zoom, "Show cost on video" enters the camera rendering context and
composites the same overlay onto your actual video feed for all participants.

## Features (MVP)

**Camera overlay (everyone sees, natively):** large live total cost, cost/minute,
elapsed time, and attendee count — composited onto the presenter's video. No
private rates or participant names are ever sent to the overlay.

**Presenter side panel (private):** show/hide the overlay, pause/resume counting,
end session, default rate, loaded-cost multiplier, add/edit/delete private rate
rules, name aliases, and per-participant overrides for the current meeting.

**Matching logic:** normalize names (trim, lowercase, collapse spaces, strip
punctuation/accents) → exact match → alias → manual override → default rate.
Each row reports its source: `matched`, `default`, or `manual override`.

## Architecture

```
Side panel (presenter)                         Camera context (all participants)
──────────────────────                         ─────────────────────────────────
private rate table ─┐
participants  ──────┤ resolveAll() → computeTotals()
overrides ──────────┘            │
                                 ▼  buildOverlayState() (aggregate only)
                        adapter.postMessage() ──► Zoom ──► adapter.onMessage()
                                                              │
                                                              ▼  CostOverlay
                                                    (taxi meter on the video)
```

- Render routing by Zoom running context: `client/src/lib/renderMode.js`
  (`inCamera` → overlay, side panel → config). `client/src/Root.jsx` mounts the
  right tree.
- Matching/cost logic: `client/src/lib/` (`normalize`, `matching`, `cost`,
  `overlayState`).
- Zoom integration adapter: `client/src/zoom/zoomAdapter.js` — `MockZoom` (records
  overlay calls + loops the message bridge back for the simulated preview) and
  `RealZoom` (camera rendering context via `@zoom/appssdk`).
- The legacy WebSocket sync (`client/src/sync/syncClient.js` +
  `server/src/rooms.js`) is no longer used for the display; removal is tracked as
  a follow-up cleanup.

## Going live in Zoom (later)

See `server/zoom-app-config.md` for Marketplace setup (scopes, redirect URLs,
SDK capabilities) and `server/.env.example` for OAuth credentials. Set
`VITE_USE_ZOOM=1` for the client to use the real Zoom SDK, install
`@zoom/appssdk`, and serve over an HTTPS tunnel (e.g. ngrok).

## License

[MIT](LICENSE) © 2026 Thomas Cox
