# Backlog

Tracked work items. Ids: `AUDIT-` (from `/dev-audit`), `BUG-`, `OPS-`.

## Open

- **AUDIT-1** — Pin `{ authTagLength: 16 }` on both `aes-256-gcm` `createDecipheriv` sites
  (`server/src/zoom/appContext.js:45`, `server/src/store/rateCrypto.js:56`) so GCM can't
  accept a truncated auth tag. Security hardening on the auth/crypto boundary. _(from /dev-audit 2026-07-02)_
- **AUDIT-2** — Add `shellcheck` + `shfmt -d -i 2 -ci` to CI (estate shell standard; both
  belong in CI), and `shfmt -w` the one non-conforming script
  (`dev-docs/marketing/marketplace-cover.sh`). Optionally add `eslint`/`prettier` + a CI
  lint step for the JS. _(from /dev-audit 2026-07-02)_
- **AUDIT-3** — Add a `.gitleaksignore` (or per-line allowlist) for the synthetic
  secret-scan fixture paths (`scripts/secret-scan/detect.test.mjs`,
  `server/test/loadEnv.test.js`, `reviews/secret-scan-guardrails.codex.json`) so external
  secret scanners stay high-signal. _(from /dev-audit 2026-07-02)_

## Done
