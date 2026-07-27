# Meeting Cost Meter — App Listing copy

Field-by-field content for the Marketplace **App Listing** tab. Char counts are
approximate; trim to whatever Zoom's field enforces.

## Identity
- **App name:** Meeting Cost Meter
- **Provider / company:** Transformative Leadership Lab LLC
- **Developer contact:** Thomas Cox — thomas@eudae.biz
- **Support email:** thomas+mcsupport@txl-lab.com

## Category
- **Primary:** Productivity
- **Alternate (if a second is allowed):** Meeting & Scheduling

## Short description / tagline
`Make meeting time visible: a running cost total on the presenter's video.`

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
- Live running cost total, updated on a cadence you choose (1s / 10s)
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

## Assets — done
- **App icon 160×160 px** — uploaded to the Marketplace ✓
- **Screenshots** (panel + camera overlay) — uploaded ✓
- **Architecture diagram** — `docs/meeting-cost-architecture.png` (a PNG render of the SVG,
  for the Technical Design tab); source at `docs/meeting-cost-architecture.svg`, live at
  https://thomasbcox.github.io/zoom-meeting-cost/meeting-cost-architecture.svg
- **Cover / gallery image** — `docs/image-market-cover.png` (confirm it meets Zoom's
  listing-image dimensions, or resize).
