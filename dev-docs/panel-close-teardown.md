# Panel-close teardown diagnosis (BUG-1) — RESOLVED / breadcrumbs retired

> **Outcome recorded 2026-07-12.** This runbook described a live diagnostic that has now been run and
> concluded. The `pagehide` teardown breadcrumbs it relied on were **retired** (see
> [reviews/retire-teardown-breadcrumb.md](../reviews/retire-teardown-breadcrumb.md)); this file is
> kept as the record of what the run established. The procedure is no longer live.

## What we were testing

BUG-1 ("Panel-close stops the meter") suspected that closing the side panel unmounts the panel's
accrual `setInterval` ([client/src/App.jsx](../client/src/App.jsx)) and tears down the spawned camera
rendering context, freezing the on-camera meter. To settle the *mechanism*, two `pagehide` lifecycle
breadcrumbs were shipped — `panel-teardown` (side panel) and `overlay-teardown` (camera mount),
delivered with `keepalive` so a final beacon could survive the webview unloading.

## What the live run found (dev Railway env, commit `260f48b`, real Zoom session)

- Across ~20 min covering several **panel close→reopen** cycles **and** a deliberate right-click
  **"Close the app"**, `/api/log` recorded **zero** `panel-teardown` / `overlay-teardown` and **zero**
  new panel `boot` on reopen — while ordinary beacons (`boot`, `panel-mounted`, `overlay-mounted`)
  delivered within seconds.
- **Delivery works; `pagehide` does not fire.** Zoom hard-kills the embedded webview without
  dispatching/flushing `pagehide`, so a teardown breadcrumb can never observe a Zoom teardown.
- **No new `boot` on reopen ⇒ a normal panel "close" is a HIDE, not a destroy.** The panel webview
  survives, its 1 s tick keeps accruing, and the meter keeps running and re-syncs on reopen — **BUG-1's
  freeze symptom did not reproduce.**

## Conclusion

- **BUG-1 closed — not currently replicable** (see [BACKLOG.md](../BACKLOG.md)).
- **The `pagehide` teardown breadcrumbs were retired** — they cannot instrument Zoom teardown, and the
  user-facing freeze risk is already covered by *resilience* (`extrapolateOverlay` self-accrual + the
  camera off/on recovery poll), not by *observing* teardown.
- **If teardown observability is ever wanted** — to measure whether an unrecovered teardown-freeze
  actually happens in the field, or to actively blank/recover the overlay when it dies — the candidate
  instrument is **heartbeat + server-side gap detection**: the panel/overlay POST a periodic alive-ping
  and the server infers teardown when the pings stop. That survives a hard webview kill, which
  `pagehide` does not. Deferred; not built.
