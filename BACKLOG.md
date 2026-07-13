# Backlog

The **canonical tracked-work list** for the `/dev-audit` → `/frame` → `/close` loop. Ids:
`AUDIT-` (from `/dev-audit`), `BUG-`, `OPS-`. The detailed product/strategy backlog (roadmap
deep-links) lives in [`reviews/backlog.md`](reviews/backlog.md); the strategy above both is
[`dev-docs/roadmap.md`](dev-docs/roadmap.md).

## Open

- **OPS-2** — Refresh `reviews/backlog.md`'s stale per-item current-state notes: several entries
  still say config persists to `localStorage` / "rates never leave the browser", reference the
  removed `multiplier`, and gate deauth behind the dropped overlay live-test matrix. Bring them in
  line with the server-side encrypted-but-operator-decryptable store + matrix-dropped decision.
  _(deferred from docs-consistency-sweep — that file was out of the original docs-sweep scope)_
- **AUDIT-4** — _(optional)_ Add `eslint`/`prettier` + a CI lint step for the JS. Split out
  of AUDIT-2 (much larger diff: config + first-run reformat across all JS). _(from /dev-audit
  2026-07-02)_

## Done

- **BUG-2** — **Overlay refreshed ~4×/second at the "Every second" cadence — fixed.**
  `quantizeForDisplay` now floors at every allowed cadence (`stepSeconds ≥ 1`), so the 1 s cadence
  changes at most once per second — the overlay's 250 ms re-render shows the same floored value
  between second boundaries. Landed with the simple-only-panel cadence trim ({1,10}s, default 10).
  _(merge: simple-only-panel)_
- **OPS-1** — **Participant list self-heal poll — obsolete.** The participant list was removed
  entirely in simple-only-panel (the attendee count is now a manual input), so there is no
  `getMeetingParticipants` fetch left to self-heal. _(merge: simple-only-panel)_
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
