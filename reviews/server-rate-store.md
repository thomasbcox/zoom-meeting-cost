Date: 2026-06-10 · Branch: claude/server-rate-store · Status: approved

> Approved by Thomas 2026-06-10. Decisions: (1) he'll attach the Railway Volume +
> `RATE_STORE_KEY` (I generate the key); (2) key-unset → **fail closed (503)**;
> (3) **remove `localStorage` entirely** (server is the only persistence; offline =
> session-only in-memory); (4) document the new posture **with user-facing disclaimers
> and warnings** (a notice in the app UI, not just the README). Identity = Zoom
> app-context `uid`; encryption at rest = AES-256-GCM keyed by `RATE_STORE_KEY`+`uid`.

**Phase 1 of "server-backed rate-table memory"** (Thomas chose: foundation first;
storage on a Railway volume; this revisits the privacy invariant). This story builds the
persistence foundation — resolve the presenter's identity, store their rate config on a
Railway volume keyed by that identity, and have the client load/save it. **Harvest is a
later Phase 2** and is out of scope here.

> ⚠️ This story changes the project's privacy posture: a presenter's private rate table
> (names + estimated rates) **leaves the browser** and is stored on the server,
> **encrypted at rest** (AES-256-GCM, per-user key derived from a dedicated server secret
> + the `uid` salt). A leaked volume/backup is useless without the server key; the running
> server (operator) can still decrypt. This is a deliberate departure from "rates/names
> never leave the browser," accepted when Thomas chose the server-backed path (2026-06-10).

## Problem

`localStorage` is **not a reliable persistence layer inside the Zoom client** (embedded
webview storage can be ephemeral/partitioned), and the Zoom SDK exposes no durable
store. So the rate table doesn't truly survive across meetings today — the "memory"
the backlog wants doesn't actually exist in the real client. Delivering it requires
server-side storage keyed to the presenter, on a stateless Express app that currently
has **no persistence and no resolved server-side identity** (`server` deps = just
`express`; `oauth.js` exchanges a token but never derives a user id —
`oauth.js:75`: *"In a real app: persist token keyed by Zoom user id"*).

**Identity — resolved: the Zoom app context `uid`.** Everything keys off a *stable,
per-presenter* id. The participant UUID from `getUserContext` is per-meeting, so not it.
But Zoom hands every in-client app a **signed app context** that decrypts (server-side,
with the Zoom client secret) to `{ uid, aud, iss, exp, mid?, role?, … }`, where **`uid`
is "the Zoom user id who opens the app"** — stable per user, exactly the key we need —
and `aud` (our client id) + `iss` (`marketplace.zoom.us`) + `exp` make it verifiable.
This is the idiomatic Zoom-provided identity and needs **no OAuth round-trip** (avoiding
the external-browser-cookie problem). The remaining work is implementing Zoom's
documented decryption correctly (deterministic → unit-testable against a fixture) and
wiring the context from the client/load to the server.

## In scope

