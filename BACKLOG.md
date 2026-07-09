# Backlog

Tracked work items. Ids: `AUDIT-` (from `/dev-audit`), `BUG-`, `OPS-`.

## Open

- **BUG-1** — **Panel-close stops the meter.** The cost-accrual loop is a `setInterval` in the
  side panel (`client/src/App.jsx`), so closing the app panel unmounts it and the on-camera meter
  freezes at its last value. Re-architect so the camera-overlay instance self-accrues from the last
  cost-rate (accrual independent of the panel). Documented as a "keep the panel open" limitation for
  now. _(deferred from simple-default-role-gate)_
- **OPS-1** — **Participant list self-heal poll.** `RealZoom._refresh()` marks the list unavailable
  on a `getMeetingParticipants` failure and only retries on the next `onParticipantChange` event or
  a panel reopen, so a transient failure can leave "Participants unavailable" stuck. Add a periodic
  retry poll (like the overlay's `getVideoState` recovery) so availability self-heals. Only worth
  building if the participant-fetch breadcrumb shows the role/recovery case (vs a config `40316`).
  _(deferred from simple-count-and-breadcrumb)_
- **AUDIT-4** — _(optional)_ Add `eslint`/`prettier` + a CI lint step for the JS. Split out
  of AUDIT-2 (much larger diff: config + first-run reformat across all JS). _(from /dev-audit
  2026-07-02)_

## Done

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
