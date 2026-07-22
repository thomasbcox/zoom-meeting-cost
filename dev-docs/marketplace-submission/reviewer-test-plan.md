# Meeting Cost Meter — Reviewer test plan (draft)

Paste into the submission's **Release Notes / Test Plan** field. Written so a Zoom
reviewer can exercise the app end-to-end. The app needs **no login and no test
credentials** — all state is entered in-app and is session-only.

## What the app does (one line)
Displays a live, running dollar cost of the meeting (attendee count × hourly rate),
shown in the side panel and, optionally, as an overlay on the presenter's own camera video.

## Prerequisites
- Zoom desktop client (a current 7.x+ build) signed in as any user.
- The app added to the reviewer's account (via the submission's add/authorize flow).
- Be **on camera** to see the overlay (video on).

## Credentials
None. There is no account, login, or password. The presenter types an attendee count and
an hourly rate directly into the panel; nothing is stored or transmitted.

## Steps

1. **Start or join a meeting** (a personal meeting is fine) with your camera on.
2. **Open the app** from the Apps panel. It opens as an in-meeting **side panel**.
   - *Expected:* the panel renders with controls for attendee count, hourly rate, and an
     update cadence, plus a cost readout starting at $0.00.
3. **Enter an attendee count** (e.g. `5`) and an **hourly rate** (e.g. `100`).
   - *Expected:* the running total begins accruing; at 5 people × $100/hr the meter rises
     by ~$8.33 per minute.
4. **Change the update cadence** (1s / 10s / 1 min).
   - *Expected:* the displayed number updates on the selected interval; internal accrual
     stays continuous.
5. **Show the cost on your video:** click the show-on-camera / overlay control.
   - *Expected:* the running cost composites onto **your own** camera video (Layers API).
     No other participant's video is affected.
6. **Toggle your camera off, then on** with the overlay showing.
   - *Expected:* the overlay returns on its own within ~1–2 seconds (auto-recovery).
7. **Hide the overlay**, then **end the session**.
   - *Expected:* the overlay clears; the panel returns to an idle/ended state with a way
     to start a new session.
8. **Uninstall the app** (deauthorization).
   - *Expected:* Zoom sends the deauthorization webhook; the app acknowledges it. Because
     the app stores no user data, there is nothing to delete.

## Privacy / data notes for the reviewer
- The attendee count and rate are **manual inputs** held only in the browser for the
  meeting; they are never sent to or stored on the server and reset when the meeting ends.
- The app reads **no participant list** and **no meeting content**. The overlay shows only
  an aggregate cost figure computed from the two numbers the presenter entered.
- The only network calls are same-origin: serving the app bundle and an optional,
  non-PII diagnostics log. CSP pins `connect-src 'self'`.

## Known, non-blocking behavior
- At overlay startup the panel↔camera handshake can momentarily retry
  (`postMessage` "connected app not ready") and then succeeds a beat later — expected
  Zoom SDK startup timing, not an error.
