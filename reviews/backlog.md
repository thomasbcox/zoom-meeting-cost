# Backlog

Deferred work, tracked so it isn't lost. Each item becomes its own `/frame`
story when picked up.

## Workflow skill defects — moved out of this repo
- Not a `zoom-meeting-cost` item. Exported as a standalone story
  (`~/workflow-skill-defects.story.md`) for the repo that owns the
  frame→review→close skills (`~/.claude/skills/`). Covers the `/close` merge-gate +
  status-lifecycle defects found 2026-06-04.

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

## Session lifecycle: no way to start/resume after "End session"
- **Found:** live in-Zoom test (2026-06-05, real mode). Thomas: "no way to resume
  after 'end session'."
- **What:** The session state machine has no exit from `ended`. In
  `PresenterControls.jsx` the Pause / Resume / End buttons are all gated on
  `running`/`paused`/`active`, so once `session.status === 'ended'` none render —
  only the overlay show/hide button is left. And `startOverlay` only starts
  counting from `idle` (`App.jsx`: `if (status === 'idle') sessionActions.start()`),
  so from `ended` clicking "Show cost on video" shows the overlay but leaves
  status `ended` and the tick loop (gated on `running`) stays frozen. There is
  also no explicit "Start" control at all — the session is only ever started
  implicitly by the overlay button.
- **Why defer:** Logged during the live overlay (AC6) test; Thomas chose to log
  it and keep focus on overlay rendering for now.
- **When to do:** Next real-mode UX pass.
- **Done looks like:** From `ended` (and `idle`) there is a clear way to begin a
  fresh session — e.g. a "Start new session" button that resets elapsed + total
  via `sessionActions.start()` — and the meter counts again. Decide whether
  `ended` offers "start new" (reset) vs "resume" (continue) semantics.

## RealZoom: `drawWebView` may require `webviewId`
- **Deferred from:** advisor review (2026-06-04, Thomas's call — backlogged
  alongside `reviews/realmode-p1-fixes.md`).
- **What:** `RealZoom.startCameraOverlay()` calls
  `drawWebView({ x, y, width, height, zIndex })`. The bundled `@zoom/appssdk`
  type (`DrawWebViewOptions.webviewId`) marks `webviewId` as **required**, yet
  the SDK's own docs example omits it. Unresolved contradiction.
- **Why defer:** Real-Zoom integration risk, not a proven bug — can only be
  confirmed by running inside the Zoom client. Tests exercise only `MockZoom`.
- **When to do:** During real in-Zoom overlay testing.
- **Done looks like:** Overlay composites on the camera feed in the Zoom client;
  if `drawWebView` errors on a missing `webviewId`, pass the correct id (and add
  a note on where it comes from).

## ~~RealZoom: participant-fetch failure looks like a valid $0 meeting~~ — DONE
- **Done in:** `reviews/presenter-honesty.md` (2026-06-04). A failed
  `getMeetingParticipants()` now flips `participantsAvailable()` to `false` and
  the presenter readout shows a "participants unavailable / need host access"
  notice instead of a misleading $0.

## ~~Real Zoom shows prototype-only identity (`self` ignored)~~ — DONE
- **Done in:** `reviews/presenter-honesty.md` (2026-06-04). `Root` threads `self`
  to `App`, which seeds the presenter name from `self.displayName` (falling back
  to `Presenter`).
