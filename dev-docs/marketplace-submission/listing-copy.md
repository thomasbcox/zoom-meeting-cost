# Meeting Cost Meter — App Listing copy (draft)

Field-by-field content for the Marketplace **App Listing** tab. Draft for review —
edit freely. Char counts are approximate; trim to whatever Zoom's field enforces.

## Identity
- **App name:** Meeting Cost Meter
- **Provider / company:** Transformative Leadership Lab LLC
- **Developer contact:** Thomas Cox — thomas@eudae.biz
- **Support email:** thomas+mcsupport@txl-lab.com

## Category — DECIDED (Thomas, 2026-07-24)
- **Primary: Productivity** ✅
- **Alternate if a second is allowed:** Meeting & Scheduling

## Short description / summary — FINAL (Thomas, 2026-07-30)

The live Marketplace value, kept after reviewing it against the earlier draft pick:

> `Shows the running cost of a meeting, computed from a per-person rate you select. Shows on the presenter's video.` (112/150)

Chosen because it states the **mechanism** on the listing card — the reader learns the cost
comes from a rate they pick, rather than assuming the app reads salaries automatically.

- ~~`Make meeting time visible: a running cost total on the presenter's video.`~~ — the
  2026-07-24 draft pick; superseded 2026-07-30 in favour of the mechanism-first line above.
- ~~`Show the live, running dollar cost of your meeting as an overlay on your own video.`~~ (not chosen)
- ~~`A live meeting-cost meter — computed entirely in-client, nothing stored.`~~ (not chosen)

## Long description — LIVE in the dashboard (verified 2026-07-30, 1003 chars / 2000)

This is the text actually in the Production listing. It opens in Thomas's own voice, then
folds in the key-feature bullets. The opportunity-cost paragraph is doing the important work:
it pre-empts the most common misreading, that the app reads real salaries.

> Wondering how much a meeting is costing you -- or your org? Wonder no more. This taxi-meter
> style display will show a running total of the opportunity cost of the current meeting.
>
> Don't use actual or estimated pay rates -- the real cost of a meeting is the Opportunity Cost:
> how much internal or customer value each person might be creating if they were not in the meeting.
>
> Pick a blended average per-person hourly cost and the number of people on the call, and the cost
> meter does the rest.
>
> Ask yourself and your meeting participants: How do we make sure this meeting is worth what it costs?
>
> - Live running cost total, updated on a cadence you choose (1s / 10s)
> - Renders on your own camera via the Zoom Layers API, or in a side panel for just you to see
> - Opportunity-cost model: attendee count × one hourly rate — no per-person data
> - 100% session-only: nothing is stored, nothing leaves the Zoom client
> - No participant data accessed, no tracking, no third-party analytics
>
> Requires Zoom Workplace desktop 7.1.0 or later for the on-camera overlay -- on older desktop
> builds the overlay may not appear. The side panel works regardless.

**The 7.1.0 line was added 2026-07-30 and is load-bearing.** The Marketplace listing declares
"Desktop — 7.0.5 or later", a figure Zoom computes automatically from the selected SDK APIs with
**no editable field**. But 7.1.0 is the project's supported floor, chosen because `drawWebView`
no-ops on 7.0.2 (ZSEE-195647) — so on 7.0.x Zoom would tell users they are supported while the
camera overlay silently never renders. This sentence is the only available mitigation. Keep it in
sync with `README.md` and `docs/support.html`.

**Style note:** the `--` double hyphens are **deliberate** (Thomas's call, 2026-07-30) and match his
voice across the description; do not "fix" them to em dashes. The earlier zero-width-space and
doubled-blank-line artifacts were cleared when the description was retyped on 2026-07-30.

### Superseded draft (kept for reference)

An earlier, more feature/privacy-led draft was written here on 2026-07-22 and never went into the
dashboard: *"Meeting Cost Meter turns meeting time into a number people can see… deliberately simple
and privacy-first… Use it to keep standups short."* The live copy above replaces it.

## Legal / support URLs (all verified live, HTTP 200 — 2026-07-19)
- **Privacy Policy:** https://thomasbcox.github.io/zoom-meeting-cost/privacy.html
- **Terms of Use:** https://thomasbcox.github.io/zoom-meeting-cost/terms.html
- **Support:** https://thomasbcox.github.io/zoom-meeting-cost/support.html
- **Documentation:** https://thomasbcox.github.io/zoom-meeting-cost/documentation.html
- **Security (optional to link):** https://thomasbcox.github.io/zoom-meeting-cost/security.html

## Assets — all produced

- **App icon 160×160** — ✅ `docs/image-app-icon.png`. The cover's logomark scaled to
  fill: green `#a3d28b` rounded tile, navy `#234262` DIN Condensed `$`. Chosen by Thomas
  2026-07-30 over a teal-field variant, for exact consistency with the cover. Regenerate
  (or re-size) with [`dev-docs/marketing/marketplace-icon.sh`](../marketing/marketplace-icon.sh).
- **Cover / gallery image** — ✅ `docs/image-market-cover.png` at **1824×176**. That thin-banner
  size is exactly what Zoom requires (confirmed by Thomas 2026-07-27) — do **not** resize it.
  Built by [`dev-docs/marketing/marketplace-cover.sh`](../marketing/marketplace-cover.sh).
- **Screenshots** — ✅ all 1200×780 in `docs/`. Use these three, in this order:
  1. `MeetingCost_hero_1200x780.png` — **the hero.** Overlay reading $44.67 on live video in
     the real Zoom client, blurred background. Scaled + left-cropped from Thomas's
     `thomas looks at the cost meter.png` (2026-07-30).
  2. `MeetingCost_bottom_overlay_1200x780.png` — the meter, the Hide/Pause/End controls,
     and the cadence toggle.
  3. `MeetingCost_top_estimate_1200x780.png` — the setup step (rate + attendee count).

  Not used: `Screenshot_2026-07-19_1200x780.png` (superseded by the hero — unblurred room
  background) and `MeetingCost_1200x780.png` (whole panel shrunk in a black margin; text
  won't read at listing scale).
