# data-delete-export

Date: 2026-06-25 · Branch: claude/data-delete-export · Status: approved

> **Approved 2026-06-25** — Thomas: "yes" → defer the deauth webhook + client UI to follow-up
> stories; **fix both** Codex design findings (crypto-independent DELETE via split middleware;
> neutral `/api/me` data-rights registry with `rateStore` as one adapter). The In-scope / ACs
> below are the **revised approved shape**; see `## Design decisions`.

> Phase 1 privacy controls (roadmap). This story builds the **user-facing data-rights API + the
> shared "all uid-scoped data" primitive**. The mandatory Zoom **deauthorization/data-compliance
> webhook** and the **client UI** are recommended as separate follow-up stories — see Open
> questions (Thomas named the webhook; flagging the split rather than silently dropping it).

## Problem

The roadmap's Phase 1 has a real gap: a presenter can store an (encrypted) rate config server-side
but has **no way to delete or export it**. Privacy regimes (GDPR/CCPA) and Zoom Marketplace review
both require data-subject delete + export. Today the only deletion route is "email us" (per
`docs/privacy.html`); there is no programmatic path and no export at all.

A second, structural requirement (flagged in the roadmap from a prior Codex review): delete and
export must operate on **all data keyed to a `uid`**, designed as a *single enumeration point*, so
that as new per-user stores arrive (entitlements, subscriptions, aliases, meeting summaries) they
**cannot silently escape** the delete/export paths. Today the only uid-scoped store is the
encrypted rate blob (`server/src/store/rateStore.js`, one file per `uid`).

## In scope  (revised — approved shape)

- **Neutral user-data registry** — new module `server/src/userData.js`, the *single enumeration
  point* for "everything we store about this `uid`." It holds one list of store adapters (today
  just `rateStore`) and exposes:
  - `purgeUser(uid)` — delete every uid-scoped artifact across the list (idempotent; no error if
    nothing stored). Returns the covered store keys (e.g. `['rates']`).
  - `exportUser(uid)` — gather all uid-scoped data across the list (today
    `{ rates: <decrypted config | null> }`).
  A future store (entitlements, etc.) is added to the one adapter list and is then covered by
  **both** automatically. `rateStore` is just an adapter — it does **not** own the registry.
- **rateStore adapter method** (`server/src/store/rateStore.js`): add `remove(uid)` — idempotent
  delete of the uid's rate file (`fs.rm(fileFor(uid), { force: true })`, never throws on missing).
  `load(uid)` already covers the export side.
- **Split the auth middleware** in `server/src/app.js` so deletion never depends on rate-blob
  crypto:
  - `requireIdentity` — requires Zoom **client id + secret** and resolves `req.uid` from the app
    context (503 if identity config is absent, 401 on a bad/absent context). **No
    `RATE_STORE_KEY` check.**
  - `requireRateStore` — requires the crypto key (`rateStoreConfigured()`) → 503 if absent. Layered
    **after** `requireIdentity` on the paths that read/write the encrypted blob.
  - Rewire the existing `GET/PUT /api/rates` to `[requireIdentity, requireRateStore]` — **behavior
    unchanged** (still 503 when the key or client id is missing, 401 on a bad context).
- **Two account-scoped endpoints** in `server/src/app.js`:
  - `DELETE /api/me/data` → `requireIdentity` only → `userData.purgeUser(req.uid)`; 200
    `{ deleted: true, stores: [...] }`. Idempotent, and **works even when `RATE_STORE_KEY` is
    absent** (deleting a file needs no decryption).
  - `GET /api/me/export` → `[requireIdentity, requireRateStore]` (decrypt needed) →
    `userData.exportUser(req.uid)`; 200 JSON with
    `Content-Disposition: attachment; filename="meeting-cost-data.json"` and body
    `{ exportedAt: <ISO>, data: { rates: <config|null> } }`.
- **Tests:** `server/test/userData.test.js` (new — the registry primitives + the two `/api/me`
  endpoints, incl. DELETE-without-crypto) and `server/test/rateStore.test.js` (the new `remove`
  adapter).

## Non-goals

- **No Zoom deauthorization / data-compliance webhook** in this story (recommended follow-up —
  see Open questions). It reuses `purgeUser` but is a distinct concern (webhook HMAC auth, a new
  secret, an unverified `payload.user_id`↔`uid` mapping, an outbound compliance callback, and
  Marketplace config) and is a *publishing gate*, not yet on the critical path.
