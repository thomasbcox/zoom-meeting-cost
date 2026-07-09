# Meeting Cost — Production Roadmap (free + paid tiers)

Status: **draft** · Created 2026-06-10 · Owner: Thomas

A living strategic roadmap for turning Meeting Cost from a prototype into a production
Zoom App with free and paid tiers. Tactical, per-feature work is tracked in
[`reviews/backlog.md`](../reviews/backlog.md); this file is the strategy above it.

> **Terminology.** Throughout this repo, "rate" means each person's hourly **opportunity
> cost** (value of their best alternative work), not pay. The identifier name is historical;
> the canonical definition is [`opportunity-cost-rate.md`](opportunity-cost-rate.md).

> **Legend.** ✅ **verified from repo** (grounded in current code/commits) ·
> 🔜 **recommended next step** (proposal, not yet built or not yet confirmed) ·
> ⚠️ **needs external verification** (Zoom/Stripe docs, must confirm before committing).

> **⚠️ Reconciliation with the source note.** This roadmap was requested from a planning
> note that assumes a *pre-backend* state ("localStorage may not be durable," "move durable
> settings to backend," "identify users via app-context uid," "encrypt sensitive data").
> **Much of that Phase-1 work shipped on 2026-06-10** (`merge: server-rate-store`,
> `a9e4cc2`) — see [`reviews/server-rate-store.md`](../reviews/server-rate-store.md). The
> note is preserved as the origin of this plan, but where it conflicts with shipped code,
> **the code is authoritative** and is marked ✅ below. No existing roadmap/billing file
> was overwritten (none existed).

---

## Executive summary

Meeting Cost is an in-meeting Zoom App: a presenter prices their participants from a
**private rate table** and a live cost meter composites onto their camera feed; only
**aggregate** cost (total, per-second, attendee count) is ever shown to attendees — never
names or individual rates (✅ verified). The prototype is functionally complete for a
single presenter, and as of 2026-06-10 the **persistence foundation is built**: a
per-presenter rate config is stored **server-side, encrypted at rest**, keyed to the
presenter's stable Zoom identity.

> **✅ Live-render risk — RESOLVED BY DECISION (2026-07-01, Thomas): set a minimum supported
> client version, warn, and move on.** Background: an active Zoom regression — **ZSEE-195647** —
> makes `runRenderingContext({view:'camera'})` + `drawWebView()` resolve `ok:true` but render
> **nothing** on the camera feed on **Zoom Workplace 6.7.8 / 7.0.2** (devforum thread 143155). Our
> overlay is entirely `drawWebView`-based and logs success even when blank. **Decision:** the overlay
> is confirmed working across weeks of real meetings on current builds, so rather than run a
> client-version test matrix or build a `drawImage` fallback, we **accept the risk on old builds**
> and declare a **supported floor of Zoom Workplace 7.1.0+** (the first GA above the affected 7.0.2;
> note: "above the bug," not a documented fix of ZSEE-195647). This is **documented as a user-facing
> requirement/warning** — `README.md`, `docs/documentation.html` (Requirements + Troubleshooting),
> `docs/support.html` (FAQ). **The overlay live-test matrix + `drawImage` fallback are therefore
> DROPPED** (the matrix/guide are kept as reference only). This removes the old 🎯 keystone gate from
> the critical path.

> **Research note (2026-06-11).** The ⚠️ external unknowns this roadmap flagged
> (Zoom monetization, billing/MoR, Marketplace review, data-compliance, camera-API config)
> were researched on 2026-06-11 and the answers folded into the phases below — see also
> memory `reference-zoom-prod-unknowns-research`.

> **🔄 Reconciliation refresh (2026-06-26, `roadmap-resequence`).** Work shipped after the
> 2026-06-11 draft that this file now reflects: **data delete/export backend** —
> `DELETE /api/me/data` + `GET /api/me/export` + a neutral `uid` registry and the
> `userData.purgeUser(uid)` primitive ([`reviews/data-delete-export.md`](../reviews/data-delete-export.md),
> PR #52); **loaded-cost multiplier removed** from the cost math/UI/schema (PR #49); plus
> `/api/log` redaction-at-source (PR #50), the header-test order fix (PR #51), and Railway
> PID-1 graceful shutdown (merge `2b0954a`). The **Current state** table and Phase 1 below are
> updated for these; the authoritative *ordering* of all remaining work now lives in the new
> **[Execution plan](#execution-plan-orderly-development)** section, which supersedes the old
> one-line "Rough sequence." Tactical per-item detail stays in
> [`reviews/backlog.md`](../reviews/backlog.md).

The path to a paid product is therefore **mostly product + commerce work, not core
re-architecture**:

1. **Turn the shipped persistence on** (config steps + delete/export for privacy).
2. **Attendee harvesting + private-rule UX** (the highest-value paid hook; the matching/
   dedupe primitives already exist).
3. **One Zoom app, backend entitlements** (free vs Pro), enforced server-side.
4. **Billing — launch US-only first** (decided 2026-06-11), which makes **Zoom-native
   monetization** (US-only, in-Zoom purchase, no tax/MoR burden) the lowest-friction MVP
   default, with a **Merchant of Record** (Paddle / Stripe Managed Payments) as the path
   when we expand globally. Webhook-driven entitlements, backend as source of truth, either
   way; design provider-agnostically so the switch is a swap.
5. **Paid advanced features** (CSV, history, templates, team libraries) — most need **no
   new Zoom scopes**.
6. **Marketplace hardening + privacy review** for production listing — incl. the
   **mandatory Zoom deauthorization / data-compliance endpoint**.

**Recommended MVP for first paid launch** is at the end of this document.

---

## Current state — verified from repo

| Area | Status | Evidence |
|------|--------|----------|
| Cost meter + overlay | ✅ shipped · min-version 7.1.0+ | camera Layers API; `buildOverlayState` emits aggregates only (`status, totalCost, costPerSecond, elapsedSeconds, attendees, currency, prefs:{}`). `drawWebView` may no-op on Zoom Workplace 6.7.8/7.0.2 (ZSEE-195647) → **accepted risk on clients < 7.1.0**, documented as a min-version requirement (see live-render callout above); no matrix |
| Overlay data channel (panel→camera) | ✅ verified live 1:1 (prior build) | `postMessage`→`onMessage` matches the canonical sample; **verified live 1:1** (panel `postMessage ok` ↔ camera `overlay-message`, per-second) at PR #17 (`overlay-payload-parse`, `overlay-logging-quiet`). Rendering on old builds is **accepted risk** (min-version 7.1.0+; matrix dropped), not a channel issue |
| **Privacy invariant** | ✅ holds | overlay payload carries **no** names/rates/aliases; `prefs:{}` "never carries private data" (`lib/overlayState.js`) |
| Cost models | ✅ shipped · 🔄 2026-07-09 | **Simple `N × averageRate` is the default for everyone** and boots every session; **per-participant** table is a **host/co-host-only** opt-in — non-hosts are Simple-locked, gated by `getUserContext().role` (`lib/role.js`, `simple-default-role-gate`). Simple's attendee count is an empty prompt when the participant list is unavailable. The loaded-cost **multiplier was removed** (PR #49); legacy blobs round-trip and the field is ignored |
| Matching / dedupe primitives | ✅ shipped | `lib/normalize.js`, `lib/matching.js` (`buildRateIndex`, `buildAliasIndex`, `resolveAll`); rate rules + aliases + per-meeting overrides |
| Session lifecycle | ✅ shipped | start / pause / resume / end + start-new / resume (`session-restart-controls`) |
| Overlay auto-recover | ✅ shipped | polls `getVideoState` on camera off→on (`overlay-rearm-reopen`) |
| **Server persistence** | ✅ shipped (inert until configured) | encrypted store + endpoints (`server-rate-store`, `a9e4cc2`) |
| Identity | ✅ shipped | Zoom **app-context `uid`** decrypted server-side; fail-closed `aud`/`iss`/`exp` (`server/src/zoom/appContext.js`) |
| Encryption at rest | ✅ shipped | AES-256-GCM, per-user key `HKDF(RATE_STORE_KEY, salt=uid)` (`server/src/store/rateCrypto.js`) |
| `localStorage` | ✅ removed | server is the only persistence; session-only fallback if unreachable |
| OAuth | partial | `/auth/callback` exchanges a code but is **not** used for identity (app-context is); scaffold only |
| Billing / entitlements | ❌ none | no plan, no code |
| Attendee harvesting | ❌ none | designed in backlog, not built |
| Data delete / export | ✅ backend shipped (UI pending) · 🔄 2026-06-26 | `DELETE /api/me/data` (purge) + `GET /api/me/export` (JSON download) + `userData.purgeUser(uid)` over a neutral `uid` registry (`data-delete-export`, PR #52). **Presenter-facing UI not yet built** and `docs/privacy.html` still routes deletion via email — see Phase 1 / backlog |

**Zoom config in use** (✅ from `server/zoom-app-config.md` + `ZOOM_CAPABILITIES`):
- **SDK capabilities:** `getRunningContext`, `getAppContext`, `getMeetingContext`,
  `getMeetingParticipants`, `getUserContext`, `onParticipantChange`,
  `runRenderingContext`, `drawWebView`, `clearWebView`, `closeRenderingContext`,
  `drawParticipant`, `onMyMediaChange`, `getVideoState`, `postMessage`, `onMessage`.
- **OAuth scopes:** `zoomapp:inmeeting`, `meeting:read:participant` (or the in-client
  `getMeetingParticipants` capability), `user:read:email` *(optional, unused today)*.

**Not-yet-live config** the shipped store needs (🔜 operator steps): add `getAppContext`
under Marketplace → Add APIs; attach a Railway **Volume** + set `DATA_DIR`; set
`RATE_STORE_KEY`.

---

## Phased roadmap

### Phase 0 — Verify architecture, identity, existing plans  ✅ (this document)

- **Goal:** ground the plan in reality before building. **Done by this file.**
- **Findings:** persistence + identity + encryption shipped; privacy invariant holds;
  no prior roadmap/billing plan; matching/dedupe primitives exist.
- **Open questions resolved:** identity source = app-context `uid` (✅, not OAuth).
- **AC:** ✅ this roadmap exists, marks verified vs recommended, and reconciles the note.

### Phase 1 — Backend persistence foundation  (✅ mostly shipped; finish privacy controls)

- **Goal:** durable, private, per-user settings/rate rules.
- **Shipped (✅):** encrypted server store keyed by `uid`; `GET/PUT /api/rates`; client
  load-on-boot / debounced save; `localStorage` removed; fail-closed identity + body
  validation.
- **Remaining tasks (🔜):**
  - **Operator config:** add `getAppContext` (dashboard), attach Volume + `DATA_DIR`,
    set `RATE_STORE_KEY` → then verify live persistence (AC8 of `server-rate-store`).
  - **Privacy controls — backend ✅ (2026-06-26), UI 🔜:** `DELETE /api/me/data` (purge) and
    `GET /api/me/export` (export as JSON) shipped, both `uid`-scoped via the neutral registry +
    `userData.purgeUser` (`data-delete-export`, PR #52). **Remaining:** the presenter-facing
    delete/export **UI** and flipping `docs/privacy.html` from "email us" to **self-serve**
    (gate the policy wording to ship with the UI so the claim stays true) — backlog item
    *"Client UI for data delete / export"*. The `purgeUser(uid)` primitive is reused by the
    deauth webhook below.
  - **⚠️ Mandatory Zoom deauthorization / data-compliance endpoint (new, researched
    2026-06-11):** published apps that store per-user data MUST handle Zoom's
    deauthorization event. On uninstall Zoom POSTs `user_data_retention`; if `false` you
    must **delete that `uid`'s data within 10 days** and POST confirmation to
    `/oauth/data/compliance`. This is a *Zoom-required* webhook, distinct from the
    user-facing DELETE above, and is a **hard publishing gate** (Phase 6).
    **Scope (Codex review, 2026-06-11): delete ALL `uid`-scoped data, not just `/api/rates`.**
    Today that's the rate blob, but as entitlements, subscriptions, aliases, and
    meeting-summary records arrive (Phases 3–5) both the deauth and user-delete paths must
    purge *every* store keyed to that `uid` — design them as one "delete everything for this
    uid" operation so new stores can't silently escape it.
    (developers.zoom.us/docs/api/rest/data-compliance/)
  - **Backend data model** (currently a single encrypted blob per `uid`). Propose
    splitting as features grow (see *Data models* below) but **don't migrate yet** — the
    blob is fine until entitlements/history arrive.
- **Data/API changes:** delete/export endpoints **shipped** (`/api/me/data`, `/api/me/export`,
  PR #52); keep the blob store. Remaining changes are the **deauth webhook** endpoint and the
  delete/export **UI** + privacy-page wording — not new rate-data endpoints.
- **Risks / open questions:** ⚠️ encryption is *at rest only* — the operator can decrypt
  (documented). Revisit (KMS-managed key, or per-user passphrase) only if a stronger
  posture is required for enterprise. Single-instance volume = no HA (acceptable for now).
- **AC:** a presenter can delete and export their data; live persistence verified in Zoom;
  the on-volume file is ciphertext.

### Phase 2 — Attendee harvesting + private-rule UX  🔜 (primitives ✅)

- **Goal:** grow the private rate table from the people you actually meet, without
  duplicates, keeping everything private.
- **Tasks:**
  - **Opt-in "Add unmatched attendees to private rate rules"** — a manual button (not
    auto-add) that pulls current participants whose normalized name isn't already a rule
    or alias. **Dedupe via the existing `normalize`/`matching` primitives** (✅ exist).
  - **"Save override as rule"** — promote a current-meeting manual override into a
    persistent rule.
  - **Seeding:** new harvested rows seed from the **default rate** unless a manual
    override exists (then use the override's value).
  - **Privacy:** names/rates stay private; the overlay still receives only aggregates
    (✅ invariant unchanged — harvesting touches only the private table).
  - **⚠️ Third-party PII (open question raised by Codex review, 2026-06-11).** The overlay
    "aggregate-only" invariant is about what *attendees see* — but harvesting persists
    **other participants' names server-side**, i.e. personal data about third parties who
    never installed the app, attached to estimated rates. That is a materially different
    privacy/consent posture than "the presenter's own settings": it implicates legal basis
    (GDPR/CCPA), the presenter's responsibility as the one storing it, and what the privacy
    policy must disclose. **Decide before building harvesting:** is storing harvested
    attendee names acceptable, and under what disclosure? Options to weigh — store only a
    presenter-entered label/alias rather than the raw Zoom display name; keep harvested rows
    local/session-only unless the presenter explicitly saves; or document presenter
    responsibility in the privacy policy. This is independent of the overlay invariant.
- **Data/API changes:** none beyond Phase 1 (`PUT /api/rates` persists the grown table).
  A pure `selectHarvestableNames(participants, config)` helper (testable, no jsdom).
- **Risks / open questions:** name collisions (two attendees, same normalized name →
  add once); should harvest include overridden attendees (proposed: yes, seeded at
  default). UX clutter → manual/opt-in mitigates.
- **AC:** clicking harvest adds exactly the unmatched names (deduped), seeded at default;
  already-ruled/aliased people are skipped; the grown table persists and auto-matches next
  meeting; overlay payload still aggregate-only.

### Phase 3 — Free vs Pro entitlement model  🔜

- **Goal:** one Zoom app, two tiers, gated by **backend-enforced entitlements**.
- **Tasks:**
  - Backend `entitlements` record per `uid`: `{ plan: 'free'|'pro', features:{…},
    limits:{…}, status, renewsAt }`. Default everyone to `free`.
  - `GET /api/me` returns plan + features + limits on startup; client gates UI from it.
  - **Server enforces limits** (e.g. free = N persistent rules) on `PUT /api/rates` and
    feature endpoints — **frontend gating is UX only**.
  - Tier mapping (proposed, tune later):

  | Capability | Free | Pro |
  |---|---|---|
  | Live overlay + simple mode + session controls | ✅ | ✅ |
  | Persistent private rate rules | limited (e.g. ≤ 10) | unlimited |
  | Aliases | limited | unlimited |
  | Cross-device rate library | basic | ✅ |
  | One-click attendee harvesting | — | ✅ |
  | Save override as rule | — | ✅ |
  | CSV import/export | — | ✅ |
  | Meeting summaries / history | — | ✅ |
  | Rate templates | — | ✅ |
  | Duplicate detection / alias suggestions | — | ✅ |
  | Data export / delete | ✅ (always — privacy right) | ✅ |
  | Team/admin rate libraries | — | later |
  | Integrations (Slack/Sheets/Notion/webhooks) | — | later (optional) |

- **Data/API changes:** `entitlements` table/record; `GET /api/me`; limit checks in
  write paths.
- **Risks / open questions:** where to draw the free line so it's useful but Pro is
  compelling; grandfathering; abuse (one `uid` ≠ one paying seat necessarily).
- **AC:** a free user hits a clear, server-enforced limit (not just a hidden button); a
  Pro user does not; `GET /api/me` drives the UI; limits can't be bypassed by calling the
  API directly.

### Phase 4 — Billing + webhook entitlements  🔜 / ⚠️

- **Goal:** turn a payment into a Pro entitlement, reliably.
- **Decision (2026-06-11): launch US-only first.** Global-from-day-one is **not** a hard
  requirement, which reopens Zoom-native monetization as a serious option (see below). The
  webhook-driven, backend-as-source-of-truth architecture is identical either way; the only
  real choice is *who processes the payment*.
- **Option A — ✅ Zoom-native monetization (strong fit for a US-only launch).** GA Dec 2024:
  15% Zoom cut, recurring monthly/annual, mandatory free plan, paid ≥ $0.99; Zoom processes
  via Stripe. Constraint — **US-only** (payment holder + buyers US, USD) — is acceptable
  given the launch decision. **Upsides over external billing:** purchase happens in-Zoom
  (no system-browser checkout handoff, see "webview reality" below), **no tax/MoR burden**
  (Zoom is the seller of record for US sales), and lower checkout friction.
  **Downsides:** couples billing to the Zoom listing; 15% > typical MoR blended fee; and a
  later **global** expansion forces a billing migration to Option B.
  ⚠️ **Verify before committing:** research could not confirm that the in-meeting Apps SDK
  *surface* (not just the OAuth side of the app) is an eligible monetization scenario — Zoom
  docs only say "user-managed general app." Confirm with Zoom developer support.
- **Option B — Merchant of Record (the global path).** **Paddle** (simplest) or **Stripe
  Managed Payments** — both are MoR and absorb global VAT/GST/US-nexus liability (plain
  Stripe Billing would make *us* liable; Stripe Tax only calculates). Higher per-txn fee,
  works worldwide, decoupled from the Zoom listing. **This is the path when we expand past
  the US** — keep it in mind so Option A's data model doesn't paint us into a corner.
- **Recommendation:** start on **Option A (Zoom-native)** for the US-only MVP to minimize
  friction and tax surface; design `entitlements`/`subscriptions` provider-agnostically so a
  later switch to Option B for global is a swap, not a rewrite.
- **Shared architecture (both options):**
  - Checkout → subscription; **webhook → update `entitlements`** for the `uid`. Backend is
    the single source of truth; the client only reads `GET /api/me`.
  - For **Option A (Zoom-native):** Zoom maps the purchase to the installing user; entitlement
    state arrives via Zoom's monetization/purchase webhooks (confirm exact events with Zoom).
    Map Zoom's purchase identity to our `uid` (likely the same app-context identity).
  - For **Option B (MoR) — link payment → `uid` server-side:** create the session from the
    context-derived `uid` (never client-sent). Stripe: `client_reference_id` + copy `uid`
    into customer/subscription `metadata`. Paddle: `custom_data` (auto-propagates
    transaction→subscription — cleaner, single field).
  - **Lifecycle (Option B):** Stripe `checkout.session.completed`, `customer.subscription.
    created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`,
    `charge.dispute.created`. Paddle `subscription.created/updated`(catch-all)`/canceled`,
    `transaction.completed/paid`, `adjustment.*`. Signature-verify + dedupe by event id
    (idempotent).
- **⚠️ Webview checkout reality — applies to Option B only:** external hosted checkout opens
  in the **system browser** via `zoomSdk.openUrl` (must allowlist the checkout domain),
  **not** in-frame; 3DS inside an embedded webview is unreliable. So **never grant
  entitlement on the redirect/return** — the **webhook is the source of truth**, and the Zoom
  app **polls `GET /api/me`** after the user returns. Show a "return to Zoom and refresh"
  success page. (Option A's in-Zoom purchase sidesteps this entirely — a point in its favor.)
- **Data/API changes:** `subscriptions` record (provider, customer id, subscription id,
  status, period); webhook endpoint with signature verification; idempotency keys; the
  return-poll path on `GET /api/me`.
- **Risks / open questions:** MoR fee vs control; refunds/chargebacks → downgrade policy;
  Paddle exact retry window (unconfirmed); confirm `invoice.paid` vs `payment_succeeded`
  for our Stripe API version if Stripe is chosen.
- **AC:** completing a purchase flips the user to Pro within seconds **via webhook** (never
  via redirect/client claim); the app reflects it through `GET /api/me` (Option B: the
  returning webview polls after the system-browser checkout); cancellation/failed payment
  downgrades to free at period end; replayed webhooks are idempotent; no client-trusted
  entitlement.

### Phase 5 — Paid advanced features  🔜

- **Goal:** the Pro value stack. **Most need no new Zoom scopes** (✅ they're backend/UI):
  - **CSV import/export** of the rate library (backend transform; no Zoom scope).
  - **Meeting summaries / history** — store per-meeting aggregates (cost, duration,
    attendee count) keyed by `uid` + meeting. ⚠️ Decide what's stored (aggregates only,
    to preserve the privacy posture) and retention.
  - **Rate templates** (named rate sets), **duplicate detection / alias suggestions**
    (built on `normalize`/`matching`), **team/admin rate libraries** (new data model +
    sharing rules; the biggest item — likely its own phase).
  - **Integrations** (Slack/Sheets/Notion/webhooks) — *these* may need their own OAuth/
    tokens (not Zoom scopes) and are optional, post-launch.
- **Data/API changes:** `templates`, `meetingSummaries`, `teams`/`teamMembers` (later).
- **Risks / open questions:** scope creep; team libraries change the privacy model
  (shared rates) → revisit invariant + entitlements; integrations add third-party auth.
- **AC:** each feature is entitlement-gated, server-enforced, and ships without weakening
  the overlay privacy invariant.

### Phase 6 — Production readiness  🔜

> **Split into two (Codex review, 2026-06-11): 6A is a *pre-launch gate*, 6B is *ongoing*.**
> Several items here (deauth endpoint, privacy policy, minimal scopes, checkout allowlist,
> surface config) are **blocking requirements to publish at all** — not post-MVP iteration.
> Don't let the "Phase 6 = last" position read as "do it after launch."

- **✅ Review process (researched 2026-06-11):** public apps go through 3 stages —
  submission/branding, functionality/compliance, and a **Zoom-run security review**
  (OWASP Top 10, web-app scan, **manual vulnerability testing**, dependency-vuln checks;
  load/DoS explicitly out of scope). Zoom runs it against your **technical design doc +
  scope justification** — you don't furnish a third-party pentest, but you must remediate.
  Submission also requires **privacy policy, ToU, support URL, self-serve docs URL**, all
  on allowlisted domains. New apps should use the **Unified Build Flow** (single app, one
  permission set).

#### Phase 6A — Publishing gate (PRE-LAUNCH, blocking)  ⛔

These must be done **before** Marketplace submission / first paid user:

- **⚠️ Deauthorization / data-compliance endpoint (hard gate):** ship the mandatory Zoom
  deauth webhook from Phase 1 (delete **all** `uid`-scoped data within 10 days, POST
  `/oauth/data/compliance`) and set the Deauthorization Notification Endpoint URL in the app
  config. **Cannot publish without this** given we store per-user data.
- **✅ Camera-mode surface config (resolved 2026-07-01):** there is **no** separate "Camera" /
  Meeting Component surface to enable. The Marketplace-config check reduces to a plain checklist:
  camera/Layers capabilities added under **Features → Zoom App SDK** (mirroring `zoomSdk.config()`),
  plus the **Domain Allow List** (app URL + `appssdk.zoom.us` + CDNs); the Surface step just selects
  the *product* (enable Meetings). **No live-test-matrix dependency.** (Detail:
  [`overlay-live-test-guide.md`](overlay-live-test-guide.md) → Pre-flight; memory
  `reference-zoom-prod-unknowns-research`.)
- **Minimal scopes:** request only what's used (✅ today: `zoomapp:inmeeting`,
  `meeting:read:participant`/capability; drop `user:read:email` unless email matching ships).
- **Privacy policy + data-handling doc:** what's stored, where, encryption posture
  (operator-decryptable), retention, deletion/export rights, the deauth-deletion flow, **and
  any harvested third-party attendee names** (Phase 2 open question) — required for review.
- **CSP / checkout allowlist:** `connect-src` pinned (✅); allowlist any Option-B checkout
  domain; verify in-Zoom.
- **Dev vs production credentials:** separate Zoom apps/credentials (client id/secret,
  redirect URIs, **`RATE_STORE_KEY`**). ⚠️ Never share `RATE_STORE_KEY` across environments.
- **AC (6A):** app passes Zoom review with minimal scopes; deauth/data-compliance works
  end-to-end (purges every `uid` store); published privacy policy matches the implementation;
  dev/prod isolated.

#### Phase 6B — Production hardening (ongoing, post-launch)  🔜

- **Production ops:** volume backups, key management/**rotation plan** for `RATE_STORE_KEY`
  (needs a re-encrypt migration — no data loss), monitoring, error reporting.
- **CI / supply chain:** secret scanning (✅ local hook; Part B GitHub toggle pending), CI
  gate (🔜 backlog #3 Part C), the deferred esbuild/Vite bump.
- **Risks / open questions:** Marketplace review timelines; key rotation without data loss;
  privacy-policy completeness as features grow.
- **AC (6B):** backups + a tested key-rotation plan exist; CI gates PRs.

---

## Cross-cutting decisions (challenging the note's assumptions)

- **`localStorage` durability** — ✅ moot: removed; server-backed. Session-only fallback
  remains as graceful degradation, **not** as durable storage.
- **One app vs two** — 🔜 **recommend one Zoom app with backend entitlements.** Free/Pro is
  a billing concern, not a listing concern; two listings double review/maintenance and
  fragment installs. A **second listing is justified only** for: admin-managed enterprise
  distribution, materially different OAuth scopes, or a separate compliance posture
  (e.g. a HIPAA/government variant).
- **Zoom paid entitlements** — ✅ **researched; viable given the US-only-first decision.**
  Zoom-native monetization is GA but **US-only** (buyers + payment holder US, USD). Since we
  chose to launch US-only first, it's the lowest-friction MVP default (in-Zoom purchase, no
  MoR/tax burden); a **Merchant of Record (Paddle / Stripe Managed Payments)** is the global
  path. Backend stays the source of truth via webhooks regardless; keep the data model
  provider-agnostic. ⚠️ Confirm Zoom-native eligibility for the in-meeting SDK surface.
- **Server persistence vs privacy** — ✅ encryption-at-rest **and** the backend delete/export
  endpoints shipped (PR #52); privacy work is **not done**: the delete/export **UI**, the
  privacy-page self-serve wording, the **deauth/data-compliance webhook**, and a retention/deletion
  policy remain (Phase 1 / 6A). The posture is **operator-decryptable**; stronger (KMS/passphrase)
  is a future option for enterprise.
- **Paid features needing new scopes** — ✅ mostly **no**: unlimited rules, harvest, CSV,
  templates, history (aggregate) are backend/UI. Only *integrations* add third-party auth
  (not Zoom scopes). Team libraries need a new data model, not a new scope.

## Proposed backend data models (🔜 — when to split the blob)

Today: one encrypted blob per `uid`. As entitlements/history/teams arrive, split into:

- `users` — `uid` (PK), createdAt, lastSeen.
- `settings` — `uid`, defaultRate, costModel, simple* (the non-list config). *(The loaded-cost
  `multiplier` was removed — PR #49; a legacy value is ignored if present, not stored going forward.)*
- `rate_rules` — id, `uid`, name, rate, source, updatedAt.
- `aliases` — id, `uid`, alias, canonical.
- `entitlements` — `uid`, plan, features, limits, status, renewsAt.
- `subscriptions` — `uid`, provider, customerId, subscriptionId, status, periodEnd.
- `meeting_summaries` *(Pro)* — `uid`, meetingId, totalCost, durationSec, attendeeCount, ts
  (**aggregates only** — preserves the invariant).
- `teams` / `team_members` *(later)* — shared libraries; revisits the privacy model.

Sensitive rows (`rate_rules`, `aliases`) keep app-level encryption; `entitlements`/
`subscriptions` need not be encrypted (not sensitive the same way) but stay `uid`-scoped.

---

## Recommended MVP cut — first paid launch

Ship the smallest thing that makes Pro worth paying for, without the heavy items:

**Free (already ~there):** live overlay, simple mode, session controls, **basic persistent
settings + a limited number of private rate rules** (server-enforced cap), data export/delete.

**Pro (the launch hook):**
1. **Unlimited** private rate rules + aliases, **cross-device** (Phase 1 ✅ + Phase 3 cap-lift).
2. **One-click attendee harvesting** + **save override as rule** (Phase 2) — the clearest
   "this saves me time every meeting" value.
3. **CSV import/export** of the rate library (Phase 5, cheap).

**Commerce:** **Zoom-native monetization** for the US-only MVP (in-Zoom purchase, no MoR/tax
burden) + **webhook → entitlements** (Phase 4), `GET /api/me` gating, backend-enforced
limits; data model kept provider-agnostic so a later switch to a Merchant of Record
(Paddle / Stripe Managed Payments) for global is a swap.

**Explicitly deferred past MVP:** meeting history, templates, duplicate-detection/alias
suggestions, team libraries, integrations, and **global billing / Merchant-of-Record**
(deferred with the US-only-first launch decision).

**Critical pre-launch gates:** ~~verify the overlay composites on current builds~~ **(resolved by
decision — min-version 7.1.0+ floor + documented warning; the `drawWebView`/ZSEE-195647 live-test
matrix and `drawImage` fallback are dropped)**; finish Phase 1 privacy controls (delete/export +
policy) **and the mandatory deauthorization/data-compliance endpoint**; turn on the shipped store
(config);
the **Phase 6A publishing gate** (deauth endpoint, minimal scopes, privacy policy,
surface-config check); and dev/prod credential isolation.

### Rough sequence

See the **[Execution plan](#execution-plan-orderly-development)** below — it supersedes the old
one-line sequence with a dependency- and gate-annotated inventory of every open item.

---

## Execution plan (orderly development)

The single authoritative answer to *"what's next, in what order, and what blocks what."* It
inventories **every open unit of work** — open items from [`reviews/backlog.md`](../reviews/backlog.md)
(the tactical detail store), the unbuilt future phases above, and the keystone overlay gate.
**Each item links to its detail** (backlog heading or review/roadmap section); this section owns
only the *sequence* — phase, dependencies, gate. The *what/why* stays in the linked source (DRY).

> **Gate legend.** ⛔ **publishing gate** — blocks Marketplace submission / first paid user ·
> 🚧 **build step** — on the path to launch, not itself a gate · ✨ **feature** ·
> 🔧 **ops / CI / UX hardening** (ongoing) · 🧹 **cleanup** · 🎯 **keystone** (de-risks the core).

### Inventory (by track)

| Item (→ detail) | Phase | Depends on | Gate |
|------|-------|-----------|------|
| ~~[Overlay live-test matrix](overlay-live-test-matrix.md)~~ — ✅ **DROPPED 2026-07-01** (resolved by decision: min-version 7.1.0+ floor + user-facing warning; no matrix run, no `drawImage` fallback) | 0.5 | — | 🎯 ⛔→✅ |
| Operator config (add `getAppContext`, Volume + `DATA_DIR`, `RATE_STORE_KEY`) | 1 | — | 🚧 |
| [Client UI for data delete / export](../reviews/backlog.md#client-ui-for-data-delete--export--privacy-page-update) (+ privacy-page self-serve) | 1 | operator config | 🚧 |
| [Zoom deauthorization / data-compliance webhook](../reviews/backlog.md#zoom-deauthorization--data-compliance-webhook) | 1 / 6A | `purgeUser` ✅; identity-mapping check | ⛔ |
| Third-party PII / consent decision | 2 | — (decide before harvest) | ⛔ |
| [Attendee harvest + cross-meeting memory](../reviews/backlog.md#rate-table-memory-across-meetings--harvest-attendee-names-into-it) (the paid hook) | 2 | operator config; PII decision | ✨ |
| Free vs Pro entitlements | 3 | persistence live (Phase 1) | 🚧 |
| Billing — Zoom-native, US-only | 4 | entitlements (Phase 3) | 🚧 |
| Publishing-gate bundle (minimal scopes, [CSP exact-origin pin](../reviews/backlog.md#csp-hardening--pin-to-exact-origins), privacy policy, surface-config, dev/prod isolation) | 6A | features ~frozen; live host known | ⛔ |
| [In-Zoom client-error hardening](../reviews/backlog.md#in-zoom-client-error-hardening-camera-overlay-flow) | — | in-Zoom verification (normal meetings) | 🔧 |
| [Overlay auto-recover — sub-1.5 s flicker miss](../reviews/backlog.md#overlay-auto-recover-misses-very-brief-camera-off-flickers) | — | — | 🔧 |
| ~~`drawWebView` `webviewId` contradiction~~ — ✅ settled in practice (`webviewId:'camera'` composites across weeks of live meetings) | — | — | 🔧→✅ |
| [Server process-level crash guards](../reviews/backlog.md#server-process-level-crash-guards) | 6B | — | 🔧 |
| [Ruleset-as-code](../reviews/backlog.md#ruleset-as-code-single-source-of-truth-for-branch-protection) | 6B | — | 🔧 |
| [esbuild / Vite dev-only bump](../reviews/backlog.md#esbuildvite-security-bump-dev-only-advisory--advisory-resolved-graph-cleanup-pending) — advisory ✅ resolved (0 vulns, esbuild 0.25.12); **graph cleanup pending** (`npm ls` invalid via vitest→vite@8, [tracked separately](../reviews/backlog.md#reconcile-vitestvite8--esbuild-peer-conflict-clean-npm-ls)) | 6B | — | 🔧 |
| Production ops (backups, `RATE_STORE_KEY` rotation, monitoring) | 6B | launch | 🔧 |
| [Retire shape-only diagnostics probe](../reviews/backlog.md#retire-the-shape-only-diagnostics-probe-once-stable) | — | overlay stable ✅ (matrix dropped; probe can now be retired) | 🧹 |
| [Notetakers default to $1/hr](../reviews/backlog.md#identify-notetakers-and-default-them-to-1hr) (off the critical path) | 2-adjacent | per-participant model ✅ | ✨ |
| Phase 5 paid features (CSV, history, templates, dup-detection, team libraries, integrations) | 5 | entitlements + billing | ✨ |
| Global billing / Merchant-of-Record | 4 (later) | US launch | ✨ |

**Excluded (named per AC2):** [Workflow skill defects — moved out of this repo](../reviews/backlog.md#workflow-skill-defects--moved-out-of-this-repo)
is **not** a `zoom-meeting-cost` work item — it was exported to the repo that owns the
frame→review→close skills — so it is deliberately omitted from the sequence above.

### Critical path to first paid launch (ordered)

1. ~~**🎯 Overlay live-test matrix**~~ — **DROPPED 2026-07-01** (resolved by decision: min-version
   **7.1.0+** floor + user-facing warning, documented in README / docs site; no matrix run, no
   `drawImage` fallback). The core-feature risk is now an accepted, documented constraint rather than
   a gate — **so the critical path now starts at Phase 1.**
2. **Finish Phase 1** — operator config (turn the shipped store on) → data delete/export **UI**
   + privacy-page self-serve → **deauth/data-compliance webhook** (the hard ⛔ gate; build it
   close to submission).
3. **Phase 2 — attendee harvest + cross-meeting memory** (resolve the third-party-PII disclosure
   decision first). The clearest "saves me time every meeting" Pro value.
4. **Phase 3 — entitlements** (free vs Pro, server-enforced).
5. **Phase 4 — Zoom-native billing, US-only** (webhook → entitlements).
6. **Phase 6A publishing-gate bundle** — minimal scopes, CSP pinned to exact origins, privacy
   policy complete, camera-surface config confirmed, dev/prod credentials isolated.
7. **MVP launch** → then iterate Phase 5 features + Phase 6B hardening (+ MoR for global).

### Parallel tracks (not on the critical path)

- **In-Zoom UX hardening** — client-error hardening and the sub-1.5 s flicker miss. (The
  `drawWebView` `webviewId` contradiction is settled in practice.) Verify against normal meetings
  on a 7.1.0+ client; no dedicated matrix run.
- **Ops & CI** (Phase 6B) — crash guards, ruleset-as-code, esbuild/Vite bump. Independent of the
  feature path; pick up between feature stories. (Backups / key-rotation / monitoring wait for
  launch.)
- **Cleanup** — retire the diagnostics probe. Previously gated on the live-test matrix; with the
  matrix dropped and the overlay stable in practice, it can be retired whenever convenient.
- **Off-path feature** — notetakers at $1/hr; synergises with harvest but isn't required for MVP.
