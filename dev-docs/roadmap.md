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

> **🔴 Live-render risk (researched 2026-06-11, must verify before relying on the overlay).**
> An active Zoom regression — **ZSEE-195647** — makes `runRenderingContext({view:'camera'})`
> + `drawWebView()` resolve `ok:true` but render **nothing** on the camera feed on **Zoom
> Workplace 6.7.8 / 7.0.2**; reported workaround (2026-05-02) is **`drawImage` instead of
> `drawWebView`**. Our overlay is entirely `drawWebView`-based and logs success even when
> blank — the exact false-success mode that has bitten us before. The overlay was confirmed
> compositing live on 2026-06-10, so *some* client builds work, but a production user on an
> affected build may see nothing. **Gate: a live client-version test matrix (+ a possible
> `drawImage` fallback) before counting the overlay as production-ready.** Tracked as the
> overlay live-test matrix story. (devforum thread 143155.)

> **Research note (2026-06-11).** The ⚠️ external unknowns this roadmap flagged
> (Zoom monetization, billing/MoR, Marketplace review, data-compliance, camera-API config)
> were researched on 2026-06-11 and the answers folded into the phases below — see also
> memory `reference-zoom-prod-unknowns-research`.

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
| Cost meter + overlay | ✅ shipped · ⚠️ live-render risk | camera Layers API; `buildOverlayState` emits aggregates only (`status, totalCost, costPerSecond, elapsedSeconds, attendees, currency, prefs:{}`). ⚠️ `drawWebView` may silently no-op on Zoom Workplace 6.7.8/7.0.2 (ZSEE-195647) — see live-render callout above |
| Overlay data channel (panel→camera) | ✅ verified live 1:1 (prior build) | `postMessage`→`onMessage` matches the canonical sample; **verified live 1:1** (panel `postMessage ok` ↔ camera `overlay-message`, per-second) at PR #17 (`overlay-payload-parse`, `overlay-logging-quiet`). Open risk is **rendering** on *current* builds, not the channel — re-confirm via the live-test matrix |
| **Privacy invariant** | ✅ holds | overlay payload carries **no** names/rates/aliases; `prefs:{}` "never carries private data" (`lib/overlayState.js`) |
| Cost models | ✅ shipped | per-participant table **and** simple `N × rate × multiplier` (`lib/cost.js`, `usePresenterStore.js`) |
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
| Data delete / export | ❌ none | not built (privacy gap — see Phase 1) |

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
  - **Privacy controls (the real gap):** `DELETE /api/rates` (delete my data) and
    `GET /api/rates/export` (export my data as JSON) — both `uid`-scoped. A short
    **data-retention + deletion** note in the README/privacy policy.
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
- **Data/API changes:** add `DELETE` + `export` endpoints; keep the blob store.
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
- **⚠️ Confirm camera-mode surface config:** verify in the live dashboard whether the app
  must be classified as a **Meeting Component / have a "Camera" surface enabled** (newer
  Marketplace taxonomy) beyond just adding the Layers SDK capabilities — capability-only is
  confirmed working via the sample but the surface gate is unconfirmed. (Tied to the overlay
  live-test matrix.)
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
- **Server persistence vs privacy** — ✅ encryption-at-rest shipped, but privacy work is
  **not done**: delete/export endpoints and a retention/deletion policy are required
  (Phase 1). The posture is **operator-decryptable**; stronger (KMS/passphrase) is a future
  option for enterprise.
- **Paid features needing new scopes** — ✅ mostly **no**: unlimited rules, harvest, CSV,
  templates, history (aggregate) are backend/UI. Only *integrations* add third-party auth
  (not Zoom scopes). Team libraries need a new data model, not a new scope.

## Proposed backend data models (🔜 — when to split the blob)

Today: one encrypted blob per `uid`. As entitlements/history/teams arrive, split into:

- `users` — `uid` (PK), createdAt, lastSeen.
- `settings` — `uid`, defaultRate, multiplier, costModel, simple* (the non-list config).
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

**Critical pre-launch gates:** **verify the overlay actually composites + ticks on current
Zoom Workplace builds** (the `drawWebView`/ZSEE-195647 live-test matrix — possible
`drawImage` fallback); finish Phase 1 privacy controls (delete/export + policy) **and the
mandatory deauthorization/data-compliance endpoint**; turn on the shipped store (config);
the **Phase 6A publishing gate** (deauth endpoint, minimal scopes, privacy policy,
surface-config check); and dev/prod credential isolation.

### Rough sequence
**Overlay live-test matrix (de-risk the core feature)** → Phase 1 finish (privacy + config
+ deauth endpoint) → Phase 2 (harvest) → Phase 3 (entitlements) → Phase 4 (Zoom-native
billing, US-only) → MVP launch → Phase 5/6 iterate (incl. MoR for global).
