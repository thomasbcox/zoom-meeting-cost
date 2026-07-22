# Backlog

The **canonical tracked-work list** for the `/dev-audit` → `/frame` → `/close` loop. Ids:
`AUDIT-` (from `/dev-audit`), `BUG-`, `OPS-`. The detailed product/strategy backlog lives in
[`reviews/backlog.md`](reviews/backlog.md). *(The earlier production roadmap,
[`dev-docs/roadmap-archive.md`](dev-docs/roadmap-archive.md), is **archived** — the dead-simple
pivot superseded it.)*

## Open

- **AUDIT-4** — _(optional)_ Add `eslint`/`prettier` + a CI lint step for the JS. Split out
  of AUDIT-2 (much larger diff: config + first-run reformat across all JS). _(from /dev-audit
  2026-07-02)_

## Done

- **BUG-3** — **Overlay showed a negative near-zero total in the first cadence bucket — fixed.**
  `quantizeForDisplay` (`client/src/lib/displayCadence.js`) now clamps its returned total at
  zero on **both** return paths. In the first bucket the displayed figure is
  `totalCost − costPerSecond × elapsedSeconds`, which dipped slightly negative when the
  `round2`'d total lagged the wall-clock accrual — rendering as "-$0.00" or a small negative
  and self-clearing once later buckets added whole positive cadence-steps. Display-only: the
  internal accrual and cost math are untouched. Unit tests cover the bucket-0
  negative-residual case and the exact-identity boundary for results that were already
  non-negative. Reported by Thomas from a live dev panel (2026-07-20). Full story:
  [`reviews/overlay-negative-zero.md`](reviews/overlay-negative-zero.md).
  _(PR #77 / merge: overlay-negative-zero)_

- **OPS-3** — **Zoom deauthorization webhook — done.** `POST /auth/deauthorize`
  (`server/src/zoom/deauth.js`) verifies the Zoom event signature (secret token +
  `x-zm-signature`, ±300 s replay window, timing-safe), answers the `endpoint.url_validation`
  challenge, and on `app_deauthorized` purges + acknowledges 200. The purge is a **no-op** —
  post-`remove-rate-store` nothing is persisted, so there is no record to delete; the endpoint
  itself was the requirement. **Ships inert:** returns 503 until `ZOOM_WEBHOOK_SECRET_TOKEN` is
  set — so the Marketplace gate is only truly cleared once that env var is set per environment
  and the dashboard's Deauthorization Notification Endpoint URL points at `/auth/deauthorize`
  (see [`server/zoom-app-config.md`](server/zoom-app-config.md)).
  **Correction landed with it:** this item previously required "the required confirmation" (the
  Data Compliance callback to `/oauth/data/compliance`). Zoom **deprecated** that API —
  *"no longer required to call this endpoint"*
  ([devforum](https://devforum.zoom.us/t/data-compliance-api-deprecated/51768)) — it is slated to
  become inoperative and Marketplace review no longer includes it; the **endpoint itself remains
  required** ([end-user-auth](https://developers.zoom.us/docs/integrations/end-user-auth/)). The
  callback was built to the stale premise and then deleted after the approach review caught it.
  Full story: [`reviews/deauth-endpoint.md`](reviews/deauth-endpoint.md).
  _(PR #75 / merge: deauth-endpoint)_

- **OPS-2** — **Stale rate-store notes reconciled — done.** Handled by `remove-rate-store`: with the
  server store deleted, `reviews/backlog.md`'s per-item current-state notes (and the other docs) are
  brought in line with the session-only reality (no `localStorage`, no server store). _(merge: remove-rate-store)_
- **BUG-2** — **Overlay refreshed ~4×/second at the "Every second" cadence — fixed.**
  `quantizeForDisplay` now floors at every allowed cadence (`stepSeconds ≥ 1`), so the 1 s cadence
  changes at most once per second — the overlay's 250 ms re-render shows the same floored value
  between second boundaries. Landed with the simple-only-panel cadence trim ({1,10}s, default 10).
  _(PR #72 / merge: simple-only-panel)_
- **OPS-1** — **Participant list self-heal poll — obsolete.** The participant list was removed
  entirely in simple-only-panel (the attendee count is now a manual input), so there is no
  `getMeetingParticipants` fetch left to self-heal. _(PR #72 / merge: simple-only-panel)_
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
