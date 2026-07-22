# Meeting Cost Meter — App Listing copy (draft)

Field-by-field content for the Marketplace **App Listing** tab. Draft for review —
edit freely. Char counts are approximate; trim to whatever Zoom's field enforces.

## Identity
- **App name:** Meeting Cost Meter
- **Provider / company:** Transformative Leadership Lab LLC
- **Developer contact:** Thomas Cox — thomas@eudae.biz
- **Support email:** thomas+mcsupport@txl-lab.com

## Category
- **Primary:** Productivity
- **Alternate if a second is allowed:** Meeting & Scheduling

## Short description / summary (pick one)
- `Show the live, running dollar cost of your meeting as an overlay on your own video.` (~82)
- `A live meeting-cost meter — computed entirely in-client, nothing stored.` (~72)
- `Make meeting time visible: a running cost total on the presenter's video.` (~73)

## Long description
Meeting Cost Meter turns meeting time into a number people can see. The presenter
enters how many people are in the meeting and an hourly opportunity-cost rate; the app
then displays a live, running dollar total — in a side panel, or composited directly
onto the presenter's own video — so the room can feel the cost of the time as it accrues.

It is deliberately simple and privacy-first. The attendee count and rate are entered by
the presenter and live only in the browser for the duration of the meeting — they are
never sent to or stored on any server, and they reset when the meeting ends. The app
reads no participant list, no meeting content, and no attendee data; the total is a
single attendee-count × rate calculation performed entirely inside the Zoom client.

Use it to keep standups short, to make the cost of a large all-hands visible, or simply
to bring a little healthy time-awareness to recurring meetings.

## Key features (bullets)
- Live running cost total, updated on a cadence you choose (1s / 10s / 1 min)
- Renders on your own camera via the Zoom Layers API, or in the side panel
- Opportunity-cost model: attendee count × one hourly rate — no per-person data
- 100% session-only: nothing is stored, nothing leaves the Zoom client
- No participant data accessed, no tracking, no third-party analytics

## Legal / support URLs (all verified live, HTTP 200 — 2026-07-19)
- **Privacy Policy:** https://thomasbcox.github.io/zoom-meeting-cost/privacy.html
- **Terms of Use:** https://thomasbcox.github.io/zoom-meeting-cost/terms.html
- **Support:** https://thomasbcox.github.io/zoom-meeting-cost/support.html
- **Documentation:** https://thomasbcox.github.io/zoom-meeting-cost/documentation.html
- **Security (optional to link):** https://thomasbcox.github.io/zoom-meeting-cost/security.html

## Assets — ACTION NEEDED
- **App icon 160×160 px** — required. Confirm you have one on brand (palette in the
  marketplace-pages notes). If not, this is the one asset still to produce.
- **Cover / gallery image** — `docs/image-market-cover.png` exists; confirm it meets
  Zoom's listing-image dimensions, or resize.
- **Screenshots** — Zoom listings expect 1–3 screenshots of the app in use (panel +
  camera overlay). You can capture these from a live dev-client run.
