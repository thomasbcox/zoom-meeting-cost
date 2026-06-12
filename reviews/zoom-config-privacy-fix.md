# zoom-config-privacy-fix

Date: 2026-06-11 · Branch: docs/zoom-config-privacy-fix · Base: main · Status: in review

## Context

Not a `/frame` story — a small, targeted **documentation correction** surfaced by the
Codex thinking-review of the production roadmap (`reviews/prod-unknowns-thinking.codex.md`,
finding #6). `server/zoom-app-config.md` still claimed, in "How the prototype maps to
production," that the presenter's private rate table *"stays in the browser (localStorage)
and is never sent anywhere."*

That is false since the `server-rate-store` story (`a9e4cc2`) shipped: the rate config is
persisted **server-side, encrypted at rest**, and `localStorage` was removed. The stale
text matters because `server/zoom-app-config.md` is a reference doc a Zoom Marketplace
reviewer could read — it misrepresents where user data lives.

## Goal / acceptance

- The "How the prototype maps to production" section accurately describes the **current**
  persistence model, verified against the actual server + client code (not the roadmap).
- The genuine privacy boundary is preserved and stated correctly: the rate table / per-person
  rates are never shown to **attendees**; only aggregate numbers reach the overlay.
- No false "rates never leave the browser" claim remains; the **operator-decryptable**
  posture is noted.
- Doc-only change; the gate (`npm test && npm run build`) stays green.

## Build note (2026-06-11)

Single-file documentation fix; no code paths changed. Verified the corrected text against:

- `server/src/store/rateCrypto.js` — AES-256-GCM, per-user key via HKDF-SHA256
  (`master = RATE_STORE_KEY`, `salt = uid`); operator-decryptable; `RATE_STORE_KEY` is
  separate from the Zoom client secret.
- `server/src/app.js` — `GET`/`PUT /api/rates` behind `requirePresenter`; identity = the
  `uid` decrypted from the `x-zoom-app-context` header (`getAppContext()`); 503 when the
  store is unconfigured → client degrades to session-only; 401 on invalid context.
- `client/src/state/usePresenterStore.js` — persists to the server via `ratesApi`
  (`loadRates`/`saveRates`), **not** `localStorage`; session-only fallback when unreachable;
  `overrides` are current-meeting-only (never persisted).

AC → file map:

- accurate persistence description + obsolete-localStorage note — `server/zoom-app-config.md`
  ("How the prototype maps to production")
- preserved/correct privacy boundary (aggregate-only to attendees) — same section

## Codex review (2026-06-11, base main, HEAD cce48cf)

**Summary:** Reviewed `git diff main...HEAD`, the review note, and the relevant
implementation. The server-side persistence / encryption / operator-decryptable /
`localStorage`-removed corrections are **supported by the code**. One minor
payload-shape precision issue in the new text.

### NIT

1. **Overlay payload description is narrower than the actual `buildOverlayState` payload**
   (`server/zoom-app-config.md`). The new text lists the pushed aggregates as total,
   per-second, and attendee count, but `client/src/lib/overlayState.js` also sends
   `status`, `elapsedSeconds`, `currency`, `updatedAt`, and an empty `prefs:{}`. None of
   these expose private rates or attendee identities, but the description isn't exact.
   *Suggestion:* say the overlay receives aggregate display state (total, per-second,
   elapsed, attendee count, status/currency/timestamp) and explicitly **no** names,
   aliases, rate table, or per-person rates.

_Raw Codex output: `reviews/zoom-config-privacy-fix.codex.json`._

## Decisions (2026-06-11)

- **NIT #1 (overlay payload description narrower than actual) — FIX** (Thomas: "fix").
  Replaced the illustrative "(total, per-second, attendee count)" with the exact
  `buildOverlayState` shape `{ status, totalCost, costPerSecond, elapsedSeconds,
  attendees, currency, updatedAt, prefs:{} }` and an explicit "no names/aliases/rate
  table/per-person rates" clause — verified against `client/src/lib/overlayState.js`.
