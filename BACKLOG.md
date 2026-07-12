# Backlog

The **canonical tracked-work list** for the `/dev-audit` → `/frame` → `/close` loop. Ids:
`AUDIT-` (from `/dev-audit`), `BUG-`, `OPS-`. The detailed product/strategy backlog (roadmap
deep-links) lives in [`reviews/backlog.md`](reviews/backlog.md); the strategy above both is
[`dev-docs/roadmap.md`](dev-docs/roadmap.md).

## Open

- **BUG-2** — **Overlay refreshes ~4×/second at the "Every second" cadence (panel refreshes 1×/s).**
  The camera overlay (`client/src/components/OverlayApp.jsx`) force-re-renders every 250 ms
  (`setInterval(() => force(...), 250)`) and, per render, extrapolates the live total then calls
  `quantizeForDisplay`. At the 1-second cadence that helper is a pass-through
  (`stepSeconds ≤ 1 ⇒ no quantization`, `client/src/lib/displayCadence.js:46`), so the on-camera
  dollar figure updates at the full ~4 Hz render rate, while the side-panel meter advances on its own
  1000 ms tick (`client/src/App.jsx:215`). The two surfaces disagree on refresh rate for the *same*
  selected cadence. Accrual accuracy is unaffected (extrapolation stays continuous) and the 10s/60s
  cadences are fine (quantization holds them steady) — this is a display-only mismatch at "Every
  second." Fix direction: floor the display to whole seconds at the 1s cadence too (quantize when
  `stepSeconds ≥ 1`) or throttle the overlay's visible update to the cadence, so the overlay changes
  at most once per second. _(observed in dev 2026-07-12)_
- **OPS-1** — **Participant list self-heal poll.** `RealZoom._refresh()` marks the list unavailable
  on a `getMeetingParticipants` failure and only retries on the next `onParticipantChange` event or
  a panel reopen, so a transient failure can leave "Participants unavailable" stuck. Add a periodic
  retry poll (like the overlay's `getVideoState` recovery) so availability self-heals. Only worth
  building if the participant-fetch breadcrumb shows the role/recovery case (vs a config `40316`).
  _(deferred from simple-count-and-breadcrumb)_
- **OPS-2** — Refresh `reviews/backlog.md`'s stale per-item current-state notes: several entries
  still say config persists to `localStorage` / "rates never leave the browser", reference the
  removed `multiplier`, and gate deauth behind the dropped overlay live-test matrix. Bring them in
  line with the server-side encrypted-but-operator-decryptable store + matrix-dropped decision.
  _(deferred from docs-consistency-sweep — that file was out of the original docs-sweep scope)_
- **AUDIT-4** — _(optional)_ Add `eslint`/`prettier` + a CI lint step for the JS. Split out
  of AUDIT-2 (much larger diff: config + first-run reformat across all JS). _(from /dev-audit
  2026-07-02)_

## Done

- **BUG-1** — **Panel-close stops the meter — closed: not currently replicable.** Live run
  2026-07-12 (dev Railway env, real Zoom session): a normal panel "close" is a **hide, not a destroy**
  — the panel webview survives, its 1 s tick keeps accruing, so the meter keeps running and re-syncs
  on reopen; the freeze did not reproduce (nor on a deliberate "Close the app"). The `pagehide`
  teardown breadcrumbs (`panel-teardown`/`overlay-teardown`) never fired on any close path (Zoom
  hard-kills the webview without flushing `pagehide`), so they were **retired**. Candidate instrument
  if teardown observability is ever wanted: heartbeat + server-side gap detection (deferred, not
  built). See [dev-docs/panel-close-teardown.md](dev-docs/panel-close-teardown.md).
  _(PR #71 / merge: retire-teardown-breadcrumb)_
- **AUDIT-3** — Added a repo-root `.gitleaksignore` with the 3 immutable finding fingerprints
  for the synthetic secret-scan fixtures (`scripts/secret-scan/detect.test.mjs`,
  `server/test/loadEnv.test.js`, `reviews/secret-scan-guardrails.codex.json`) so external
  secret scanners stay high-signal. _(merge: audit-ci-hygiene)_
- **AUDIT-2** — Added a `shell-lint` CI job (`shellcheck` + `shfmt -d -i 2 -ci` over
  `shfmt -f .`) and `shfmt -w`'d the one non-conforming script
  (`dev-docs/marketing/marketplace-cover.sh`). The optional `eslint`/`prettier` tail was split
  to **AUDIT-4**. _(merge: audit-ci-hygiene)_
- **AUDIT-1** — Pin `{ authTagLength: 16 }` on both `aes-256-gcm` `createDecipheriv` sites
  (`server/src/zoom/appContext.js`, `server/src/store/rateCrypto.js`). _(PR #62 / merge: gcm-auth-tag-length)_
