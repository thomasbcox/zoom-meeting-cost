# Meeting Cost — Zoom App (MVP prototype)

Shows the **live estimated cost of a Zoom meeting** in a shared view that every
participant can see, similar in spirit to Zoom's Timer app. One person acts as
the **presenter/controller** and owns a private, best-guess table of hourly
rates; everyone else sees only the resolved, shared cost screen.

> The app does **not** integrate with HR, payroll, SSO, or any employee
> directory. All numbers are honest estimates based on presenter-defined rates.

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

### Try the shared experience

1. Tab 1 (default) is the **Presenter**. Click **Start shared session**.
2. Open <http://localhost:5173> in a second tab, set **Role → Viewer**, keep the
   same **Meeting / room id** (`demo-meeting`).
3. Watch the total cost tick up live in both tabs. Add/remove simulated
   participants, change rates, toggle "aggregate totals only" — viewers update
   in real time.

## Features (MVP)

**Shared screen (everyone):** large live total cost, cost/minute, elapsed time,
attendee count, participant rows (name · estimated rate · source), and an
"estimates only" disclaimer.

**Presenter-only controls:** start/end session, pause/resume counting, default
rate, loaded-cost multiplier, add/edit/delete private rate rules, name aliases,
per-participant overrides for the current meeting, and a toggle to show viewers
aggregate totals only (or hide individual rates).

**Matching logic:** normalize names (trim, lowercase, collapse spaces, strip
punctuation/accents) → exact match → alias → manual override → default rate.
Each row reports its source: `matched`, `default`, or `manual override`.

## Architecture

```
Presenter browser                     Server (Node)              Viewer browsers
─────────────────                     ───────────              ────────────────
private rate table ─┐
participants  ──────┤ resolveAll()                              SharedCostScreen
overrides ──────────┘     │                                          ▲
                          ▼  sanitized shared state                  │ state
                   buildSharedState() ── WS publish ──► rooms ──broadcast──►
```

- Matching/cost logic: `client/src/lib/` (`normalize`, `matching`, `cost`,
  `sharedState`).
- Zoom integration adapter: `client/src/zoom/zoomAdapter.js`
  (`MockZoom` now, `RealZoom` for in-client use).
- Shared-state sync: `client/src/sync/syncClient.js` + `server/src/rooms.js`.

## Going live in Zoom (later)

See `server/zoom-app-config.md` for Marketplace setup (scopes, redirect URLs,
SDK capabilities) and `server/.env.example` for OAuth credentials. Set
`VITE_USE_ZOOM=1` for the client to use the real Zoom SDK, install
`@zoom/appssdk`, and serve over an HTTPS tunnel (e.g. ngrok).

## License

[MIT](LICENSE) © 2026 Thomas Cox
