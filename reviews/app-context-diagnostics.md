Date: 2026-07-01 · Branch: claude/app-context-diagnostics · Status: approved

## Problem

Server-side rate persistence is broken in production. Every `/api/rates` request —
both `GET` (load on boot) and `PUT` (debounced save) — returns **401** because
`resolveUid()` throws while verifying the Zoom app context, and `requireIdentity`
catches that error and returns a generic `401 invalid-app-context` while
**discarding the specific reason** (`catch {}`, server/src/app.js:126).

Because the save path swallows the 401 (ratesApi is best-effort), the presenter's
rate-table edits live only in React state for the session and vanish on restart —
the reported symptom. Confirmed from Railway HTTP logs: 100% of `/api/rates` calls
over the last week are 401, so persistence has never worked in production.

The blocker to fixing the root cause is that we cannot tell *which* check throws:
`decrypt failed` (secret mismatch), `unexpected iss`, `aud mismatch`,
`context expired or missing exp`, or `no uid`. A stale `ZOOM_CLIENT_SECRET` is
unlikely — it would also break the OAuth token exchange in louder ways, yet the app
installs and runs. This story adds the missing observability: log the rejection
**reason** server-side (reason string only — never the context blob or the secret)
so the next real-Zoom session yields a definitive cause. It is a diagnostic step,
not the root-cause fix (that is a separate follow-up story once the reason is known).

## In scope

- In `requireIdentity` (server/src/app.js), capture the thrown error and log its
  `AppContextError` reason to stderr with the repo's `[server]` prefix, before
  returning the (unchanged) 401.
- Log the **reason string only** — never the raw `x-zoom-app-context` header value,
  never the Zoom client secret.
- Extend the server test suite to assert the reason is logged, that no sensitive
  material is logged, and that the HTTP response is unchanged.

## Non-goals

- Fixing the root cause (credentials, decryption, or client changes) — that is the
  follow-up once we can read the reason.
- Changing the gate's status codes, response bodies, or the `503 identity-unconfigured`
  behaviour.
- Any client / UI changes (the four side-panel UX items are separate stories).
- Log throttling / rate-limiting, or logging on the success path.

## Acceptance criteria

1. When `requireIdentity` rejects a request because `resolveUid()` throws, the server
   emits exactly one log line, to **stderr**, containing the `[server]` prefix and the
   `AppContextError` reason (e.g. `aud mismatch`, `decrypt failed: …`,
   `context expired or missing exp`, `no uid in context`).
2. That log line never contains the raw `x-zoom-app-context` header value.
3. The HTTP response is unchanged: still `401 { error: 'invalid-app-context' }` — the
   reason is not exposed to the client.
4. The `503 identity-unconfigured` path (missing client id/secret) is unaffected and
   emits no reason log (it returns before the try/catch).

## Test notes

- **AC1/AC2:** New test in `server/test/` — capture `console.error`, `PUT /api/rates`
  with a deliberately malformed `x-zoom-app-context` header (a non-decryptable
  string), assert the captured output has a line starting `[server]` that includes a
  reason token, and that no captured line contains the malformed header value.
  (Reuse the console-capture pattern from `server/test/requestLog.test.js`.)
- **AC3:** Same test asserts `res.status === 401` and the JSON body is
  `{ error: 'invalid-app-context' }` (existing `rates.test.js` already covers the
  401 body; extend/mirror it).
- **AC4:** Test with `ZOOM_CLIENT_ID`/`ZOOM_CLIENT_SECRET` unset → assert `503` and
  that no `[server] app-context rejected` line was emitted.
- **Scope containment:** `git diff --name-only main...HEAD` shows no files beyond
  `server/src/app.js`, `server/test/*`, and `reviews/app-context-diagnostics*`.
- Gate: `npm test && npm run build`.

## Open questions

1. **Log level.** Recommend `console.error` (stderr) to match the `client-error`
   convention in `/api/log` and stand out in Railway. Alternative: `console.log`.
