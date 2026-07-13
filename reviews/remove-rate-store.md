Date: 2026-07-13 · Branch: claude/remove-rate-store · Status: approved

# remove-rate-store — tear down the dead server rate store + reconcile the data claims (Story 2)

## Problem

Story 1 (`simple-only-panel`, shipped) made the client **session-only**: it no longer calls
`/api/rates` and no longer sends the Zoom app-context identity header. That leaves the entire
server-side rate store and its supporting stack **dead code that still ships and still claims to hold
user data**. The cascade (confirmed by recon):

- `server/src/app.js` — `/api/rates` (GET/PUT), the `/api/me/data` (DELETE) + `/api/me/export` (GET)
  data-rights routes, and the `requireIdentity` + `requireRateStore` middleware that gate them.
- `server/src/store/rateStore.js` + `store/rateCrypto.js` (the encrypted store + `RATE_STORE_KEY`).
- `server/src/zoom/appContext.js` (`resolveUid`/`decryptAppContext`) — its **only** consumer is
  `requireIdentity`, so it dies with the routes.
- `server/src/userData.js` (`purgeUser`/`exportUser`) — only the data-rights routes use it.
- The Railway **Volume** (`DATA_DIR`) — the server persists nothing after this.

Worse than dead code: the **public privacy policy + marketplace pages** and the **security policies**
still describe a "server-side encrypted (operator-decryptable) store" with export/delete rights that
**no longer exist**. Shipping the teardown without reconciling those claims is a live compliance
mismatch. This story removes the stack and makes every claim match the no-persistence reality.

## In scope

- Delete the server rate store, its crypto, the app-context identity path, `userData`, and the
  `/api/rates` + `/api/me/data` + `/api/me/export` routes and their middleware, plus their tests.
- Remove `RATE_STORE_KEY` / `DATA_DIR` from env examples and hosting docs; remove the Railway Volume.
- Reconcile **all** docs/claims to "no presenter data is stored server-side (session-only)": README,
  `server/zoom-app-config.md` (also drop the `meeting:read:participant` scope Story 1 stopped needing),
  `dev-docs/railway-setup.md`, `dev-docs/roadmap.md`, the architecture SVG, the security policies
  (`dev-docs/policies/*`), and the **public** `docs/privacy.html` / `documentation.html` / `support.html`.
- Record cleanup: update the merged `reviews/simple-only-panel.md` with its CLEARED live-gate evidence;
  close **OPS-2** (stale store notes in `reviews/backlog.md`).

## Non-goals

- **Panel reorg/layout cleanup** — the user also asked for this; it is **NOT** in this story. See Open
  question 1 (recommend a separate Story 3).
- **Building** the Zoom deauthorization webhook — out of scope, but now **explicitly tracked and gated**
  (Finding ③, AC9): a new backlog item blocks marketplace submission until it exists. The purge is now a
  no-op (nothing persisted); the webhook is separate machinery (Zoom event-signature verification, not
  the removed app-context identity).
- **Panel reorg / layout cleanup** — split to its own **Story 3 (`panel-reorg`)**, framed next.
- OAuth (`/auth`, `oauth.js`, `ZOOM_CLIENT_ID`/`ZOOM_CLIENT_SECRET`), security headers/CSP,
  `/api/health`, `/api/log`, and static client serving all **stay** — unchanged.
- No client changes (Story 1 is done and shipped).

## Acceptance criteria

1. **Store + identity + data-rights removed (server).** `store/rateStore.js`, `store/rateCrypto.js`,
   `zoom/appContext.js`, `userData.js` are deleted; `app.js` drops their imports, `requireIdentity`,
   `requireRateStore`, and the `/api/rates` (GET/PUT), `/api/me/data` (DELETE), `/api/me/export` (GET)
   routes. No reference to `resolveUid`, `rateStore`, `RATE_STORE_KEY`, or `DATA_DIR` remains in `server/src`.
2. **Kept intact.** `/auth` (OAuth), security headers/CSP, `/api/health`, `/api/log`, and static client
   serving are unchanged and their tests pass. `ZOOM_CLIENT_ID`/`SECRET` remain (OAuth).
3. **Dead server tests gone; gate green.** `rateStore.test.js`, `rateCrypto.test.js`,
   `appContext.test.js`, `identityLog.test.js`, `userData.test.js`, `rates.test.js` are deleted;
   surviving server + client tests pass; `npm test && npm run build` is green.
4. **Env reconciled.** `RATE_STORE_KEY` / `DATA_DIR` removed from `server/.env.example` (and any other
   env doc that lists them); nothing in `server/src` reads them.
5. **Dev/hosting/config docs reconciled.** README, `server/zoom-app-config.md` (persistent-storage +
   `RATE_STORE_KEY`/Volume section **and** the `meeting:read:participant` scope removed),
   `dev-docs/railway-setup.md`, `dev-docs/roadmap.md`, `dev-docs/meeting-cost-architecture.svg` reflect
   no server persistence and no participant scope.
6. **Security/privacy claims match reality (sensitive) — NARROWED per Finding ①.** The public pages
   (`docs/privacy.html`, `documentation.html`, `support.html`), the security policies
   (`dev-docs/policies/{security-policy,incident-response,ssdlc,data-retention-and-protection}.md`), and
   any other live doc asserting the store no longer describe a persisted presenter-data store or
   export/delete rights. They state the accurate invariant: **no presenter configuration, rates, names,
   or meeting history are persisted — those are session-only.** They **retain** the operational-logging
   disclosure (`/api/log` writes PII-free client diagnostics + `[server] METHOD path` request lines to
   Railway), its retention/access rules, the OAuth-processing disclosure, the privacy contact, and a
   rights-request process. *Exact `privacy.html` legal copy is Thomas-approved before ship (Open Q2).*
