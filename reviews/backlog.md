# Backlog

Deferred work, tracked so it isn't lost. Each item becomes its own `/frame`
story when picked up.

> **Sequencing & priority live in [`dev-docs/roadmap.md` → Execution plan](../dev-docs/roadmap.md#execution-plan-orderly-development)**
> — the authoritative ordered inventory (dependencies + publishing gates) of every open **product
> item below**. This file is the **tactical detail store**: the *what/why* per item. The roadmap is
> the *when/in-what-order*. (Workflow-tracked `AUDIT-`/`BUG-`/`OPS-` items live in
> [`BACKLOG.md`](../BACKLOG.md), not here.)

## Zoom deauthorization / data-compliance webhook
- **Requested:** 2026-06-26 (Thomas), deferred from `reviews/data-delete-export.md`.
- **What:** Implement the mandatory Zoom deauthorization endpoint. On app uninstall Zoom POSTs a
  deauthorization event (with `user_data_retention`); if retention is `false` we must delete ALL
  data for that user within 10 days and POST confirmation to Zoom's `/oauth/data/compliance`.
  Reuses the **`userData.purgeUser(uid)`** primitive shipped in data-delete-export (PR #52).
- **Why:** A **hard publishing gate** — a published app that stores per-user data cannot pass
  Zoom Marketplace review without it (see `dev-docs/roadmap.md` Phase 6A and memory
  `reference-zoom-prod-unknowns-research`).
- **Design notes / open questions:**
  - Different trust path from the app: Zoom authenticates the webhook with an HMAC **secret
    token** (`x-zm-signature` + `x-zm-request-timestamp`) — a **new env var**, not the
    `x-zoom-app-context` header. Verify the signature before acting.
  - **⚠️ Identity mapping is unverified:** the event identifies the user by `payload.user_id`;
    confirm it equals our app-context `uid` (the rate-store key) before purging, or we'll purge
    the wrong/no records.
  - Outbound compliance callback to `https://api.zoom.us/oauth/data/compliance` (Basic auth with
    client id/secret), idempotent + signature-verified; set the "Deauthorization Notification
    Endpoint URL" in the Marketplace app config.
  - **Sequencing:** only needed at Marketplace submission, which is gated behind the overlay
    live-test matrix (not yet run) + the store being turned on (not yet configured). Build it
    close to submission.

## Client UI for data delete / export (+ privacy-page update)
- **Requested:** 2026-06-26 (Thomas), deferred from `reviews/data-delete-export.md`.
- **What:** Add presenter-facing "Export my data" and "Delete my data" controls (React panel)
  that call the shipped `GET /api/me/export` and `DELETE /api/me/data` endpoints (PR #52);
  delete needs a confirm step. Then update `docs/privacy.html` to advertise **self-serve** delete
  /export (today it still routes deletion via email) — bump the effective date with that change.
- **Why:** The backend data-rights endpoints shipped but are not yet user-reachable; the public
  privacy claim should only switch to "self-serve" once the UI actually exists (kept accurate
  deliberately in data-delete-export).
- **Design notes:** export is a download (the endpoint already sets `Content-Disposition`);
  delete should confirm + then reflect the now-empty state. Gate the privacy-page wording change
  to ship together with the UI so the claim stays true.

## Server process-level crash guards
- **Requested:** 2026-06-21 (Thomas), from `reviews/graceful-shutdown.md`.
- **What:** Add `process.on('unhandledRejection')` + `process.on('uncaughtException')` handlers
  (log the error; for uncaughtException, exit so the platform restarts a known-bad state) and
  a global Express error-handling middleware (4-arg) in `server/src/app.js`.
- **Why:** Today the request handlers are individually guarded, but there's no safety net.
  Any stray unhandled rejection would hard-kill the process (Node 22), and the `ON_FAILURE`
  restart policy (max 10) would amplify one bug into a notification flood. Belt-and-suspenders
  on top of the graceful-shutdown fix.

## In-Zoom client-error hardening (camera-overlay flow)
- **Requested:** 2026-06-21 (Thomas), from the Railway log in `reviews/graceful-shutdown.md`.
- **What:** Reduce the unhandled rejections the client reports via `/api/log` during the
  camera-overlay flow:
  - `"must call zoomSdk.config before using other API methods"` — ensure `zoomSdk.config()`
    has resolved before any other SDK call (`runRenderingContext`, etc.).
  - `"Video is not sending."` — handle starting the overlay when the camera is off (prompt /
    no-op instead of throwing).
  - `"The object does not support the operation or argument."` — guard the
    `postMessage`/`getVideoState` path.
- **Why:** Real (non-fatal) in-Zoom UX rough edges seen in production logs; they don't crash
  the server but pollute the error log and likely degrade the overlay experience. Needs an
  in-Zoom verification run.

## ~~Server header test depends on a built client (order-fragile gate)~~ — DONE
- **Shipped 2026-06-25** (PR #51 / merge: header-test-order-fix). The CSP-content test now
  asserts the delivered header on `/api/health` (never hits the SPA fallback), so the server
  suite passes whether or not `client/dist` exists; CI reordered to Test→Build and the
  build-before-test stopgap removed. Full story: `reviews/header-test-order-fix.md`.
- **Requested:** 2026-06-21 (Thomas), surfaced by the new CI workflow.
- **What:** `server/test/headers.test.js` (test "CSP allows the app bundle … connect-src
  pinned") fetches `GET /`. With no `client/dist`, the SPA fallback `sendFile` errors and
  Express's finalhandler overwrites the CSP with `default-src 'none'`, so the assertion
  fails. The test's own comment wrongly claims it passes without a build, and the gate
  `npm test && npm run build` passes locally only because a stale `dist` exists.
- **Why:** order-independence is the honest expectation. Fix the test to not depend on a
  built client (e.g. assert headers on a route that doesn't hit the SPA fallback, like
  `/api/health`), or have the SPA fallback preserve the security headers on a missing-file
  error. CI now builds before test as a stopgap.
- **Note:** app/test logic was intentionally NOT changed in the security-program story
  (docs-only scope); this is the proper follow-up.

## Ruleset-as-code (single source of truth for branch protection)
- **Requested:** 2026-06-21 (Thomas), from `reviews/security-program.md` re-review (DRY fix).
- **What:** Export the GitHub `main` ruleset to a committed `.github/rulesets/main.json` and
  add a CI drift-check that fails if the live ruleset diverges from the committed file.
- **Why:** Today the merge gate's required checks live canonically in `ssdlc.md` prose; the
  *enforced* authority is the GitHub ruleset config. Config-as-code makes that config
  version-controlled and reviewable, and the drift-check prevents "docs say X / GitHub
  enforces Y" — the more dangerous form of the duplication that the DRY fix only addressed
  in prose.
- **Design notes:** `gh api repos/{owner}/{repo}/rulesets/<id>` to export; a small workflow
  step diffs live-vs-committed. Docs then reference the JSON instead of restating specifics.

## ~~Redact `/api/log` payloads server-side~~ — DONE
- **Shipped 2026-06-25** (PR #50 / merge: api-log-redaction) via prevent-at-source minimization
  — not server-side redaction. Full story: `reviews/api-log-redaction.md`.
- **Approach chosen (2026-06-25):** addressed via **prevent-at-source / data minimization**
  rather than server-side redaction — see `reviews/api-log-redaction.md`. The client no longer
  *sends* participant PII (the diagnostics probe transmits only data shape; error reports use a
  fixed allowlist), so there is nothing to redact and no per-field server allowlist to maintain.
  A server-side structural sink-guard was deliberately deferred as a noted, unscheduled option.
- **Requested:** 2026-06-21 (Thomas), flagged from `reviews/security-program.md` review.
- **What (original framing):** `server/src/app.js` `/api/log` currently logs the submitted JSON
  body verbatim (`console.log("[client-log] " + JSON.stringify(req.body))`). Client diagnostics
  can include Zoom-provided meeting context (participant / user-context data). Add a strict
  server-side schema / field allowlist + redaction so logs cannot contain personal data, and
  trim the client diagnostics to non-identifying fields.
- **Why:** the data-retention/security policies now honestly state logs are *not* redacted
  today; this closes that gap so the stronger "scrubbed" claim becomes true. Privacy + log
  hygiene.
- **Design notes:** allowlist event `kind` + a fixed set of scalar fields; drop raw
  `getMeetingParticipants` / `getUserContext` dumps; keep error stacks but strip payloads.

## Retire the shape-only diagnostics probe once stable
- **Requested:** 2026-06-25 (Thomas), from `reviews/api-log-redaction.md`.
- **What:** Delete the in-Zoom recon probe (`client/src/zoom/zoomDiagnostics.js` —
  `runZoomDiagnostics` / `maybeRunZoomDiagnostics` / `PROBE_METHODS`, its `?diag=1` wiring, and
  its test) once the camera-overlay / in-Zoom work no longer needs ground-truth SDK shape data.
- **Why:** The probe was made **shape-only** (no participant values) in the api-log-redaction
  story, which removes the privacy concern — but it remains recon scaffolding that exists only
  to learn Zoom's data shapes. Once the overlay is stable and the shapes are settled, the probe
  has no ongoing purpose and is dead weight; removing it shrinks the client and the `/api/log`
  surface.
- **When to do:** after the overlay live-test matrix work concludes (it relies on in-Zoom
  diagnostics today — don't remove the tool while that is still in flight).
- **Done looks like:** the diagnostics probe + its flag/wiring/tests are gone; the gate stays
  green; no other code referenced it.

## ~~Remove the loaded-cost multiplier~~ — DONE
- **Shipped 2026-06-25** (PR #49 / merge: remove-cost-multiplier). Removed `multiplier` /
  `simpleMultiplier` from cost math, UI, and client state — the meter now uses
  `rate === baseRate` (per-participant) and `N × averageRate` (simple). Server
  `validateConfig` makes multiplier **optional-when-present**: legacy blobs round-trip and
  are ignored client-side, malformed values are still rejected; no data migration. Scaling
  dropped entirely, no replacement control (Thomas). Full story:
  `reviews/remove-cost-multiplier.md`.
- **Requested:** 2026-06-21 (Thomas), flagged from `reviews/opportunity-cost-framing.md`.
- **What:** Remove the `multiplier` / `simpleMultiplier` field, its UI, and its use in
  `computeTotals` / `computeSimpleTotals`, plus the stored-config schema field.
- **Why:** "Loaded cost" (overhead on top of pay) is a compensation concept. Now that the
  per-person number is an **opportunity cost** (already the full value of the person's time),
  multiplying it by an overhead factor double-counts and muddies the meaning. The framing
  pass ([`reviews/opportunity-cost-framing.md`](opportunity-cost-framing.md)) only neutralized
  the help text; this item removes the field.
- **Design notes / open questions:**
  - Touches identifiers + the persisted schema (`validateConfig`) → needs a back-compat read
    (ignore a legacy `multiplier`) or a migration, unlike the copy-only framing pass.
  - Decide whether to keep a value-neutral "scale" control or drop scaling entirely.

## Identify notetakers and default them to $1/hr
- **Requested:** 2026-06-12 (Thomas).
- **What:** Let the user flag certain attendees as notetakers (e.g. AI notetaker
  bots, or a human scribe) and have them default to a **$1/hr** rate rather than
  a full participant rate, so passive/automated attendees don't inflate the cost.
- **Why:** Bots and notetakers occupy a participant slot but aren't a real labor
  cost; counting them at a normal rate overstates the meeting's true cost.
- **Design notes / open questions:**
  - Ties into the per-participant rate table — a notetaker flag/tag on a row that
    sets (and re-applies) the $1/hr default; user can still override.
  - Consider auto-detecting common notetaker bot display names (e.g. Fathom,
    Otter, Read.ai, Zoom's own) as a *suggestion* to mark as notetaker — opt-in,
    never silent, to avoid mis-classifying a real person.
  - Interacts with the attendee-harvest item below (harvested notetaker names
    should be markable as such) and only matters in the per-participant model.
- **Done looks like:** the presenter can mark an attendee as a notetaker; that
  attendee is costed at $1/hr by default (overridable), and the marking persists
  / auto-matches like other rate-table rows.

## ~~Configurable cost-update cadence~~ — DONE
- **Shipped 2026-06-14** (merge `08a2fee`, `shipped/display-update-cadence`,
  PR #32). Presenter picks how often the on-camera number changes (1s / 10s /
  1min, default 10s); a pure `quantizeForDisplay` floors the displayed total +
  clock to the cadence grid while internal accrual stays second-accurate, with a
  cadence-aware clock (no seconds at the 1-min step) and an aggregate-only viewer
  preview beside the picker. Full story: `reviews/display-update-cadence.md`.

## esbuild/vite security bump (dev-only advisory) — advisory resolved; graph cleanup pending
- **STATUS 2026-07-01 (Thomas):** the **security advisory is resolved**, but the item is **NOT
  fully closed** — the dependency graph is not clean. Verified: `client/package.json` pins
  `vite@^6.4.2` → lockfile resolves **vite 6.4.3** → **esbuild 0.25.12** (≥ 0.25, patched); `npm ci`
  accepts the lockfile; `npm audit` reports **0 vulnerabilities** (prod *and* dev); the gate
  (`npm test && npm run build`) is green. **However** `npm ls vite esbuild --all` exits `ELSPROBLEMS`:
  `vitest@4.1.8` pulls a nested **`vite@8.0.16`** that requires esbuild `^0.27.0 || ^0.28.0`, while
  the tree dedupes esbuild `0.25.12` → marked **invalid**. So the original advisory (esbuild ≤ 0.24.2,
  via the client's Vite 6) is gone, but a *new* peer inconsistency exists on the vitest→vite@8 path.
  **Full closure = a clean `npm ls`**, which needs a lockfile reconciliation → tracked as its own item
  below (*"Reconcile vitest→vite@8 / esbuild peer conflict"*). Surfaced by the min-client-version-warning
  review (Codex BLOCKER, `reviews/min-client-version-warning.md`).
- **Deferred from:** Dependabot PR #23, closed 2026-06-10 (Thomas's call).
- **What:** A dev-server **esbuild** advisory (esbuild ≤ 0.24.2) reaches the repo
  transitively through **Vite**. The patched esbuild (`≥ 0.25`) requires Vite 6+
  (Vite 5.4.x ships esbuild 0.21.x). The bump is **deferred, not urgent**: esbuild is
  a *devDependency*, so `npm audit --omit=dev` reports **0 production vulnerabilities**
  — the issue only affects running the local dev server on an untrusted network.
- **Why PR #23 was closed (not merged):** it was malformed — `npm ci` failed because
  `client/package.json` pinned `vite@^8.0.16` while the committed lockfile resolved
  `6.4.2` (manifest ↔ lockfile out of sync; missing `vite@8`/`rolldown`/`lightningcss`).
  It also overshot to a bleeding-edge Vite 8 (rolldown) when the fix only needs esbuild
  ≥ 0.25 via Vite 6.
- **Verified clean path (local, 2026-06-10):** reconciling to **Vite 6.4.2 + esbuild
  0.25.12** (a regenerated, consistent lockfile) passes `npm test && npm run build`
  with **0 vulnerabilities**.
- **Done looks like:** `client` devDependency `vite` bumped to a consistent `^6` (e.g.
  `^6.4.2`) with a regenerated lockfile that `npm ci` accepts; esbuild resolves to
  `≥ 0.25`; the gate stays green. **Do it ideally alongside a CI job** (`npm ci` + the
  test suite on PRs) so future Dependabot PRs are auto-gated — a CI `npm ci` would have
  caught PR #23's broken lockfile automatically. See backlog **#3 Part C**.

## Reconcile vitest→vite@8 / esbuild peer conflict (clean `npm ls`)
- **Surfaced:** 2026-07-01, min-client-version-warning review (Codex BLOCKER).
- **What:** `npm ls vite esbuild --all` exits `ELSPROBLEMS`. `vitest@4.1.8` pulls a nested
  **`vite@8.0.16`** that requires esbuild `^0.27.0 || ^0.28.0`, but the tree dedupes esbuild
  **`0.25.12`** (what the client's Vite 6 uses), leaving vite@8's esbuild dep **invalid**. `npm ci`
  still installs and `npm audit` is clean (0 vulns), so it is **not a live vulnerability** — but the
  dependency graph is inconsistent and a fresh `npm install` could reshuffle it.
- **Why:** a clean, reproducible dependency graph; unblocks marking the esbuild-advisory item above
  fully DONE.
- **Options (decide when picked up):** (a) regenerate the lockfile so vite@8 carries its own nested
  esbuild 0.27+ instead of an invalid dedupe to 0.25.12; (b) pin/align vitest so it doesn't pull a
  vite@8 needing a newer esbuild; (c) bump esbuild to a version both Vite 6 and Vite 8 accept, if one
  exists. Touches `package-lock.json` (± `client/package.json`) — its **own `/frame` story**, not
  docs-only.
- **Done looks like:** `npm ls vite esbuild --all` exits clean (no `ELSPROBLEMS`); gate stays green;
  the esbuild-advisory item above can be marked DONE.

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
- **What:** The Content-Security-Policy still uses broad wildcards. *(Partial
  progress: `connect-src` was since pinned from the old `'self' wss: https:` to
  `'self' https://*.zoom.us https://*.zoom.com` — the `wss:` WebSocket was removed
  and the bare `https:` is gone — see `server/src/app.js`. So the remaining work is
  mainly `frame-ancestors`.)*
  - `frame-ancestors 'self' https://*.zoom.us https://*.zoom.com` — broad Zoom
    wildcards.
  - `connect-src` still wildcards `*.zoom.us` / `*.zoom.com` rather than exact origins.
- **Why defer:** Tightening to *exact* origins needs the stable production host(s)
  (the **Railway host today**, a custom domain later), which aren't fixed yet.
  Wildcards unblocked in-Zoom testing without risk to a prototype.
- **When to do:** Before any real distribution / Marketplace submission.
- **Done looks like:** `connect-src` narrowed from Zoom wildcards to the exact
  origins actually contacted; `frame-ancestors` narrowed to the exact Zoom client
  origins Zoom documents; CSP verified to still render in the Zoom client. (No WSS
  endpoint remains — the shared-state WebSocket was removed.)

## ~~Secret-leak guardrails — gitleaks + GitHub non-provider scan~~ — DONE
- **CLOSED 2026-06-10** (Thomas: "the secret guardrails are in place already").
  **Part A — the substantive guardrail — is shipped and live**
  (`reviews/secret-scan-guardrails.md`): a self-contained detector
  (`scripts/secret-scan/`), a tracked `.githooks/pre-commit`, gate wiring, and a
  guarded `postinstall` activating `core.hooksPath`. **Part B** (`secret_scanning_non_provider_patterns`)
  is feature-gated (REST API no-ops; one-click GitHub UI toggle only). As of
  2026-06-10 it is still **`disabled`** — left as an *optional* server-side backstop
  Thomas can flip anytime (*Settings → Code security → Secret scanning → "Scan for
  non-provider patterns"*); **not tracked further**. **Part C (CI Action) + pre-push
  hook: not pursued.** Item closed on the strength of Part A.
- **STATUS (2026-06-09, historical):** Part A DONE; Part B pending the manual toggle;
  Part C / pre-push not pursued.
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

## ~~Session lifecycle: no way to start/resume after "End session"~~ — DONE
- **Done in:** `reviews/session-restart-controls.md` (shipped 2026-06-10, merge
  `91a16ed`). A pure `sessionControls(status)` helper drives the buttons: an explicit
  **Start session** at `idle`, and from `ended` **both** "Start new session" (reset to
  $0 via `start()`) and "Resume" (continue the frozen total via `resume()`). The
  `ended` dead-end is gone. Live-verified in mock dev (idle→running→ended→Resume
  continued 11→21s).
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

## ~~Overlay auto-recover does not fire on camera off/on (live)~~ — DONE
- **Done in:** `reviews/overlay-rearm-reopen.md` (shipped 2026-06-10, merge `774b6b7`).
  **Confirmed working live** (Thomas, 2026-06-10): after a camera off→on with the
  overlay on, the meter returns **on its own** — no manual Hide→Show.
- **Root cause + fix:** a live log proved `onMyMediaChange` was not firing reliably in
  the panel, so the panel now **polls `getVideoState()`** (every 1.5 s while the overlay
  is on); on a detected off→on edge it **closes then reopens** the rendering context
  (mirroring the manual Hide→Show). The dead event-recovery path was removed.
- **Known limitation → tracked separately:** a *very brief* camera-off (shorter than the
  poll interval) can slip the poll's sampling gap — see the next item.
- **History:** originally found 2026-06-09; the first fix attempt
  (`overlay-teardown-diagnostics`) used `onMyMediaChange` events, which did not fire in
  the panel, so it never triggered. `overlay-rearm-reopen` replaced it with the poll.

## Overlay auto-recover misses very-brief camera-off flickers
- **Found:** live in-Zoom test (2026-06-10, Thomas), splitting off from the (now done)
  auto-recover item above.
- **What:** The overlay auto-recover polls `getVideoState()` every **1.5 s** while the
  overlay is on and recovers on a sampled off→on edge. A camera-off shorter than the
  poll interval can fall **between two polls** — the poll sees `video:true` before and
  after and never samples the `false`, so no edge is detected and the meter stays gone
  until the next genuine (longer) toggle or a manual Hide→Show. Observed once with a
  ~1 s toggle: `media-change` events fired but no `overlay-rearm:*` followed.
- **Why low priority:** a real "camera off for a moment, then back on" is comfortably
  longer than 1.5 s and recovers fine; you have to toggle *deliberately* fast to hit
  this, and it self-heals on the next normal toggle.
- **Options when picked up (do NOT resurrect the flaky event path):**
  - **Tighten the poll** to ~1 s / 750 ms — same reliable signal, smaller gap, a few
    more (cheap) `getVideoState` calls. Simplest.
  - Only if it proves necessary, *layer* an event trigger as a non-authoritative
    extra — but `onMyMediaChange` has fired inconsistently in the panel (silent in one
    live log, present in another), so it must never be the sole signal.
- **Done looks like:** a fast (sub-second) camera off→on with the overlay on still
  auto-recovers, with no regression to the normal-duration case.
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