- **No client UI** (the "Export my data" / "Delete my data" buttons). The endpoints are the
  foundation; the React panel UI is a separate small story.
- **No docs/policy change** yet. `docs/privacy.html` still routes deletion via email; it should be
  updated to advertise self-serve delete/export **only once the client UI ships** (so the public
  claim stays true). Out of scope here.
- No change to encryption or identity resolution. `GET/PUT /api/rates` keep their **behavior**;
  they are only rewired onto the two split middlewares (no observable change).
- No new dependency.

## Acceptance criteria

1. **purgeUser is idempotent + total:** after `userData.purgeUser(uid)`, `rateStore.load(uid)`
   returns `null`; a second `purgeUser(uid)` (nothing stored) does **not** throw and still
   succeeds. It returns the covered store keys (today `['rates']`).
2. **exportUser returns all uid data:** `userData.exportUser(uid)` returns
   `{ rates: <the saved config> }` after a save, and `{ rates: null }` when nothing is stored —
   never throwing.
3. **Single enumeration point lives in the neutral module:** `purgeUser`/`exportUser` derive their
   store set from one shared adapter list in `server/src/userData.js` (not in `rateStore`);
   `rateStore` is one adapter exposing `remove`/`load`. *(Structural; checked by reading the code.)*
4. **Crypto-independent DELETE:** `DELETE /api/me/data` with a valid app context returns 200 and
   purges the uid's data (subsequent `GET /api/rates` → `null`); it is idempotent (second DELETE
   still 200s) and **still 200s when `RATE_STORE_KEY` is unset** (deletion needs no decrypt).
   Without a valid context → 401; with Zoom **identity** config (client id/secret) absent → 503.
5. **Export endpoint:** `GET /api/me/export` with a valid app context returns 200 with
   `Content-Disposition: attachment` and a body whose `data.rates` equals the saved config (or
   `null`). Without a valid context → 401; with `RATE_STORE_KEY` unset → 503.
6. **Existing routes unchanged:** `GET/PUT /api/rates` keep their current behavior under the split
   middleware — 503 when `RATE_STORE_KEY`/client id is unset, 401 on a bad context (existing
   `server/test/rates.test.js` stays green).
7. **Isolation:** purging/exporting one `uid` never touches another `uid`'s data.
8. **Gate green:** `npm test && npm run build` passes.
9. **Scope containment:** the **implementation** diff touches only `server/src/userData.js`,
   `server/src/store/rateStore.js`, `server/src/app.js`, and the test files
   `server/test/userData.test.js` / `server/test/rateStore.test.js` (and `server/test/rates.test.js`
   only if the middleware split needs a test tweak). Review/spec artifacts under `reviews/` exempt.

## Test notes

- AC1 / AC2 / AC7 — `server/test/userData.test.js` (registry unit, env set like `rateStore.test.js`):
  save via `rateStore.save`, `exportUser` returns it, `purgeUser` removes it (`load` → null), second
  `purgeUser` no-throws; a second uid is untouched; `exportUser` on an unknown uid → `{ rates: null }`.
- AC3 — read `userData.js`: one adapter list drives both functions; `rateStore` exposes
  `remove`/`load` only.
- AC4 / AC5 — `server/test/userData.test.js` endpoint cases (mirror `rates.test.js`'s
  `encryptAppContextForTest` + `before` env): `DELETE /api/me/data` then `GET /api/rates` → null;
  second DELETE → 200; **DELETE still 200 with `RATE_STORE_KEY` deleted** from env; `GET /api/me/export`
  returns the saved config + attachment header; both → 401 without a context; export → 503 when
  `RATE_STORE_KEY` unset; DELETE → 503 only when client id/secret absent.
- AC6 — `server/test/rates.test.js` runs unchanged and green (the split middleware preserves
  GET/PUT behavior); tweak only if a precedence assertion shifts.
- AC8 — run `npm test && npm run build`.
- AC9 — run `git diff --name-only main...HEAD`; verify no implementation files beyond those listed
  (review artifacts under `reviews/` exempt).

## Open questions — resolved (2026-06-25)

1. **Deauth webhook → deferred to its own follow-up story** (Thomas: "yes"). It will reuse this
   story's `userData.purgeUser`. The **client UI** (delete/export buttons) is likewise deferred,
   and **no docs/privacy change** ships until that UI does (so the public claim stays true).