7. **Record + backlog.** `reviews/simple-only-panel.md` records its post-merge live gate CLEARED
   (evidence: dev build `804e66c`, `drawParticipant ok:true` ×4). **OPS-2** moved to Done.
8. **Railway Volume** removed via the `railway` CLI post-merge (Open Q3) — the server persists nothing.
9. **Deauth obligation tracked-and-gated (Finding ③).** A new backlog item (`OPS-3`) is added: build a
   Zoom deauthorization / data-compliance webhook (verify the event signature → return the required
   confirmation → no-op presenter-data purge) — and it **blocks marketplace submission/publishing** until
   done. The reconciled docs state the app is **pre-release/unpublished** (deauth not yet live).

## Test notes

- AC1/AC2/AC3: `git grep -nE "rateStore|rateCrypto|appContext|resolveUid|RATE_STORE_KEY|DATA_DIR|/api/rates|/api/me/" server/src` returns nothing; the surviving server suite (headers, health, clientLog, oauthFingerprint, port, shutdown, version, loadEnv, requestLog) is green; `npm test && npm run build` passes.
- AC4/AC5/AC6: `git grep -nE "RATE_STORE_KEY|DATA_DIR|/api/rates|encrypted.*store|export.*delete|operator-decryptable|meeting:read:participant"` over docs/config returns only intentional "no longer / removed" mentions; read the reconciled privacy/policy pages.
- AC7: read `reviews/simple-only-panel.md` (CLEARED note) and `BACKLOG.md` (OPS-2 under Done).
- **Scope containment:** run `git diff --name-only main...HEAD` and verify no files appear beyond those enumerated in the Design sketch file list.

## Open questions

1. **Panel reorg → its own Story 3 (recommend).** You also asked to "reorg the panel and clean it up —
   it's not well laid out." I recommend **not** bundling it here: (a) it mixes a subjective UI/UX rebuild
   with a security/marketplace-sensitive backend teardown, hurting review isolation — the same reason we
   split Story 1/2; (b) a layout redo wants **visual iteration** (screenshot the current panel, agree a
   target), a different mode than deterministic deletion. *Recommend: split into Story 3 `panel-reorg`,
   framed next.*
2. **Privacy/legal wording is Thomas-approved.** Editing `docs/privacy.html` + the policies changes
   **public legal claims** (TXL LLC, WA governing law per the marketplace-pages notes). I'll draft the
   substance — "Meeting Cost stores **no** presenter data on its servers; the rate + count live only in
   your browser session" and drop the export/delete-rights language — but **you ratify the exact copy**.