2. **503 path logging.** Recommend leaving the `identity-unconfigured` 503 path
   silent (already distinguishable by its own status + config absence). Confirm.
3. **Follow-up ownership.** Once the reason is known, the actual fix (verify/rotate
   credentials, or a code correction) is a separate story — agreed?

## Design sketch — HOW

- **The change is one catch block.** In `requireIdentity` (server/src/app.js:117),
  change `catch {` → `catch (err) {`, and before `return res.status(401)…` emit:
  `console.error(\`[server] app-context rejected: ${reason}\`)`.
- **Reason safety by construction.** `resolveUid` / `decryptAppContext` throw only
  `AppContextError`, whose `.message` is a fixed reason string (or
  `decrypt failed: <node crypto message>` such as "Unsupported state or unable to
  authenticate data"). None of these embed the input blob or the secret, so logging
  the message is safe. To harden intent, import `AppContextError` and log
  `err instanceof AppContextError ? err.message : 'non-context error'` — so an
  unexpected non-context throw can never spill an arbitrary message.
- **No response change.** The status/body stay `401 invalid-app-context`; the reason
  is server-log-only, never returned to the client (don't help a probe distinguish
  failure modes).
- **No new dependency, no new module.** Reuses the existing `console.*` +
  `[server]`-prefix logging convention (server/src/app.js:84) and the redaction
  discipline already applied to the request logger (path-only, never the secret).
- **Test:** mirror `requestLog.test.js`'s `console.error` capture; drive a malformed
  context through `createApp()` over a real `listen(0)` socket.

## Codex design review (2026-07-01)

**Verdict: Sound design — no findings.** The sketch is local, preserves the existing
401/503 contract, uses the `AppContextError` boundary to avoid logging arbitrary error
messages, and follows the repo's `console` / `[server]` / stderr conventions. The
dependency manifest has no first-party logging/validation dependency that would make a
single diagnostic line more declarative; adding one would be surface without payoff. The
proposed tests match the existing real-socket console-capture style and cover the
invariants: reason present, sensitive header absent, client response unchanged, 503 path
silent.

_No one-way doors; empty finding list → clean pass (needs only a scope nod)._

## Design decisions (2026-07-01)

Thomas: "approve with defaults" — scope approved as written; all three open
questions resolved to the recommended defaults:

1. **Log level:** `console.error` (stderr), matching the `client-error` convention.
2. **503 path:** `identity-unconfigured` stays silent (no reason log).
3. **Follow-up:** the root-cause fix (verify/rotate credentials or code correction),
   once the logged reason is known from a real session, is a separate story.

This shape is now binding on implementation.

## Build note (2026-07-01)

AC → file map:

- **AC1** (reason logged to stderr with `[server]` prefix): `server/src/app.js`
  (`requireIdentity` catch block) · test `server/test/identityLog.test.js`.
- **AC2** (blob/secret never logged): `server/src/app.js` (logs `AppContextError.message`
  only, `instanceof`-guarded) · test `server/test/identityLog.test.js`.
- **AC3** (response unchanged `401 invalid-app-context`): `server/src/app.js` · test
  `server/test/identityLog.test.js`.
- **AC4** (503 `identity-unconfigured` path emits no reason log): `server/src/app.js`
  (503 returns before the try/catch) · test `server/test/identityLog.test.js`.

## Codex approach review (2026-07-01, base main, HEAD f4f45e7)

**Verdict: Sound approach — no findings.** Codex's own AC sketch matched the approved
shape exactly: keep `requireIdentity` as the gate, catch `resolveUid()` failures, log one
stderr line with the `[server]` prefix, derive the reason only from
`AppContextError.message` with a safe fallback, leave the 401/503 contracts unchanged, and
cover reason/redaction/response/503-silent with focused server tests. After reading the
log, diff, full changed files, and manifests, the implementation matches: no new
dependency, no duplicated framework behavior, no new abstraction, no hand-rolled logging
subsystem for a single line. No high-leverage approach concerns.

_Empty findings → shape blessed; proceeded to the correctness pass in the same round._
