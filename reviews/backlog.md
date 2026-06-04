# Backlog

Deferred work, tracked so it isn't lost. Each item becomes its own `/frame`
story when picked up.

## ~~Remove the unused shared-state WebSocket~~ — DONE
- **Done in:** `reviews/ws-cleanup-railway.md` (2026-06-04). Deleted
  `syncClient.js`, `sharedState.js`, `server/src/rooms.js`, the `/ws` server +
  proxy, and the `ws` dependency.

## CSP hardening — pin to exact origins
- **Deferred from:** `reviews/zoom-owasp-headers.md` (2026-06-03, Thomas's call).
- **What:** The Content-Security-Policy shipped for the Zoom blank-screen fix is
  intentionally permissive for dev:
  - `connect-src 'self' wss: https:` — allows the WebSocket/API to any HTTPS/WSS
    host, not just our origin.
  - `frame-ancestors 'self' https://*.zoom.us https://*.zoom.com` — broad Zoom
    wildcards.
- **Why defer:** Tightening needs the stable production origin(s) (tunnel today,
  a real domain later), which aren't fixed yet. Loosening for dev unblocked
  in-Zoom testing without risk to a prototype.
- **When to do:** Before any real distribution / Marketplace submission.
- **Done looks like:** `connect-src` pinned to our own origin + the specific WSS
  endpoint; `frame-ancestors` narrowed to the exact Zoom client origins Zoom
  documents; CSP verified to still render in the Zoom client.

## Secret-leak guardrails — gitleaks + GitHub non-provider scan
- **Deferred from:** `reviews/zoom-cred-fingerprint.md` post-mortem (2026-06-04,
  Thomas's call). Prompted by a live Zoom client secret getting committed/pushed
  in a test fixture (Codex caught it; secret rotated).
- **What:** Defense-in-depth so a secret in a diff can't reach the remote again:
  - **A. Local secret-scan hook** — gitleaks (or a regex scanner) as a
    pre-commit/pre-push hook beside `~/.claude/hooks/block-main-writes.sh`,
    exit 2 to block a staged diff containing a secret. Strongest lever (catches
    pre-push).
  - **B. GitHub non-provider patterns** — flip
    `secret_scanning_non_provider_patterns` to enabled (push protection is
    already on but blind to generic secrets like a Zoom client secret); optional
    custom Zoom pattern. One `gh api` toggle, server-side backstop.
  - **C. (optional) CI gitleaks Action** on PRs — redundant post-push backstop.
- **Why defer:** Thomas dismissed immediate setup; not blocking current work.
- **When to do:** Before this repo takes on more contributors or real secrets in
  more places; sooner is cheap.
- **Done looks like:** A local commit that contains a known test secret is
  blocked by the local hook; GitHub push protection rejects a generic secret in
  a push. Behavioral guard already in place (memory:
  `feedback-no-real-secrets-in-repo`).