3. **Railway Volume removal (destructive).** Removing the Volume deletes the stored encrypted blobs
   (existing users' saved rate tables — acceptable, the app is session-only now; they re-enter). Do it
   via the `railway` CLI **after** the code merges (nothing reads it by then), or leave it as a step for
   you? *Recommend: I remove it via CLI post-merge, once the deployed server no longer mounts it.*

## Design sketch — HOW

Pure server-side deletion + prose reconciliation. No new code, structure, or dependency.

- **`server/src/app.js`** → remove the three imports (`appContext`, `rateCrypto`/`rateStore`,
  `userData`), the `requireIdentity` + `requireRateStore` functions, and the four routes (`/api/rates`
  GET+PUT, `/api/me/data` DELETE, `/api/me/export` GET). Leave `securityHeaders`/CSP, `/api/health`,
  `/api/log`, `/auth` mount, and static serving byte-for-byte intact.
- **Delete modules + tests:** `store/rateStore.js`(+test), `store/rateCrypto.js`(+test),
  `zoom/appContext.js`(+test), `userData.js`(+test), `test/rates.test.js`, `test/identityLog.test.js`.
- **Env/docs:** delete `RATE_STORE_KEY`/`DATA_DIR` from env examples + hosting docs; rewrite the
  privacy/policy/marketplace prose to "no server-side presenter-data store; session-only" (Thomas-approved).
- **Record:** append the CLEARED gate note to `reviews/simple-only-panel.md`; move OPS-2 → Done.
- **Infra:** `railway` Volume removal (Open Q3).

**File list (scope-containment AC):**
- *Delete (module + test):* `server/src/store/rateStore.js`(+`test/rateStore.test.js`),
  `server/src/store/rateCrypto.js`(+`test/rateCrypto.test.js`), `server/src/zoom/appContext.js`(+`test/appContext.test.js`),
  `server/src/userData.js`(+`test/userData.test.js`); plus `server/test/rates.test.js`, `server/test/identityLog.test.js`.
- *Rewrite:* `server/src/app.js`.
- *Env:* `server/.env.example` (+ any other env doc listing `RATE_STORE_KEY`/`DATA_DIR` — verify).
- *Docs (dev):* `README.md`, `server/zoom-app-config.md`, `dev-docs/railway-setup.md`,
  `dev-docs/roadmap.md`, `dev-docs/meeting-cost-architecture.svg`, `dev-docs/policies/security-policy.md`,
  `dev-docs/policies/incident-response.md`, `dev-docs/policies/ssdlc.md`.
- *Docs (public — legal-sensitive):* `docs/privacy.html`, `docs/documentation.html`, `docs/support.html`.
- *Record/backlog:* `reviews/simple-only-panel.md`, `BACKLOG.md`, `reviews/backlog.md`.
- *(Finding 2 additions — verify + reconcile if they assert the store):* `dev-docs/policies/data-retention-and-protection.md`,
  `dev-docs/policies/dependency-management.md`, `dev-docs/opportunity-cost-rate.md`, and the stale
  App-Context comment in `server/src/zoom/oauth.js`. Historical `reviews/*.md` records are **immutable**
  — not edited.

## Codex design review (2026-07-13)

**Verdict:** the server deletion **cascade is structurally clean** — `appContext`/`resolveUid` has no
consumer outside the removable middleware; OAuth, health, logging, security headers, and static serving
are isolated and stay. **But not ready as-is** for a security/marketplace-sensitive teardown: the privacy
claim overclaims, the reconciliation inventory is incomplete, and it leaves a marketplace obligation
unresolved.

### BLOCKER
- **① "No presenter data stored server-side" overclaims** — [one-way · nonstandard]. Removing the rate
  store does not make the server data-free: `/api/log` writes client diagnostics + error text to Railway
  logs, request logging remains, and OAuth processes auth codes/tokens. An unqualified "no data" claim +
  dropping export/delete language could misstate collection/retention/data-subject handling.
  **Alternative:** narrower invariant everywhere — *"No presenter configuration, rates, names, or meeting
  history are persisted; those are session-only."* Preserve the operational-logging disclosure + its
  retention/access rules, the OAuth-processing disclosure, the privacy contact, and a rights-request
  process. Inventory the actual `/api/log` fields first. **Win:** no false public legal claim; accurate
  disclosures retained.
- **③ Teardown leaves the deauthorization obligation behind** — [one-way · nonstandard]. The published-app
  OAuth path stays and Zoom still requires a deauth/data-compliance endpoint; treating it as an unrelated
  "pre-existing gap" while removing the identity/purge path and revising compliance claims makes it easy
  to overlook. **Alternative:** either include a minimal deauth endpoint (verify event → required
  confirmation → no-op presenter-data purge), **or** explicitly gate marketplace submission on a
  follow-on story with an owner + acceptance test. Don't retain `resolveUid` "by default." **Win:**
  closes or explicitly gates a known marketplace blocker without preserving the obsolete store.

### IMPORTANT
- **② Claims-reconciliation inventory is incomplete** — [two-way · kludgy]. The list named 3 policy
  files; more live contradictions remain (`data-retention-and-protection.md`, `dependency-management.md`,
  `opportunity-cost-rate.md`, an `oauth.js` App-Context comment) — outside the scope list, so the final
  grep would fail or pressure scope creep. **Alternative:** build the rewrite set from a repo-wide claim
  scan; add every surviving hit; classify historical `reviews/*.md` as immutable references. **Win:**
  internally-consistent scope gate; no contradictory docs shipped.

## Design decisions (2026-07-13)

Thomas's decision, verbatim: **"approve, split the panel to story 3, track-and-gate the deauth"** — scope approved.

- **Finding ① (privacy overclaim, BLOCKER one-way) — FIXED (narrowed).** AC6 reworded to the accurate
  invariant ("no presenter config/rates/names/history persisted — session-only"); operational-logging +
  OAuth + retention disclosures + privacy contact + rights-request process RETAINED. Exact `privacy.html`
  copy is Thomas-ratified before ship.
- **Finding ② (incomplete inventory, IMPORTANT) — FIXED.** Repo-wide claim scan done; file list extended
  (`data-retention-and-protection.md` + the `oauth.js` comment + verify `dependency-management.md` /
  `opportunity-cost-rate.md`); historical `reviews/*.md` left immutable.
- **Finding ③ (deauth obligation, BLOCKER one-way) — FIXED via TRACK-AND-GATE.** New AC9 + backlog
  `OPS-3`: the deauth webhook is a tracked gate that blocks marketplace submission; NOT built here; the
  purge is now a no-op; docs state the app is pre-release/unpublished.
- **Panel reorg → Story 3** (`panel-reorg`), framed next. Not in this story.
- **Railway Volume** removed via the `railway` CLI post-merge (Open Q3).

## Build note (2026-07-13)

AC → file map:
- **AC1/AC2** (store+identity+data-rights removed; OAuth/health/log/static kept) → `server/src/app.js`;
  deletions `server/src/store/rateStore.js`, `store/rateCrypto.js`, `zoom/appContext.js`, `userData.js`;
  `server/src/zoom/oauth.js` (stale app-context comment).
- **AC3** (dead tests gone) → deleted `server/test/{rateStore,rateCrypto,appContext,identityLog,userData,rates}.test.js`.
- **AC4** (env) → `server/.env.example` never listed `RATE_STORE_KEY`/`DATA_DIR` (set directly in Railway) — moot.
- **AC5** (dev/hosting docs) → `README.md`, `server/zoom-app-config.md`, `dev-docs/railway-setup.md`,
  `dev-docs/meeting-cost-architecture.svg`; `dev-docs/roadmap.md` via a superseding banner.
- **AC6** (privacy/security claims, NARROWED per Finding ①) → `docs/privacy.html`, `docs/terms.html`,
  `docs/documentation.html`, `docs/support.html`, `dev-docs/policies/{security-policy,incident-response,ssdlc,data-retention-and-protection,dependency-management}.md`,
  `dev-docs/opportunity-cost-rate.md`, `dev-docs/camera-overlay-no-update.md`.
- **AC7** (record+backlog) → `reviews/simple-only-panel.md` (gate cleared), `BACKLOG.md` (OPS-2 → Done),
  `reviews/backlog.md`.
- **AC9** (deauth tracked-and-gated) → `BACKLOG.md` (OPS-3).

**Scope note (Finding ② confirmed during implementation).** The final repo-wide scan surfaced
contradictory claims beyond the spec's file list: `docs/terms.html`, `dev-docs/opportunity-cost-rate.md`,
`dev-docs/camera-overlay-no-update.md` were added; and the Story-1 **per-person** narrative leftover in
`README.md`/`docs/documentation.html`/`docs/support.html` was swept up so the doc set isn't
self-contradictory (privacy said single-rate while README said per-person). So the actual diff exceeds
the enumerated scope-containment list — a deliberate, consistency-driven expansion, flagged here.

## Codex approach review (2026-07-13, base main, HEAD 1fce780)

**Verdict:** the server deletion cascade is clean and deletion-only (OAuth/health/log/headers/static
undisturbed; no dependency change). **NOT merge-ready:** the public legal copy still asserts encrypted
account storage, several live docs still present the removed architecture as current, and the logging
claims overstate what the unchanged `/api/log` sink guarantees.

### BLOCKER
- **① Terms still promise the removed encrypted account store** — [one-way · nonstandard] —
  `docs/terms.html:62`. Still says saved config is retrieved through the Zoom account and stored
  encrypted tied to it — contradicts session-only + the new Privacy Policy + AC6 (I fixed only the
  per-person clause in Terms, not the store clauses). **Alternative:** rewrite the responsibilities/
  privacy clauses to session-only, not account-tied, not persisted; keep the aggregate-overlay +
  operational-data disclosures. **Win:** Terms and Privacy describe the same product.
- **③ PII-free logging claims exceed the sink's guarantees** — [one-way · nonstandard] —
  `docs/privacy.html:79` + `server/src/app.js:107`. The policy calls telemetry "the only recorded
  server data," "excludes participant PII," "only errors/diagnostics" — but the server also writes
  `[server] METHOD path` request lines, and `/api/log` serializes any ≤100 KB JSON body verbatim
  (minimization is client-side only). **Alternative:** disclose both request-line + client-diagnostic
  logs; enumerate fields (error text/stack, path, UA); say "minimized, not intentionally populated with
  presenter config" rather than "PII-free"; keep retention/rights language. **Win:** removes a false
  security invariant without expanding code scope.

### IMPORTANT
- **② Live doc inventory still structurally unreconciled** — [two-way · kludgy] —
  `meeting-cost-architecture.svg:3`, `opportunity-cost-rate.md:23`, `roadmap.md:43`. The SVG still
  says names/rates → AES-GCM file on a volume + per-person inputs + participant-count SDK; the
  opportunity-cost note still documents `rateTable`/overrides/`rateStore`/cross-device persistence;
  the roadmap's banner sits over current-state tables still labeling the store/identity/endpoints/scopes
  as verified. **Alternative:** fully rewrite the SVG + opportunity-cost note declaratively around the
  single-rate session model; archive the old persistence roadmap or replace its current-state tables
  (not just a banner). **Win:** one dependable source of truth for marketplace review.

## Decisions (2026-07-13)

Approach pass (base main, HEAD 1fce780) — Thomas: **"fix all three, archive the roadmap."**
- **① Terms still promise the encrypted store (BLOCKER)** → **FIX.** Reconcile `docs/terms.html`'s
  store/account clauses to session-only (not account-tied, not persisted); keep the aggregate-overlay +
  operational-data disclosures.
- **② Live doc inventory unreconciled (IMPORTANT)** → **FIX.** Fully rewrite the architecture SVG +
  `dev-docs/opportunity-cost-rate.md` to the single-rate session model; **ARCHIVE** `dev-docs/roadmap.md`
  (mark it a historical/superseded planning doc) rather than banner-over-current-state-tables. Re-run a
  repo-wide current-claim scan as the check.
- **③ "PII-free" logging claims over-reach (BLOCKER)** → **FIX.** Narrow `docs/privacy.html`'s
  operational-logging section: disclose both the `[server] METHOD path` request lines AND the
  client-diagnostic sink; enumerate intended fields (error text/stack, path, user agent); say "minimized,
  not intentionally populated with presenter config" rather than "PII-free"; keep retention/access/rights
  language. (This is the privacy copy Thomas ratifies at re-review — Open Q2.)

Correctness pass: **NOT run this round** — approach fixes approved, so the branch re-enters `/review`
(fresh approach pass) after the fixes land.

## Fixes (2026-07-13)

Applied the three approved approach-review fixes (all doc-only; server code unchanged):
- **① Terms store claims (BLOCKER)** → removed the "your Zoom account, through which your saved
  configuration is retrieved" responsibility bullet; rewrote the Privacy clause to session-only (not
  saved on our servers, not tied to the Zoom account).