2. **Endpoint naming → `/api/me` chosen** (resolved by design finding ②): `DELETE /api/me/data` +
   `GET /api/me/export`; `/api/rates` stays the rate-config resource.

## Design sketch — HOW

- **Store primitives (single enumeration point).** In `rateStore.js`, define the set of
  uid-scoped artifacts in one place — today just the rate file via `fileFor(uid)`. `purgeUser(uid)`
  iterates that set and removes each (using `fs.rm(path, { force: true })` so a missing file is a
  no-op, never a throw) and returns the covered store keys. `exportUser(uid)` iterates the same set
  and gathers `{ rates: await load(uid) }` (reusing the existing decrypt path). A future store
  (e.g. `entitlements`) is added to the shared list once and is automatically covered by both. No
  new persistence shape — same file-per-uid model.
- **Endpoints.** Add `DELETE /api/rates` and `GET /api/rates/export` beside the existing rate
  routes, both wrapped in `requirePresenter` (identical 503/401 gating + `req.uid`), with
  try/catch → `next(err)` like the current handlers. DELETE returns a small JSON confirmation;
  export sets a download `Content-Disposition` and returns `{ exportedAt, data }`. Timestamp via
  `new Date().toISOString()` (app code; fine).
- **Idempotency + safety.** Delete is idempotent (force-remove); both are uid-scoped via the same
  `fileFor` base64url filename, so one user can't reach another's file (the existing
  path-traversal-safe encoding still applies).
- **No new dependency, no new pattern** — reuses Express routing, the existing store/identity
  modules, and `node:fs`.

## Codex design review (2026-06-25)

**Verdict:** Core idea sound (store-adapter enumeration; no new dependency; `fs.rm({force:true})`
for idempotent delete; Express + `node:test` match convention) — but Codex "would not build it
exactly as written" on two counts, both **one-way** doors.

**Findings:**

- **IMPORTANT · one-way · kludgy — DELETE gated on rate-store crypto readiness**
  (`data-delete-export.md` In-scope). Wrapping DELETE in `requirePresenter` means it returns 503
  when `RATE_STORE_KEY` is missing — but *deleting* the encrypted file needs no decryption. This
  couples identity verification to crypto readiness and creates a data-retention failure mode:
  during key loss/misconfig you couldn't delete your data (exactly when you'd want to).
  *Alternative:* split the middleware — `requireIdentity` (Zoom client id/secret + resolve `uid`,
  no crypto) vs. `requireRateStoreConfigured` (crypto, for GET/PUT/export). DELETE uses
  identity-only + `purgeUser`. *Win:* deletion works in the precise failure mode where
  decrypt/export can't, and the future deauth webhook reuses the same crypto-free purge.

- **IMPORTANT · one-way · nonstandard — account-scoped data rights framed as "rates"**
  (`data-delete-export.md` In-scope). Putting the "all uid data" registry in `rateStore.js` and
  exposing `DELETE /api/rates` is consistent only while rates are the sole store; once
  entitlements/subscriptions/summaries arrive, a *rates* module/route owns and deletes unrelated
  account data. *Alternative:* a neutral user-data/data-rights registry module as the single
  enumeration point with `rateStore` as one adapter; account routes `GET /api/me/export` +
  `DELETE /api/me/data` (keep `/api/rates` for the rate config). *Win:* the enumeration point is
  real without future stores depending on the rates module, and the API name matches the
  destructive blast radius before UI/docs make it hard to rename.

## Design decisions (2026-06-25)

Thomas approved scope (defer deauth webhook + client UI) and **both** one-way design findings —
binding on implementation:

- **① crypto-independent DELETE — FIX.** Split `requirePresenter` into `requireIdentity` (Zoom
  client id/secret + resolve `uid`; no crypto) and `requireRateStore` (the `RATE_STORE_KEY`
  check). `DELETE /api/me/data` uses identity-only so deletion works during key loss/misconfig;
  `GET/PUT /api/rates` and `GET /api/me/export` layer both. The future deauth webhook reuses the
  crypto-free `purgeUser`.
- **② neutral data-rights registry — FIX.** The single enumeration point lives in a new
  `server/src/userData.js` (`purgeUser`/`exportUser` over one adapter list), with `rateStore` as
  one adapter (`remove`/`load`). Account routes are `DELETE /api/me/data` + `GET /api/me/export`;
  `/api/rates` stays the rate-config resource. Renames the destructive path to match its blast
  radius before UI/docs lock it in.
