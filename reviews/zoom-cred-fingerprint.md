Date: 2026-06-04 · Branch: claude/zoom-cred-fingerprint · Status: merged

> Approved by Thomas (2026-06-04): "implement that then /review please" — approved as-is, both open-question defaults accepted (keep the log; helper in oauth.js).

## Problem

Local Test install of the Zoom app fails at token exchange with
`400 {"reason":"Invalid client_id or client_secret","error":"invalid_client"}`.
The `client_id`, `client_secret`, and redirect URI in Railway match the Zoom
Marketplace (Development) credentials character-for-character in both UIs, yet
Zoom rejects the Basic-auth credential pair. `invalid_client` is purely a
client-authentication failure — the authorization code and redirect URI are
irrelevant to it — so the credential values the **live process** sends must
differ from what the UIs display. The two screenshot-invisible causes are
hidden whitespace baked into a stored Railway variable, or a stale value
(variable edited without a redeploy, so the old value is still in memory).

Today's only startup signal is `zoom oauth configured: true`, which checks
presence (`Boolean(id && secret && uri)`) — not correctness. We need a safe way
to inspect the values the running process actually holds, without ever printing
the secret to logs.

## In scope

- A pure helper in `server/src/zoom/oauth.js` that, for `ZOOM_CLIENT_ID`,
  `ZOOM_CLIENT_SECRET`, and `ZOOM_REDIRECT_URI`, reports:
  - character length,
  - a short SHA-256 prefix (first 12 hex chars) of the value,
  - an explicit flag when the value differs from its trimmed form (whitespace),
  - `MISSING` when the value is null/undefined.
- One additional startup log line in `server/src/index.js` emitting that
  fingerprint alongside the existing config line.
- A unit test covering the helper's behavior.

## Non-goals

- No change to the OAuth flow, token exchange, or credential reading.
- Never logging the raw secret (or any raw credential value).
- Not fixing the credentials themselves — this is a diagnostic to locate the
  root cause; the actual fix (re-paste / redeploy) happens in Railway.
- No decision yet on whether the diagnostic stays permanently or is removed once
  the bug is found (tracked as an open question).

## Acceptance criteria

1. `oauth.js` exports a `zoomCredentialFingerprint()` function that returns a
   single string containing a `len=`, `sha=` segment for each of the three
   credentials, and never contains any raw credential value.
2. A value with leading/trailing whitespace is flagged (e.g. `WHITESPACE!`) and
   a clean value is not.
3. A null/undefined credential renders as `MISSING` rather than throwing.
4. The SHA prefix and length for the (non-secret) live values match the
   reference computed independently — `id len=22 sha=1c7b30d7e5c4`,
   `redirect len=65 sha=b08787d46f0c` — and the secret path is covered by a
   synthetic fixture (`len=33 sha=015ea6d692ce`), never a real secret.
   (Revised post-review: the original AC asserted the live secret hash, but
   committing/anchoring on the real secret was the BLOCKER below; the client_id
   and redirect URI are public and stay as the diagnostic reference.)
5. Startup logs print the fingerprint line once, after the existing
   `zoom oauth configured:` line.
6. The gate (`npm test && npm run build`) passes.

## Test notes

- AC1–AC4: a new unit test in `server/test/` calls `zoomCredentialFingerprint`
  (or the underlying fingerprint logic) with controlled env values — clean,
  whitespace-padded, and missing — asserting the output shape, the absence of
  raw values, the whitespace flag, and the `MISSING` rendering. The known-good
  reference fingerprints are asserted by feeding the exact Marketplace values.
- AC5: verified by reading `index.js`; optionally a smoke run of the server
  startup to confirm the line emits once.
- AC6: run `npm test && npm run build`.

## Open questions

1. Keep the fingerprint log permanently (cheap, secret-safe, useful for future
   credential drift) or remove it once `invalid_client` is resolved? Default
   proposal: keep it — it's safe and diagnostic-only.
2. Should the helper live in `oauth.js` (proposed) or a small dedicated
   diagnostics module? Default proposal: `oauth.js`, since it already owns the
   credential reads.

## Build note (2026-06-04)

AC → file map:
- AC1 (exported helper, no raw values): `server/src/zoom/oauth.js` —
  `fingerprint()` + `zoomCredentialFingerprint()`.
- AC2 (whitespace flag): `oauth.js` `fingerprint()` `value !== value.trim()`.
- AC3 (`MISSING` for null): `oauth.js` `fingerprint()` null guard.
- AC4 (reference fingerprints): asserted in
  `server/test/oauthFingerprint.test.js`.
- AC5 (single startup line after config line): `server/src/index.js`.
- AC6 (gate): `npm test && npm run build`.