- **② Doc reconciliation completed + roadmap archived (IMPORTANT)** → rewrote the architecture SVG
  `<desc>` + the "participant count" SDK bullet to the single-rate session model; rewrote
  `opportunity-cost-rate.md`'s code-mapping (only `simpleAverageRate` remains — `rateTable`/`defaultRate`/
  `overrides`/`multiplier` gone) and its "what never leaves" bullet to session-only; **renamed
  `roadmap.md` → `roadmap-archive.md`** with an ARCHIVED/SUPERSEDED header, and updated its 5 inbound
  references (BACKLOG + 3 dev docs).
- **③ privacy.html logging over-claim (BLOCKER)** → the operational-logging + data-retention +
  server-stores sections now disclose BOTH the `[server] METHOD path` request lines and the `/api/log`
  client-diagnostic sink, enumerate the intended fields (error text/stack, path, user agent), and say
  logs are "minimized at the source / not intentionally populated with your figures" rather than
  guaranteeing PII-free.

## Codex approach review (2026-07-13, base main, HEAD bfdee75) — round 2

**Verdict:** NOT merge-ready. The Terms rewrite, opportunity-cost note, roadmap archive, and
privacy.html logging qualification are **genuinely resolved** — but the reconciled live docs remain
internally inconsistent in three more spots. Server deletion shape sound; no dependency change.