- **Identity resolution (the foundation):** server middleware that resolves the
  presenter's stable `uid` by **decrypting the Zoom app context** with the client secret
  (per Zoom's documented scheme), validating `aud` == our client id, `iss` ==
  `marketplace.zoom.us`, and `exp` not passed. Transport: the server reads the
  `x-zoom-app-context` header on the in-client app load and establishes a signed,
  same-origin session (so subsequent same-origin `/api/rates` XHRs carry it) — or the
  client sends the `getAppContext()` blob per request; impl picks the simpler. No OAuth.
- **Encryption-at-rest module** (`server/src/store/rateCrypto.js`): AES-256-GCM with a
  per-user key = `HKDF(RATE_STORE_KEY, salt = uid)`; `encrypt(uid, plaintext)` →
  `{ nonce, ct, tag }`, `decrypt(uid, blob)` → plaintext (GCM auth tag rejects tampering).
  `RATE_STORE_KEY` is a **dedicated** env secret — NOT the Zoom client secret (so cred
  rotation doesn't brick stored data) and NOT on the volume. Pure + unit-testable.
- **Volume-backed store** (`server/src/store/rateStore.js`): read/write a presenter's
  rate config (`{ rateTable, aliases, defaultRate, multiplier }`) under a Railway
  **persistent volume** path (e.g. `DATA_DIR`, default `/data`), keyed by `uid`, with the
  payload **encrypted via `rateCrypto`** (the volume only ever holds ciphertext). A thin,
  unit-testable abstraction (inject the dir); never throws on a missing/corrupt/undecryptable
  file (returns empty/defaults).
- **Endpoints** on the Express app: `GET /api/rates` → the stored config for the
  authenticated presenter (or defaults if none); `PUT /api/rates` → validate + save it.
  Both require a resolved id (401 otherwise). Body size-limited; rate values validated.
- **Client wiring:** `usePresenterStore` loads from `GET /api/rates` on boot (seeding the
  store), and `PUT`s on change (debounced). **`localStorage` is removed entirely** — the
  server is the only persistence; if it's unreachable / `503`, the store runs on in-memory
  session state only (no persistence that session, no plaintext stored anywhere else).
- **User-facing warning:** a clear disclaimer in the per-participant rate-table UI
  (`PresenterControls.jsx`) — e.g. that the rate table (names + estimated rates) is saved
  **to the server, encrypted, tied to your Zoom identity**, and is decryptable by the
  app operator; don't enter anything you wouldn't want stored server-side.
- **Docs:** redefine the privacy posture in `README.md` with the same disclaimer;
  document the required Railway **Volume** / `DATA_DIR` and the `RATE_STORE_KEY` secret.

## Non-goals

- **No harvest** — that's Phase 2 (this only makes the table persist).
- **No multi-instance/concurrency hardening** — single Railway instance + a volume is the
  prototype target; not a clustered DB.
- **No zero-knowledge / no sharing between users** — data is encrypted at rest, but the
  server (operator) can decrypt; true "operator can't read it" would need a user
  passphrase (rejected for UX). Each presenter's config is private to their own `uid`.
- No change to the cost engine, overlay, adapter, or the matching logic.

## Acceptance criteria

1. **Identity:** the server decrypts the Zoom app context with the client secret, verifies
   `aud`/`iss`/`exp`, and resolves the presenter's `uid` for `/api/rates` requests;
   requests with a missing/invalid/expired context get `401`. Unit-tested by decrypting a
   fixture context (round-tripped through Zoom's documented scheme) and asserting `uid`,
   plus rejection of a wrong-`aud`/expired/garbage context.
2. **Encryption:** `rateCrypto.encrypt(uid, plaintext)` / `decrypt(uid, blob)` round-trips
   to the original; a different `uid` or a different `RATE_STORE_KEY` fails to decrypt; a
   tampered ciphertext/tag is rejected (GCM auth failure). Unit-tested. `RATE_STORE_KEY`
   is read from env; behavior when it's unset is explicit (the store fails closed — see
   Open Q).
3. **Store:** `rateStore` reads/writes a config object keyed by `uid` under `DATA_DIR`,
   persisting only **ciphertext**; round-trips `{ rateTable, aliases, defaultRate,
   multiplier }`; returns safe defaults for an unknown id or an unreadable/corrupt/
   undecryptable file (never throws). Unit-tested against a temp dir.
4. **Endpoints:** `GET /api/rates` returns the caller's stored config (or defaults);
   `PUT /api/rates` validates the body (shape + numeric rates, size-limited) and
   persists it; both `401` without a resolved id. Tested with an injected fake identity.
5. **Client:** on boot the presenter store seeds from `GET /api/rates`; edits `PUT` back
   (debounced). **No `localStorage`** — if the server is unreachable / `503`, the store
   runs on in-memory session state and the app still works (no persistence that session).
6. **Privacy doc + UI warning:** `README.md` states the new posture — the rate table is
   stored server-side keyed to the presenter's Zoom `uid`, **encrypted at rest** (per-user
   key from `RATE_STORE_KEY` + `uid`), decryptable by the server operator, never shared
   with participants or other users — replacing the "browser-only" claim; `RATE_STORE_KEY`
   + the Railway Volume / `DATA_DIR` are documented as required config. **And** the
   per-participant rate-table UI shows a user-facing disclaimer to the same effect.
7. No regression: `npm test && npm run build` green; the existing app behavior (cost,
   overlay) is unchanged.
8. **(Post-merge / in-Zoom + Railway, observed.)** With a Railway volume mounted at
   `DATA_DIR` and `RATE_STORE_KEY` set: a presenter edits their rate table in one meeting;
   in a later meeting (or after a redeploy) the same table loads back automatically; the
   on-volume file is ciphertext. Confirmed live.
9. Scope containment: `git diff --name-only main...HEAD` shows no files beyond:
   `server/src/store/rateCrypto.js`, `server/src/store/rateStore.js`,
   `server/src/zoom/appContext.js` (app-context decrypt → uid), `server/src/app.js`,
   `client/src/state/usePresenterStore.js`, `client/src/components/PresenterControls.jsx`
   (the UI disclaimer), `client/src/zoom/zoomAdapter.js` (+ test — the `getAppContext`
   capability + adapter method for the chosen transport), `client/src/lib/ratesApi.js`
   (+ test — the client http helper), `server/zoom-app-config.md` (keep the capability
   doc mirroring `ZOOM_CAPABILITIES` now that `getAppContext` is added), the new server
   tests, `README.md`, and this story.

> **Transport (decided 2026-06-10):** the client calls `getAppContext()` and sends the
> context blob in an `x-zoom-app-context` request header on each `/api/rates` call; the
> server decrypts per request. Adds the `getAppContext` capability (+ a one-time Marketplace
> **Add API** step, like `getVideoState`) and a `zoomAdapter` method. No cookies.

## Test notes

- **AC1:** unit-test the identity middleware with a fixture app context producing a known
  `uid`, and assert `401` on missing/invalid/expired/wrong-`aud`. (Real round-trip = AC8.)
- **AC2:** `rateCrypto.test.js` (node:test) — encrypt→decrypt round-trips; wrong `uid` or
  wrong `RATE_STORE_KEY` fails; tampered ciphertext/tag rejected; unset key fails closed.
- **AC3:** `rateStore.test.js` — write then read a config for a `uid` against a temp
  `DATA_DIR`; the on-disk file is ciphertext; unknown id → defaults; corrupt/undecryptable
  file → defaults, no throw.
- **AC4:** start the app with an injected identity resolver; `GET`/`PUT` round-trip;
  `401` without identity; malformed `PUT` body rejected.
- **AC5:** unit-test the store's load/save calls (fetch mocked); confirm boot seeds from
  the server and edits debounce a `PUT`; server-unreachable degrades gracefully.
- **AC6:** read `README.md` — the privacy section reflects encrypted server-side storage
  + the required `RATE_STORE_KEY` / volume config.
- **AC7:** `npm test && npm run build` green.
- **AC8:** **post-merge**, with the volume + `RATE_STORE_KEY` configured — edit rates,
  rejoin/redeploy, confirm they persist and reload; the on-volume file is ciphertext.
- **AC9:** `git diff --name-only main...HEAD` within the enumerated set.

## Open questions

1. **Identity — RESOLVED:** decrypt the Zoom app context → `uid` (confirmed in the SDK
   types: `uid` = "the Zoom user id who opens the app", with `aud`/`iss`/`exp` to verify).
   No spike needed — the decryption is deterministic and unit-testable against a fixture;
   only the live round-trip is left to AC7. The one impl sub-choice (header+session vs
   client-sends-`getAppContext` per request) I'll pick during build for simplicity.
   *(If `getAppContext` turns out to need a capability/dashboard entry like
   `getVideoState` did, I'll flag it — but the `x-zoom-app-context` header path needs no
   SDK capability.)*
2. **`localStorage`** — RESOLVED: **remove entirely** (Thomas). Server is the only
   persistence; offline = session-only in-memory.
3. **Railway config** — RESOLVED: Thomas attaches the Volume (`DATA_DIR`) + sets
   `RATE_STORE_KEY` (Claude generates a strong key to paste).
4. **`RATE_STORE_KEY` unset** — RESOLVED: **fail closed (503)**, client → session-only.
5. **Privacy wording** — RESOLVED: documented **with user-facing disclaimers + warnings**
   (a UI notice plus the README), per Thomas.

## Build note (2026-06-10)

AC → file map:
- **AC1** (identity: decrypt+verify Zoom app context → uid) → `server/src/zoom/appContext.js`; test `server/test/appContext.test.js`.
- **AC2** (encryption at rest: AES-256-GCM, HKDF(RATE_STORE_KEY,uid); fail closed) → `server/src/store/rateCrypto.js`; test `server/test/rateCrypto.test.js`.
- **AC3** (encrypted blob store per uid on the volume) → `server/src/store/rateStore.js`; test `server/test/rateStore.test.js`.
- **AC4** (GET/PUT /api/rates behind requirePresenter; 503/401/400) → `server/src/app.js`; test `server/test/rates.test.js`.
- **AC5** (client: localStorage removed; load on boot / debounced save; session-only fallback) → `client/src/state/usePresenterStore.js`, `client/src/lib/ratesApi.js` (+test), `client/src/zoom/zoomAdapter.js` (+test, getAppContext), `client/src/App.jsx`.
- **AC6** (privacy doc + UI warning) → `README.md`, `client/src/components/PresenterControls.jsx`; capability mirror `server/zoom-app-config.md`.
- **AC7** (no regression; gate green) → `npm test && npm run build`.
- **AC8** (real persistence) → post-merge, in-Zoom + Railway volume observed.
- **AC9** (scope) → `git diff --name-only main...HEAD`.
