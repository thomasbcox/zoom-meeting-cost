# Runbook — does closing the panel tear down the camera overlay? (BUG-1 diagnosis)

> **Diagnose-first step for BUG-1** ("Panel-close stops the meter", [BACKLOG.md](../BACKLOG.md)).
> This confirms the *mechanism* of the freeze before any fix is written. Landed by
> `panel-teardown-breadcrumb`; the fix is a follow-up story chosen by the outcome below.

## The hypothesis

BUG-1 says closing the side panel freezes the on-camera meter, and proposes making the overlay
"self-accrue from the last cost-rate." But the overlay **already** self-accrues:
[`extrapolateOverlay`](../client/src/lib/overlayState.js) advances the total as
`costPerSecond × (now − updatedAt)`, unbounded, while `status === 'running'` — and that shipped
before BUG-1. So the freeze is most likely **not** a data problem but a **lifecycle** one: the
panel is the instance that calls `runRenderingContext({ view: 'camera' })`, so closing it may tear
down the spawned camera rendering context, destroying the overlay webview and leaving its last
frame frozen on the video.

We can't tell from code — it's a real-Zoom runtime fact. This runbook settles it.

## The two breadcrumbs

Both are `logLifecycle` entries to `/api/log`, emitted on the browser `pagehide` event via
[`registerTeardownLog`](../client/src/lib/lifecycleLog.js) (keepalive delivery, so the final beacon
survives the webview unloading). They carry only `{ kind:'lifecycle', event, instanceId }` — no PII.

| event | instance | fired when |
| --- | --- | --- |
| `panel-teardown` | side panel (`App`) | the panel webview is destroyed (e.g. panel closed) |
| `overlay-teardown` | camera (`OverlayApp`, real mount) | the camera rendering context / overlay webview is destroyed |

`instanceId` differs per webview, so the two lines are attributable to distinct instances.

## Procedure (real Zoom)

1. Deploy the branch (every merge to `main` deploys to Railway).
2. In a Zoom meeting, open the app panel and **Show cost on video** so the overlay is running.
3. Tail the log: `mcp__railway__get_logs` (or the Railway dashboard) filtered to `/api/log` for
   `panel-teardown` and `overlay-teardown`.
4. **Close the app panel** (not the camera — leave your camera on).
5. Read the last few log lines.

## Decision table

| What the log shows on panel close | Diagnosis | BUG-1 fix direction |
| --- | --- | --- |
| `panel-teardown`, then `overlay-teardown` right after | Closing the panel tears down the camera rendering context too — overlay lifetime is **coupled** to the panel. Extrapolation can't help a destroyed webview. | Decouple the overlay's lifetime from the panel (keep the rendering context alive independent of the panel), not "add accrual" — accrual already exists. |
| `panel-teardown` only; **no** `overlay-teardown`; meter still frozen | The overlay **survives** but stops advancing. The freeze is downstream — extrapolation stalling, or Zoom compositing a static last frame. | Re-diagnose the overlay's own tick / `extrapolateOverlay` path; the panel is not the cause. |
| **No `panel-teardown` line at all** | `pagehide` did not fire on panel close (or keepalive delivery failed). The breadcrumb itself is wrong. | Fix the diagnostic first: try `visibilitychange`/another hook, re-run — do not draw a conclusion from a missing line. |

The third row is why delivery is keepalive: without it, a dropped POST would look identical to
"`pagehide` never fired," and the whole table would be untrustworthy.