### BLOCKER
- **① `docs/security.html` still promises the encrypted store** — [one-way · nonstandard]. The public,
  nav-linked Security page (54–70) still says config is AES-256-GCM encrypted under a per-user
  Zoom-account key, retained until deletion. **I missed this page entirely.** **Alternative:** rewrite
  its data-handling + retention to session-only; keep the TLS/headers/OAuth/logging disclosures.
  **Win:** every marketplace page describes the same product.
- **③ "PII-free" logging guarantees remain outside privacy.html** — [one-way · nonstandard]. `README.md:43`
  still calls logs "PII-free" / "no names or rates"; the data-retention + security policies still say
  "exclude participant PII" / "no arbitrary payloads." These conflict with the unchanged `/api/log`
  sink (accepts any ≤100 KB body) and the now-qualified privacy.html. **Alternative:** propagate
  privacy.html's qualified wording (intended fields, source minimization, the sink records the
  submitted body, no categorical PII-free/no-arbitrary-payload) across README + the policies.
  **Win:** one truthful logging posture everywhere.

### IMPORTANT
- **② Architecture SVG's visible model + legend still stale** — [two-way · kludgy]. I updated the SVG
  `<desc>` + one SDK bullet, but the visible side-panel box still says the presenter sets each
  person's rate (per-person) and the legend (~line 101) still says names/values are encrypted + stored
  on the server. **Alternative:** update the visible box copy + legend, not only the metadata.
  **Win:** the diagram becomes a dependable review artifact.

## Decisions (2026-07-13) — round 2

Approach pass round 2 (base main, HEAD bfdee75) — Thomas: **"fix all three, run the comprehensive scan."**
- **① `docs/security.html` store/retention claim (BLOCKER)** → **FIX.** Reconcile the public Security
  page's data-handling + retention to session-only (no server store, no per-account encryption); keep
  the TLS/headers/OAuth/logging disclosures.
- **② SVG visible box + legend (IMPORTANT)** → **FIX.** Update the drawn side-panel box (per-person →
  single rate × manual attendee count) and the legend (encrypted server storage → session-only, no
  server store).
- **③ Logging over-claim outside privacy.html (BLOCKER)** → **FIX.** Propagate privacy.html's qualified
  wording to `README.md` + `dev-docs/policies/data-retention-and-protection.md` +
  `dev-docs/policies/security-policy.md` (+ any other doc): disclose the intended fields + source
  minimization + that the sink records the submitted body; drop categorical "PII-free" / "no arbitrary
  payloads."
- **Comprehensive scan** → run an **exhaustive** claim scan (full vocabulary) across `docs/*.html` +
  `dev-docs/policies/*` + `README.md` + the SVG; fix every remaining hit in one pass.

Correctness pass: **NOT run this round** — approach fixes approved → the branch re-enters `/review`.

## Fixes (2026-07-13) — round 2

Applied the three approved round-2 approach fixes + the comprehensive scan (all doc-only):
- **① `docs/security.html`** → rewrote the data-handling + retention sections to session-only (no
  server store, no per-account encryption); kept the TLS/headers/OAuth/logging disclosures; bumped the
  effective date to 13 July 2026.
- **② architecture SVG** → the visible side-panel box now reads "manual attendee count × one rate
  (session-only)"; the legend's navy entry now describes OAuth install + session-only config (was
  "Individual config … encrypted, stored on our server").
- **③ logging over-claim propagated** → `README.md`, `data-retention-and-protection.md`, and
  `security-policy.md` now disclose **both** the `[server] METHOD path` request lines and the `/api/log`
  client diagnostics, enumerate the fields (error text/stack, path, user agent), and say logs are "not
  intentionally populated with your figures" rather than "PII-free / no arbitrary payloads."
- **Comprehensive scan** → also caught + fixed `docs/index.html`'s two card descriptions ("stored and
  encrypted" → session-only). Final full-vocabulary scan across all public pages + policies + README +
  the SVG shows only intentional "no/never/session-only" mentions.

## Codex approach review (2026-07-13, base main, HEAD 8778221)

Round 3 — re-run of the approach pass on the round-2-reconciled docs (fresh review following the accepted round-2 redesign). Server teardown + dependency shape confirmed sound again; all three findings are **doc-consistency** gaps the round-1/2 scans didn't reach.

