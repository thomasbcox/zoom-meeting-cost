# Backlog

Deferred work, tracked so it isn't lost. Each item becomes its own `/frame`
story when picked up.

## Rate-table memory across meetings + harvest attendee names into it
- **Requested:** 2026-06-08 (Thomas).
- **What:** Make the per-participant rate table grow from the people you actually
  meet with, and persist so previously-seen attendees auto-match next time:
  1. **Harvest attendee names** — a one-click (or opt-in auto) "add current
     attendees to the rate table" that pulls the live participant display names
     into rate-table rows so the presenter can assign each a rate.
  2. **Memory across meetings** — those rows persist so the same person auto-matches
     (and keeps their rate) in a later meeting.
- **Current state (verify before building):** the rate table, aliases, defaultRate
  and multiplier ALREADY persist to `localStorage` per browser
  (`usePresenterStore.js`, key `meeting-cost:presenter:v1`) — so single-browser
  memory across meetings largely exists today. Per-meeting `overrides` are
  intentionally NOT persisted. The missing piece is the *harvest* flow and
  dedupe/matching, plus a decision on durability beyond one browser.
- **Design notes / open questions:**
  - **Dedupe** harvested names against existing rate rules + aliases using the
    existing `lib/normalize.js` / `lib/matching.js` so you don't add duplicates;
    only add genuinely new names.
  - **Auto vs. manual** — a button ("Add these attendees") vs. silently
    auto-adding everyone who joins (proposed: manual/opt-in to avoid clutter).
  - **Privacy invariant (important):** keeping harvested names in the
    browser-only rate table preserves "rates/names never leave the browser." A
    *cross-device / shared* memory would need server-side storage, which
    **conflicts with that invariant** — out of scope unless the privacy model is
    deliberately revisited (separate decision).
  - Interaction with the new **simple cost model** (names are irrelevant in simple
    mode; harvest only matters for the per-participant model).
- **Done looks like:** the presenter can pull the current meeting's attendees into
  the rate table (deduped via existing name normalization/aliases), assign rates,
  and those names auto-match the same people in a future meeting — all still
  browser-only.

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
- **STATUS (2026-06-09):** **Part A DONE** — the local pre-commit secret scanner
  shipped and merged (`reviews/secret-scan-guardrails.md`): a self-contained
  detector (`scripts/secret-scan/`), a tracked `.githooks/pre-commit`, gate wiring,
  and a guarded `postinstall` activating `core.hooksPath`. **Part B PENDING a manual
  step** — `secret_scanning_non_provider_patterns` is feature-gated; the REST API
  returns 200 but silently leaves it disabled, so it requires a one-click **GitHub
  UI toggle by Thomas** (repo *Settings → Code security → Secret scanning → "Scan
  for non-provider patterns"*). **Part C (CI Action) + a pre-push hook: NOT
  pursued** (2026-06-09, Thomas — bookkeeping only). So the only open work is
  Thomas's one UI click for B.
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

## Overlay auto-recover does not fire on camera off/on (live)
- **Found:** live in-Zoom use (2026-06-09, Thomas). The auto-recover shipped in
  `reviews/overlay-teardown-diagnostics.md` was meant to restore the camera overlay
  automatically after the presenter toggles their camera off then on. **It does not
  fire in practice** — the meter stays gone and the presenter still has to manually
  toggle the cost-display button (Hide → Show) to bring it back.
- **Repro:** start the overlay, turn the camera off, turn it back on → overlay does
  not return; click "Hide from video" then "Show cost on video" to restore it.
- **Suspects (for a diagnostic story):** the panel's `onMyMediaChange` subscription
  may not be receiving events in the real client; or the off→on gating
  (`reduceOverlayRecovery`) doesn't match the real event sequence; or re-running
  `runRenderingContext` while the context is torn down is rejected. The shipped
  `overlay-teardown` / `media-change` / `overlay-rearm:*` logs should be read from a
  fresh live run to see which.
- **When to do:** Next overlay diagnostic pass — the instrumentation to diagnose it
  is already in place; this needs a live-log read, then a fix.
- **Done looks like:** after a camera off→on with the overlay on, the meter returns
  on its own (no manual Hide→Show), confirmed live with `overlay-rearm:*` in the log.

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
