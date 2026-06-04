Date: 2026-06-04 · Branch: claude/zoom-cred-fingerprint · Status: approved

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
4. The SHA prefix and length for the known-good Development values match the
   reference computed independently:
   `id len=22 sha=1c7b30d7e5c4`, `secret len=32 sha=eaf5da8397e7`,
   `redirect len=65 sha=b08787d46f0c`.
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