**Verdict:** *NOT merge-ready. The server teardown and dependency shape are sound, but the reconciled documentation is still neither internally consistent nor complete: a public architecture asset describes the removed model, categorical logging guarantees remain, and a live backlog still instructs future work to reuse deleted storage machinery.*

### BLOCKER (one-way · nonstandard) — Published architecture copy bypasses the canonical fix
- **Locus:** `docs/meeting-cost-architecture.svg:40` (per-person model) + `:101` ("encrypted, stored on our server").
- **Claim:** There are **two copies** of the diagram. The round-2 SVG fix updated only `dev-docs/meeting-cost-architecture.svg`; the `docs/` copy — a **public** GitHub-Pages asset (tracked now; became reachable-by-URL on merge) — still says the presenter sets *each person's* rate and that names + values are encrypted and stored on our server. Two copies have already drifted; the public one directly violates the session-only spec.
- **Verified:** confirmed in the working tree; the `docs/` copy is referenced by no page (orphan URL), the `dev-docs/` copy carries the approved wording.
- **Alternative + win:** Eliminate the duplication rather than hand-syncing a second copy — delete the orphan `docs/` copy (nothing links it, `dev-docs/` is canonical), **or** if a public diagram is wanted, replace it with the fixed canonical and single-source it. Removes two false public claims and kills the drift permanently.

### BLOCKER (one-way · nonstandard) — Categorical logging guarantees still exceed `/api/log`
- **Locus:** `README.md:121` ("a PII-free client-diagnostics sink"); `dev-docs/policies/ssdlc.md:51` ("no secrets, no presenter figures"); residual absolute "never contain secrets" in `data-retention-and-protection.md:42` + `security-policy.md:25`.
- **Claim:** README:121 + ssdlc:51 were **missed entirely** by the round-2 pass; both still give a categorical PII-free / no-figures guarantee. The unchanged `/api/log` sink serializes any submitted JSON body ≤100 KB, so these contradict the implementation and the qualified wording already present elsewhere in the same README and the Privacy Policy. The two policies' trailing absolute "never contain secrets" is the same over-claim in miniature.
- **Verified:** confirmed — README line 122 and ssdlc lines 50–52 read as quoted.
- **Alternative + win:** One canonical logging statement everywhere (request-line logging + a body-recording client sink; client reports minimized at the source; the server does **not** enforce a PII/secret-free schema — logs are "not intentionally populated" rather than guaranteed free). Secondary docs link to it instead of restating a stronger invariant. Eliminates the remaining false security claims and the drift.

### IMPORTANT (two-way · kludgy) — The active product backlog still plans around deleted machinery
- **Locus:** `reviews/backlog.md:6` (names archived `roadmap.md` as "authoritative") + the "Zoom deauthorization" section (lines 12–33).
- **Claim:** The tactical backlog still points at `dev-docs/roadmap.md` (now archived to `roadmap-archive.md`) as the authoritative ordered inventory, and its deauth item says to reuse the **deleted** `userData.purgeUser`, map identity through the removed **app-context / rate-store `uid`** key, and wait for **"the store being turned on."** This conflicts with the canonical OPS-3 no-op-purge design in `BACKLOG.md` and could cause the follow-up story to resurrect the removed architecture.
- **Verified:** confirmed — `reviews/backlog.md` lines 6, 17, 19, 25–27, 31–33 read as described; `BACKLOG.md` OPS-3 is already the correct no-op framing.
- **Alternative + win:** Make `BACKLOG.md`'s OPS-3 the sole current definition — replace `reviews/backlog.md`'s obsolete deauth design notes with a short pointer to OPS-3 (or clearly mark them superseded), and fix the roadmap reference to `roadmap-archive.md` without calling it authoritative. Removes a broken planning authority so the marketplace follow-up isn't framed against deleted modules.

## Decisions (2026-07-13) — round 3

All three approach findings **approved to FIX** (Thomas: *"fix all three, fold in the orphan svg as I created it on purpose"*).