`git diff --stat main...HEAD`:
```
 reviews/zoom-cred-fingerprint.md     | 78 ++++++++++++++++++++++++++++++++++++
 server/src/index.js                  |  3 +-
 server/src/zoom/oauth.js             | 21 ++++++++++
 server/test/oauthFingerprint.test.js | 59 +++++++++++++++++++++++++++
 4 files changed, 160 insertions(+), 1 deletion(-)
```

## Codex review (2026-06-04, base main, HEAD 5cf869f)

**Summary:** The helper and startup log match the diagnostic shape requested by
the spec, but the branch introduces a security issue by committing the live Zoom
client secret in the new unit test.

### BLOCKER
1. **Raw Zoom client secret committed in test fixture** —
   `server/test/oauthFingerprint.test.js:9`. The new test hard-codes
   `ZOOM_CLIENT_SECRET` and repeats the same raw secret on lines 20 and 32. That
   exposes the actual Zoom Development client secret in source control while this
   feature's purpose is to diagnose credentials without revealing raw credential
   values; merging this would require treating the secret as compromised.
   *Suggestion:* Remove the raw live secret from committed tests. Use synthetic
   fixture values for deterministic helper behavior, or make the known-good
   secret check opt-in via a private env var that skips when absent. Rotate the
   exposed Zoom Development client secret before using it again.

## Decisions (2026-06-04)

- **BLOCKER 1 (live secret in test): FIX (option A).** Thomas: "No worries I
  rotated the secret. Go with A please." Actions taken:
  1. Rewrote `server/test/oauthFingerprint.test.js` to use a synthetic secret
     fixture (`test-secret-not-a-real-credential`, `len=33 sha=015ea6d692ce`);
     the real client_id and redirect URI stay as the diagnostic reference since
     they are public.
  2. Thomas rotated the Zoom Development client secret in the Marketplace
     (exposed secret is now dead).
  3. **Correction (was inaccurate):** A history rebuild was attempted, but the
     workflow guard (`block-main-writes.sh`) blocks force-push, so the rewrite
     could NOT be pushed. Thomas chose **forward-only** instead: the fix landed
     as a normal commit (`43b194a`) on top of `5cf869f`. Consequently the
     secret-bearing commit `5cf869f` is still reachable from HEAD — the raw
     (now-rotated, dead) secret remains in branch *history*, only the tip *tree*
     is clean. This is the residue the re-review flags below.

## Codex review (2026-06-04, base 5cf869f, HEAD e8c1dba)

**Summary:** The test fixture change removes the raw secret from the tip tree and
the synthetic fixture fingerprint matches, but the prior BLOCKER is not fully
resolved because the branch still contains the secret-bearing reviewed commit in
its history despite the (now-corrected) note claiming history was rebuilt.

### BLOCKER
2. **Secret-bearing commit still reachable from HEAD** —
   `reviews/zoom-cred-fingerprint.md`. `git merge-base --is-ancestor 5cf869f
   HEAD` succeeds; `5cf869f` carried the raw Zoom secret in
   `server/test/oauthFingerprint.test.js`, so the branch still carries the
   leaked secret in history even though the tip tree uses a synthetic fixture.
   *Suggestion:* Rebuild from a clean pre-secret base / squash so `5cf869f` is
   not reachable, then force-push; verify `git merge-base --is-ancestor 5cf869f
   HEAD` returns non-zero.
   *Context for disposition:* the secret is already rotated (dead), and Thomas
   chose forward-only because the guard forbids force-push. A **squash-merge** at
   `/close` resolves this cleanly within the guard — the squashed commit on
   `main` equals the tip tree (synthetic fixture only), so `5cf869f` never enters
   `main`'s history and the branch ref (with `5cf869f`) is deleted on merge.

## Decisions (2026-06-04, re-review)

- **BLOCKER 2 (secret commit `5cf869f` reachable from HEAD): RESOLVE VIA
  SQUASH-MERGE.** Thomas chose "Squash-merge at /close (recommended)." `/close`
  must merge PR #6 with `--squash` so `main` receives only the tip tree
  (synthetic fixture; verified 0 occurrences of the old secret in the net
  `main...HEAD` diff), and the feature branch (carrying `5cf869f`) is deleted on
  merge. Stays within the no-force-push guard. The stale "history rebuilt /
  force-pushed" note was corrected above.

## Fixes (2026-06-04)

- **BLOCKER 1 (live secret in test):** already fixed in the prior round —
  synthetic fixture in `server/test/oauthFingerprint.test.js`. No further change.
- **BLOCKER 2 (secret commit `5cf869f` in history):** no code change required;
  resolved by the chosen merge strategy. `/close` merges PR #6 with `--squash`
  so `main` receives only the synthetic-fixture tip tree (net `main...HEAD` diff
  verified to contain 0 occurrences of the old secret), and the feature branch
  carrying `5cf869f` is deleted on merge. Status set to `merged` on the branch so
  the trail lands with the squashed merge.
