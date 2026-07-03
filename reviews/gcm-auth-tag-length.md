Date: 2026-07-02 · Branch: claude/gcm-auth-tag-length · Status: approved

## Problem

Both AES-256-GCM decryption sites call `crypto.createDecipheriv('aes-256-gcm', key, iv)`
**without** an explicit `authTagLength`, flagged by semgrep `gcm-no-tag-length` (AUDIT-1):

- `server/src/zoom/appContext.js:45` — decrypts the **external** Zoom app context (attacker
  can supply the blob; the 401/200 response is an oracle). Gated by the client secret.
- `server/src/store/rateCrypto.js:56` — the at-rest per-user rate-store envelope.

Without pinning the tag length, GCM can be induced to verify a **shorter-than-expected**
auth tag, which materially eases ciphertext forgery on an auth boundary. Node ≥22's
stricter tag-length handling reduces the practical exposure, but pinning `{ authTagLength:
16 }` is the unambiguous best practice and removes the ambiguity entirely.

**Backward-compatible:** the encrypt sides already emit the full 16-byte tag
(`cipher.getAuthTag()` default; appContext's format packs a 16-byte tag). Pinning 16 accepts
every existing envelope — no re-encryption or data migration.

## In scope

- Pass `{ authTagLength: 16 }` to `createDecipheriv('aes-256-gcm', …)` at both sites.
- A test asserting the auth tag is still enforced (a wrong-length / tampered tag is rejected)
  and that valid round-trips still succeed (no regression / migration).

## Non-goals

- No change to the encrypt sides, the key derivation (HKDF), the envelope format, or the
  Zoom app-context binary layout — this is a decrypt-hardening one-liner ×2.
- No re-encryption of stored data (existing tags are already 16 bytes).
- The other audit items (AUDIT-2 CI shell checks, AUDIT-3 gitleaks allowlist) are separate.

## Acceptance criteria

1. Both `createDecipheriv('aes-256-gcm', key, iv)` calls
   (`server/src/zoom/appContext.js`, `server/src/store/rateCrypto.js`) pass
   `{ authTagLength: 16 }` as the options argument.
2. Existing valid round-trips still succeed unchanged: `rateCrypto` encrypt→decrypt returns
   the plaintext; a valid Zoom app context still resolves to its `uid` (backward compatible,
   no migration).
3. A tampered/wrong auth tag is rejected (decrypt throws) at both sites — the integrity
   guarantee is preserved, now with the tag length pinned.

## Test notes

- **AC1:** verified by the diff (the `{ authTagLength: 16 }` argument at both call sites).
- **AC2:** existing suites already cover the happy path and stay green —
  `server/test/rateCrypto.test.js` (encrypt→decrypt round-trip) and
  `server/test/appContext.test.js` (`encryptAppContextForTest` → `resolveUid`). No new
  fixtures needed; passing proves backward compatibility.
- **AC3:** exercise the **tag-length invariant directly** (not just same-length tamper,
  which would already fail pre-fix). For `rateCrypto` — encrypt, then **truncate and extend**
  `blob.tag` (≠ 16 bytes) and assert `decrypt` throws; for `appContext` — decode the
  context, **remove/append a trailing tag byte**, re-encode, and assert `resolveUid` throws
  `AppContextError`. Keep a same-length byte-flip as ordinary tamper coverage. Together these
  lock: valid 16-byte envelopes still decrypt (AC2), non-16-byte tags are rejected at both
  boundaries.
- **AC4 (scope containment):** `git diff --name-only main...HEAD` shows no files beyond
  `server/src/zoom/appContext.js`, `server/src/store/rateCrypto.js`, their tests under
  `server/test/**`, `reviews/gcm-auth-tag-length*`, and the pre-committed audit bookkeeping
  (`BACKLOG.md`, `reviews/audit-2026-07-02.md`) that rode onto this branch.

## Open questions

None — the fix is a well-defined, backward-compatible hardening.

## Design sketch — HOW

- **`server/src/store/rateCrypto.js`** (decrypt): change
  `crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.nonce, 'base64'))`
  → add a 4th arg `{ authTagLength: 16 }`. Everything else (setAuthTag, update/final) unchanged.
- **`server/src/zoom/appContext.js`** (decryptAppContext): change
  `crypto.createDecipheriv('aes-256-gcm', key, iv)` → `…, iv, { authTagLength: 16 })`,
  keeping the chained `.setAAD(aad).setAuthTag(tag).setAutoPadding(false)`.
- A named constant (e.g. `GCM_TAG_LENGTH = 16`) is optional given only two sites in two
  files; inline `{ authTagLength: 16 }` with a short comment keeps the change minimal and
  local. No shared module, no new dependency.
- Rationale for 16: the encrypt sides emit a full 16-byte tag, so 16 is both the correct
  value and backward-compatible with all stored/issued envelopes.

## Codex design review (2026-07-03)

**Verdict: sound — one IMPORTANT (two-way), folded in.** Pinning `{ authTagLength: 16 }` on
the two first-party GCM decrypt sites is the right, complete hardening (repo sweep found no
other GCM/CCM decrypt sites); backward-compatible (both encrypt sides emit Node's default
16-byte tag; the app-context layout treats the trailing tag as 16 bytes); no pre-`setAuthTag`
length check needed (the pinned option makes Node reject non-16-byte tags first).

- **[IMPORTANT · two-way · nonstandard] Test plan doesn't exercise the tag-length invariant.**
  The sketched same-length byte-flip tests would already fail pre-fix, so they leave the new
  16-byte invariant implicit. _Alternative:_ add wrong-length cases — truncate/extend the tag
  and assert reject at both boundaries; keep the flip as ordinary tamper coverage. _Win:_ the
  tests document and lock the exact security invariant. **→ folded into AC3 test notes.**

## Design decisions (2026-07-03)

Thomas approved the scope as written. Disposition:

1. **Codex IMPORTANT (test plan doesn't exercise the tag-length invariant)** — **fix.** AC3
   uses wrong-length (truncate/extend) tag cases asserting rejection at both boundaries, plus
   a same-length flip as ordinary tamper coverage. (Folded into the spec.)

This shape is binding on implementation.

## Build note (2026-07-03)

AC → file map:

- **AC1 (pin authTagLength:16)** — `server/src/store/rateCrypto.js` (decrypt),
  `server/src/zoom/appContext.js` (decryptAppContext).
- **AC2 (backward-compatible round-trips)** — existing `server/test/rateCrypto.test.js` +
  `server/test/appContext.test.js` happy-path cases (unchanged, still green).
- **AC3 (wrong-length tag rejected)** — new cases in `server/test/rateCrypto.test.js` and
  `server/test/appContext.test.js` (truncate/extend tag → assert reject).
- **AC4 (scope containment)** — `git diff --name-only main...HEAD`.

## Codex approach review (2026-07-03, base main, HEAD 279e498)

**Verdict: Sound shape — no findings.** Codex's expected solution matched exactly: Node's
built-in `{ authTagLength: 16 }` at the two decrypt sites, encryption/envelope formats
unchanged, direct wrong-length tag tests at both boundaries. No avoidable abstraction or
dependency; uses the existing runtime construct. Codex ran the two target test files
(`node --test server/test/appContext.test.js server/test/rateCrypto.test.js`) → 18/18 pass.

_Empty findings → shape blessed; proceeded to the correctness pass in the same round._