- **① Public SVG copy — FIX (in place, not delete).** The `docs/meeting-cost-architecture.svg` orphan is an **intentional** public asset (Thomas created it on purpose), so reconcile it in place to the session-only / single-rate model — bring its visible side-panel box (L40) and legend (L101) into line with the canonical `dev-docs/` copy. (Two copies still risk drift; keeping both is Thomas's call — the durable single-source cleanup is not taken now.)
- **② Logging over-claims — FIX.** Bring `README.md:121` ("PII-free client-diagnostics sink") and `ssdlc.md:51` ("no secrets, no presenter figures") in line with the qualified `/api/log` posture; soften the residual absolute "never contain secrets" in the two policies to the "not intentionally populated" framing.
- **③ Stale product backlog — FIX.** Point `reviews/backlog.md`'s deauth section at the canonical OPS-3 no-op design (drop the deleted `userData.purgeUser` / app-context-`uid` / "store turned on" plan) and fix its roadmap reference to `roadmap-archive.md` (not "authoritative `roadmap.md`").

Correctness pass: **NOT run this round** — approach fixes approved → the branch re-enters `/review` after `/close` applies them. No merge offered at the `/close` fork (re-review only).

## Fixes (2026-07-13) — round 3

Applied the three approved round-3 approach fixes + the scoped full-vocabulary scan (all doc-only; server code unchanged/blessed). Gate green (client 157 + server 25 + secret-scan 14; build ok).

- **① Public SVG copy — reconciled in place (kept, intentional public asset).** `docs/meeting-cost-architecture.svg` synced byte-for-byte to the canonical `dev-docs/` copy: side-panel box now reads "manual attendee count × one hourly rate (session-only)" (was "each person's hourly opportunity cost"); legend now "OAuth install … session-only … nothing is stored on our server" (was "Individual config (names + values) — encrypted, stored on our server"). `diff` confirms identical; XML well-formed.
- **② Logging over-claims — qualified consistently.** `README.md:121` "a PII-free client-diagnostics sink" → "a client-diagnostics sink — see the config/privacy note above for what it records"; `ssdlc.md` "no secrets, no presenter figures" → "minimized at the source, not intentionally populated with secrets or presenter figures"; the residual absolute "they never contain secrets" in `data-retention-and-protection.md` + `security-policy.md` → folded into "not intentionally populated with **secrets**, the presenter's figures, or participant data."
- **③ Stale product backlog — reconciled to canonical OPS-3.** `reviews/backlog.md`: the roadmap pointer now names the **archived** `roadmap-archive.md` (dropped "authoritative `roadmap.md`"); the "Zoom deauthorization" section now leads with "Canonical tracking: BACKLOG.md → OPS-3," states the purge is a **no-op** post-removal, and drops the deleted `userData.purgeUser` primitive, the app-context/rate-store `uid` key mapping, and "the store being turned on."
- **Scan-caught extras (same rate-store reconciliation).** The full-vocabulary scan surfaced two dev-docs test guides still listing `getAppContext` as a required Marketplace capability "mirroring `config()`" — but the client's `ZOOM_CAPABILITIES` no longer includes it (test asserts `not.toContain('getAppContext')`) and the rate store that needed it is gone. Fixed `overlay-live-test-guide.md` ("plus `getAppContext` (needed by the rate store / identity)" → "plus `getUserContext` (the presenter's own participantUUID for the base-video layer)") and `overlay-live-test-matrix.md` (dropped the wrong "(incl. `getAppContext`)" parenthetical). Final scan: every remaining vocabulary hit is an intentional negation ("nothing to encrypt", "no per-person rate table"), a "removed / since removed" history note, or points to `roadmap-archive.md`.

Correctness pass: **NOT run this round** — approach fixes approved → the branch re-enters `/review` (approach pass re-runs on the reconciled docs). No merge at the `/close` fork.

## Build note (2026-07-13) — round 4 (re-review after round-3 redesign)

Doc-only reconciliation round; server teardown unchanged/blessed. AC→file map for this round's changes (full detail in `## Fixes (2026-07-13) — round 3`):
- **AC "docs reconciled to session-only"** → `docs/meeting-cost-architecture.svg` (synced to canonical `dev-docs/` copy), `README.md`, `dev-docs/policies/{ssdlc,data-retention-and-protection,security-policy}.md` (logging claims qualified), `reviews/backlog.md` (deauth → OPS-3; roadmap → archive), `dev-docs/overlay-live-test-{guide,matrix}.md` (stale `getAppContext` capability refs removed).

## Codex approach review (2026-07-13, base main, HEAD 7e206ad)

Round 4 — re-run after the accepted round-3 redesign. Server teardown + dependency shape sound again; the two architecture SVGs confirmed byte-identical. Two remaining findings, both the same doc-honesty theme, now at its last residuals.

**Verdict:** *NOT merge-ready. The server teardown and dependency shape remain sound, and the two architecture SVGs are byte-identical. However, the synchronized diagram still overstates the server's no-data guarantee, and several live documents retain current-sounding persistence/app-context language.*

### BLOCKER (one-way · nonstandard) — Synchronized SVGs still overclaim server data handling
- **Locus:** `docs/meeting-cost-architecture.svg:69` + `:101`; identical in `dev-docs/meeting-cost-architecture.svg`.
- **Claim:** Both now-identical diagrams say the server "Stores no user data" (L69) and "nothing is stored on our server" (L101) — categorical, while the unchanged `/api/log` records arbitrary submitted JSON ≤100 KB and Railway retains those logs. This is the last artifact that contradicts the qualified logging posture now in Privacy / README / policies.
- **Verified:** confirmed — L69 `(OAuth). Stores no user data.`; L101 legend `… nothing is stored on our server.`
- **Alternative + win:** State the narrow invariant — "stores no presenter configuration, rates, names, or meeting history" — and either acknowledge operational request/diagnostic logs or link the diagram to the Privacy Policy. Removes two categorical public/security claims in both copies while keeping them byte-identical; no code change.

### IMPORTANT (two-way · kludgy) — Live docs retain persistence / deleted-app-context language
- **Locus:** `README.md:23` ("saved settings"); `docs/documentation.html:68` ("saved figures … work regardless"); `dev-docs/policies/incident-response.md:11` ("exposure of stored configuration" as an incident example); `dev-docs/policies/security-policy.md:17` ("Zoom OAuth tokens / app context").
- **Claim:** Four residual references imply the product still saves settings/config or still has the deleted app-context identity path. These are live, current-facing docs (not the archived roadmap or historical review records).
- **Verified:** all four confirmed in the working tree.
- **Alternative + win:** "saved settings/figures" → "side-panel controls" (or "session-only settings"); incident example → operational logs / credentials; drop "app context" from the current data classification (keep OAuth-token handling). Removes four references that could make a reader infer persistence or deleted identity machinery still exists.

