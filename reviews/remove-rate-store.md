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
