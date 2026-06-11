# Meeting Cost — Production Roadmap (free + paid tiers)

Status: **draft** · Created 2026-06-10 · Owner: Thomas

A living strategic roadmap for turning Meeting Cost from a prototype into a production
Zoom App with free and paid tiers. Tactical, per-feature work is tracked in
[`reviews/backlog.md`](../reviews/backlog.md); this file is the strategy above it.

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

The path to a paid product is therefore **mostly product + commerce work, not core
re-architecture**:

1. **Turn the shipped persistence on** (config steps + delete/export for privacy).
2. **Attendee harvesting + private-rule UX** (the highest-value paid hook; the matching/
   dedupe primitives already exist).
3. **One Zoom app, backend entitlements** (free vs Pro), enforced server-side.
4. **Billing via Stripe/Paddle** with webhook-driven entitlements (Zoom's own monetization
   is ⚠️ unverified and, if used, is a fallback — not the primary recommendation).
5. **Paid advanced features** (CSV, history, templates, team libraries) — most need **no
   new Zoom scopes**.
6. **Marketplace hardening + privacy review** for production listing.

**Recommended MVP for first paid launch** is at the end of this document.

---

## Current state — verified from repo

| Area | Status | Evidence |
|------|--------|----------|
| Cost meter + overlay | ✅ shipped | camera Layers API; `buildOverlayState` emits aggregates only (`status, totalCost, costPerSecond, elapsedSeconds, attendees, currency, prefs:{}`) |
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
- **⚠️ Verify first:** Zoom Marketplace has historically offered app **monetization**
  (Zoom-managed billing / revenue share). **Confirm the current program, constraints, and
  whether it fits in-meeting apps before relying on it.** It couples billing to Zoom and
  the listing.
- **Recommended (🔜):** **Stripe** (or Paddle as Merchant-of-Record for global tax) as
  the billing system, decoupled from Zoom:
  - Checkout → subscription; **webhook → update `entitlements`** for the `uid` (map the
    Stripe customer/subscription to the Zoom `uid` at checkout).
  - Backend is the single source of truth; the client only reads `GET /api/me`.
  - Handle the lifecycle: `checkout.session.completed`, `customer.subscription.updated/
    deleted`, payment failures, grace periods. Idempotent webhook processing.
- **Data/API changes:** `subscriptions` record (provider, customer id, subscription id,
  status, period); webhook endpoint with signature verification; idempotency keys.
- **Risks / open questions:** ⚠️ Zoom-vs-Stripe choice (control/portability vs frictionless
  in-Zoom purchase); MoR/tax (Paddle vs Stripe Tax); linking a Stripe customer to a Zoom
  `uid` from inside the webview; refunds/chargebacks → downgrade.
- **AC:** completing checkout flips the user to Pro within seconds via webhook; cancellation/
  failed payment downgrades to free at period end; replayed webhooks are idempotent; no
  client-trusted entitlement.

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

### Phase 6 — Marketplace hardening + privacy review + production readiness  🔜

- **Goal:** pass Zoom Marketplace review and run safely in production.
- **Tasks:**
  - **Minimal scopes:** request only what's used (✅ today: `zoomapp:inmeeting`,
    `meeting:read:participant`/capability; drop `user:read:email` unless email matching
    ships). Add scopes *only* when a feature needs them.
  - **Dev vs production credentials:** separate Zoom apps/credentials for dev and prod
    (different client id/secret, redirect URIs, and **`RATE_STORE_KEY`**); document the
    split. ⚠️ Never share `RATE_STORE_KEY` across environments (data encrypted under one
    can't be read under another).
  - **CSP / headers** (✅ `connect-src` pinned; verify in-Zoom), secret scanning (✅ local
    hook; Part B GitHub toggle pending), CI gate (🔜 backlog #3 Part C).
  - **Privacy policy + data handling doc:** what's stored, where, encryption posture
    (operator-decryptable), retention, deletion/export rights — required for Marketplace.
  - **Production ops:** volume backups, key management/rotation plan for `RATE_STORE_KEY`,
    monitoring, error reporting.
- **Risks / open questions:** Marketplace review timelines; privacy-policy completeness;
  key rotation without data loss (needs a re-encrypt migration).
- **AC:** app passes Zoom review with minimal scopes; a published privacy policy matches
  the implementation; dev/prod are isolated; backups + key plan exist.

---

## Cross-cutting decisions (challenging the note's assumptions)

- **`localStorage` durability** — ✅ moot: removed; server-backed. Session-only fallback
  remains as graceful degradation, **not** as durable storage.
- **One app vs two** — 🔜 **recommend one Zoom app with backend entitlements.** Free/Pro is
  a billing concern, not a listing concern; two listings double review/maintenance and
  fragment installs. A **second listing is justified only** for: admin-managed enterprise
  distribution, materially different OAuth scopes, or a separate compliance posture
  (e.g. a HIPAA/government variant).
- **Zoom paid entitlements** — ⚠️ **do not assume.** Verify Zoom's current monetization
  program; default recommendation is **Stripe/Paddle + webhooks**, with backend as the
  source of truth.
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

**Commerce:** **Stripe** subscription + **webhook → entitlements** (Phase 4), `GET /api/me`
gating, backend-enforced limits.

**Explicitly deferred past MVP:** meeting history, templates, duplicate-detection/alias
suggestions, team libraries, integrations, and Zoom-native monetization.

**Critical pre-launch gates:** finish Phase 1 privacy controls (delete/export + policy),
turn on the shipped store (config), Phase 6 minimal-scope + privacy-policy review, and
dev/prod credential isolation.

### Rough sequence
Phase 1 finish (privacy + config) → Phase 2 (harvest) → Phase 3 (entitlements) →
Phase 4 (Stripe) → MVP launch → Phase 5/6 iterate.