## Decisions (2026-07-13) — round 4

Both approach findings **approved to FIX** (Thomas: *"fix both then re-review"*).

- **① SVG categorical storage claim — FIX.** Reword both byte-identical copies to the narrow invariant: the server stores no presenter configuration, rates, names, or meeting history — and acknowledge the operational request/diagnostic logs (or point at the Privacy Policy) so the diagram matches the qualified posture everywhere else. Edit the canonical `dev-docs/` copy, then re-sync `docs/` byte-identical.
- **② 4 residual persistence / app-context phrasings — FIX.** `README.md:23` "saved settings" → session-only/side-panel controls; `docs/documentation.html:68` "saved figures … work regardless" → side-panel controls; `dev-docs/policies/incident-response.md:11` "exposure of stored configuration" → operational logs / credentials; `dev-docs/policies/security-policy.md:17` "Zoom OAuth tokens / app context" → drop "app context" (keep OAuth-token handling).

Correctness pass: **NOT run this round** — approach fixes approved → the branch re-enters `/review` after `/close`. No merge offered at the `/close` fork (re-review only).

## Fixes (2026-07-13) — round 4

Applied the two approved round-4 approach fixes + one scan-caught extension (all doc-only; server code unchanged/blessed). Gate green (client 157 + server 25 + secret-scan 14; build ok).

- **① SVG categorical storage claim — narrowed (both copies).** `dev-docs/meeting-cost-architecture.svg`: server box "(OAuth). Stores no user data." → "(OAuth). No presenter data stored."; legend "…nothing is stored on our server." → "…used only to install/authenticate; the presenter's config stays session-only in the browser and is never stored on our server." Re-`cp`'d to `docs/meeting-cost-architecture.svg` — `diff` empty, XML well-formed. No unqualified "stores nothing / no user data" claim remains.
- **② Four residual phrasings — corrected.** `README.md` "the side panel, saved settings" → "session-only settings"; `docs/documentation.html` "your saved figures work regardless" → "the figures you enter work regardless"; `dev-docs/policies/incident-response.md` "exposure of stored configuration" → "exposure of operational logs"; `dev-docs/policies/security-policy.md` "Zoom OAuth tokens / app context" → "Zoom OAuth tokens" (dropped the deleted app-context path; OAuth-token handling kept).
- **Scan-caught extension (same fix-① class).** `docs/documentation.html` "My settings didn't save" FAQ said "Nothing is stored on our server or tied to your Zoom account" — the same bare categorical phrasing as the SVG legend. Tightened to "None of it is stored on our server…" (scoped to the settings/figures the FAQ is about). Final scan: the only remaining categorical hit is `incident-response.md:35` "the app persists no user data, so there is no stored-data encryption key to rotate" — an accurate negation about the absent data store, not a logging over-claim.

Correctness pass: **NOT run this round** — approach fixes approved → the branch re-enters `/review` (approach pass re-runs on the reconciled docs). No merge at the `/close` fork.

## Build note (2026-07-13) — round 5 (re-review after round-4 redesign)

Doc-only reconciliation; server teardown unchanged/blessed. AC→file map for round-4 changes (detail in `## Fixes (2026-07-13) — round 4`):
- **AC "docs reconciled to session-only"** → `dev-docs/meeting-cost-architecture.svg` + `docs/meeting-cost-architecture.svg` (categorical storage claim → presenter-data-scoped, kept byte-identical), `README.md` ("saved settings" → "session-only settings"), `docs/documentation.html` ("saved figures" → "figures you enter"; FAQ "Nothing is stored" → "None of it is stored"), `dev-docs/policies/incident-response.md` ("stored configuration" → "operational logs"), `dev-docs/policies/security-policy.md` (dropped "/ app context").

## Codex approach review (2026-07-13, base main, HEAD 27f1fa0)

Round 5 — re-run after the accepted round-4 redesign. Verdict: shape sound; manifests unchanged; deleted machinery not presented as current; SVG copies byte-identical. **One** finding remains — the last categorical storage claim.

**Verdict:** *The server teardown and overall documentation shape are sound; manifests are unchanged, deleted machinery is not presented as current, and the SVG copies are byte-identical. One categorical storage claim remains, so the doc set is not yet fully reconciled.*

### BLOCKER (one-way · nonstandard) — Incident policy still categorically claims no user data is persisted
- **Locus:** `dev-docs/policies/incident-response.md:35`.
- **Claim:** "The app persists no user data" is unqualified and conflicts with the unchanged `/api/log` sink + Railway retention. **Now internally contradictory:** the round-4 edit made the same policy's incident example "exposure of operational logs," so the policy recognizes retained log data exists while line 35 categorically denies persisted user data.
- **Verified:** confirmed — line 35 reads "…The app persists no user data, so there is no stored-data encryption key to rotate." (Note: this is the line I judged an "accurate persistence negation" in round 4 and left; the reviewer's internal-contradiction argument is correct and was sharpened by my own round-4 "operational logs" edit two lines above.)
- **Alternative + win:** Scope it to the removed store — "The app persists no presenter configuration or per-user record, so there is no presenter-data encryption key to rotate." Eliminates the final unqualified no-user-data guarantee while keeping the accurate reason no rate-store key exists.
