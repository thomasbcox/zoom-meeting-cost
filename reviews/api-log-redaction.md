# api-log-redaction

Date: 2026-06-25 · Branch: claude/api-log-redaction · Status: approved

> **Approved 2026-06-25** — Thomas: prevent-at-source; keep `userAgent`; "yes bump dates in all
> relevant docs." Open questions resolved below.

> Story 2 of 3 in the "step-2 quick wins" batch. Story 1 (remove-cost-multiplier) shipped
> (PR #49). Story 3 — fix the order-fragile header test — follows as its own `/frame` story.
>
> **Slug is historical.** The backlog item was "redact `/api/log` payloads server-side"; after
> discussion (2026-06-25) the approach changed to **prevent-at-source / data minimization** —
> the client never sends participant PII, so there is nothing to redact. The branch keeps the
> `api-log-redaction` name; the work is minimization.

## Problem

`server/src/app.js`'s `/api/log` handler logs the submitted body **verbatim**. Today the client
can put Zoom-provided personal data into that pipeline:

- **`zoom-diagnostics` probe** (`client/src/zoom/zoomDiagnostics.js`) — its `entries[].result`
  holds the **raw `getUserContext`** (screen name, role, possibly email) and **raw
  `getMeetingParticipants`** (participant display names) results. This is the only *designed*
  PII sender. It is gated off by default (`shouldRunDiagnostics` needs `VITE_USE_ZOOM=1` **and**
  `?diag=1`) — a deliberately-triggered in-Zoom recon/debug tool — but when run it ships real
  names to the logs (and the browser console).
- **`client-error`** (`client/src/lib/reportError.js`) — spreads an arbitrary `...detail` bag
  plus `url` (`location.href`, which can carry query params). Incidental risk: not designed to
  carry PII, but nothing constrains it.
- **`lifecycle`** and **`zoom-overlay`** are already safe by contract (event names, instance
  ids, key-name shapes, `{method, ok, error}` / geometry — no names/values).

**Chosen approach (2026-06-25): prevent at source, not server redaction.** Data minimization —
don't put PII into the log pipeline — is the cleaner control: smaller code, easier maintenance
(no per-field allowlist to keep in sync and silently rot), and a stronger privacy claim ("the
app doesn't send participant PII to logs" rather than "we scrub it after"). We deliberately do
**not** add a server-side redaction layer; the server keeps logging verbatim because its inputs
are now clean by construction.

The data-retention and security policies currently say these logs are **"not separately
redacted today"** and "may include … participant" data. That framing becomes inaccurate under
the new approach, so the docs are updated in this story.

Tracked in [`reviews/backlog.md`](backlog.md) ("Redact `/api/log` payloads server-side").

## In scope

**Client — stop sending PII (prevent at source):**

- **Shape-only diagnostics probe** (`client/src/zoom/zoomDiagnostics.js`). Replace each entry's
  raw `result` with a **structural shape summary** via a new pure helper `describeShape(value)`:
  - object → `{ type: 'object', keys: [...] }` (key *names* only — e.g. `screenName`, `role` —
    never values);
  - array → `{ type: 'array', length, of: <shape of first element> }` (recursion depth-capped);
  - string → `{ type: 'string', length }` (**never the string value** — this is the invariant
    that makes a name/email structurally impossible to emit);
  - number / boolean → `{ type, value }` (non-PII; useful recon such as counts/flags);
  - null / undefined / other → `{ type }`.
  Entries become `{ method, ok, shape }` / `{ method, ok, error }`. The probe keeps its debug
  value (you still learn "5 participants, each `{screenName, participantId, role}`") with no
  PII. The browser-console print (`defaultLog`) is now clean too, since it logs the shaped
  bundle.
- **Allowlisted client-error payload** (`client/src/lib/reportError.js`). Add a pure
  `buildClientErrorPayload(detail)` that copies only a fixed field set —
  `source, message, stack, filename, lineno, colno, componentStack, userAgent` — reduces `url`
  to its **pathname** (query stripped, mirroring the server's request-log policy), and length-
  caps the free-text fields (`stack`, `componentStack`, `message`). `reportClientError` uses it
  instead of spreading `...detail`. Still `kind: 'client-error'`; still never throws.
- `lifecycle` / `zoom-overlay` are reviewed as non-PII by contract and **unchanged**.

**Server — no change.** `server/src/app.js` `/api/log` continues to log the body verbatim; its
inputs are now clean by construction. (If demonstrable enforcement is ever required — e.g. for
Marketplace review — the lean option is a single *structural* sink invariant, "log only known
kinds and never nested objects," noted here but **not** built. We are not adding a per-field
allowlist.)

**Docs — make them accurate about the new approach:**

- `dev-docs/policies/data-retention-and-protection.md` — replace the "not separately redacted
  today / may include participant data" framing (table row + Operational logs paragraph) with
  the prevent-at-source description: client diagnostics are constructed to exclude participant
  PII; the diagnostics probe transmits only data-*shape* summaries, not values; error reports
  carry only error text + a fixed technical field set.
- `dev-docs/policies/security-policy.md` — same correction to its operational-logs bullet.
- `docs/privacy.html` — add a short, honest **Operational logging** note (the policy is
  currently silent on it): the app sends minimal error/diagnostic telemetry that excludes
  participant names and individual values; bump the **Effective date** to 2026-06-25.
- **Bump the dated header/effective date in every touched doc** (Thomas: "bump dates in all
  relevant docs") — `data-retention-and-protection.md`, `security-policy.md`, and
  `docs/privacy.html` — to 2026-06-25, so each doc's date reflects this revision.
- `reviews/backlog.md` — (a) reframe the "Redact `/api/log` payloads server-side" item to record
  that prevent-at-source was chosen over server redaction (DONE-marking happens at `/close`),
  and (b) **add** a new backlog item: *"Retire the shape-only diagnostics probe once stable"*
  (delete the recon probe entirely once the overlay/in-Zoom work no longer needs it).

**Tests:** `client/src/zoom/zoomDiagnostics.test.js`, `client/src/lib/reportError.test.js`.

## Non-goals

- **No server-side redaction layer / no per-field allowlist** (explicitly rejected in favor of
  minimization). `server/src/app.js` is untouched.
- **Not retiring the diagnostics probe now** — kept shape-only; retirement is backlogged.
- **No pattern-scrubbing of error message/stack text.** We keep error messages and stacks
  (standard practice, essential for debugging). The residual risk that a *thrown exception's
  own text* could embed a value is accepted and noted; it is not something the app constructs.
- No change to `/api/log` routing, status (204), or what payload `kind`s exist.
- No new dependency.

## Acceptance criteria

1. **Probe is shape-only:** `runZoomDiagnostics` against an SDK whose `getUserContext` returns
   `{ screenName: 'Jane Q. Participant', role: 'host' }` and `getMeetingParticipants` returns
   `[{ screenName: 'Jane Q. Participant', participantId: 'p1' }]` produces entries with **no
   `result`** and a `shape` field; `JSON.stringify(entries)` contains **none** of the string
   values (no `'Jane Q. Participant'`) while still showing structural recon (the key name
   `'screenName'` and the array length).
2. **`describeShape` pure + value-blind:** unit-tested for object (keys, no values), array
   (length + element shape), string (length only, value absent), number/boolean (value kept),
   null/undefined, and nested/odd input — and it never throws and is depth-bounded.
3. **client-error allowlist:** `buildClientErrorPayload` keeps `source, message, stack,
   filename, lineno, colno, componentStack, userAgent`; **drops** any non-allowlisted field
   (e.g. an injected `email` / `participants`); reduces `url` to its pathname (no query string);
   and length-caps `stack`/`componentStack`/`message`. Pure + testable.
4. **reportClientError uses it:** the payload emitted to the injected log sink is the
   allowlisted shape (no arbitrary `...detail` spread), still `kind: 'client-error'`, and the
   function never throws.
5. **Server untouched:** `server/src/app.js` is not modified; `/api/log` still routes
   `client-error` → stderr and other kinds → stdout as a single-line `[client-log] …` string
   with a 204 (existing `server/test/clientLog.test.js` stays green, unedited).
6. **Docs accurate:** the two policy docs no longer claim logs are "not separately redacted"
   and instead describe prevent-at-source minimization; `docs/privacy.html` has an honest
   Operational-logging note; `reviews/backlog.md` reframes the redact item and adds the
   retire-probe item; and the dated header/effective date in each touched doc
   (`data-retention-and-protection.md`, `security-policy.md`, `docs/privacy.html`) reads
   2026-06-25.
7. **Gate green:** `npm test && npm run build` passes.
8. **Scope containment:** the diff touches only the files enumerated in *In scope*.

## Test notes

- AC1 / AC2 — `client/src/zoom/zoomDiagnostics.test.js`: drive `runZoomDiagnostics` with a mock
  SDK returning seeded PII; assert entries carry `shape` not `result`, and the serialized
  bundle excludes the seeded name string but includes key names + lengths. Direct
  `describeShape` unit cases for each type, nesting, depth cap, and non-throwing on null/odd
  input.
- AC3 / AC4 — `client/src/lib/reportError.test.js`: `buildClientErrorPayload` keeps/drops the
  right keys and strips the url query; `reportClientError` (with an injected `log`) emits the
  allowlisted payload and an injected extraneous field does not appear. Existing reporter tests
  stay green.
- AC5 — `server/test/clientLog.test.js` runs unchanged and green; `git diff` shows no change to
  `server/src/app.js` or that test.
- AC6 — read the four docs; verify the old framing is gone / the new notes are present and the
  privacy effective date is 2026-06-25.
- AC7 — run `npm test && npm run build` (the configured gate).
- AC8 — run `git diff --name-only main...HEAD` and verify no files appear beyond those listed
  in *In scope*.

## Decisions (from discussion, 2026-06-25)

1. **Prevent-at-source over server redaction** — data minimization; smaller, more maintainable,
   stronger privacy claim; no per-field allowlist to rot.
2. **Keep the probe shape-only for now**, backlog its full retirement once stable.
3. **Docs in scope** — bring the policies, public privacy page, and backlog up to date.

## Resolved (2026-06-25)

1. **`userAgent` in client-error** — **kept** (Thomas). Standard error-reporting context; not
   individually identifying.
2. **Dates** — **bump in all relevant docs** (Thomas), not just privacy.html: the two policy
   docs and the public privacy page all get a 2026-06-25 date. Shipping the public-page edit
   with this story is approved.

## Build note (2026-06-25)

AC → file map:

- **AC1 / AC2** (shape-only probe; pure `describeShape`, value-blind, depth-bounded) →
  `client/src/zoom/zoomDiagnostics.js`
- **AC3 / AC4** (allowlisted `buildClientErrorPayload`; `reportClientError` uses it) →
  `client/src/lib/reportError.js`
- **AC5** (server untouched) → no change to `server/src/app.js` (verified by `git diff`)
- **AC6** (docs accurate; dates 2026-06-25) →
  `dev-docs/policies/data-retention-and-protection.md`,
  `dev-docs/policies/security-policy.md`, `docs/privacy.html`, `reviews/backlog.md`
- **Tests** → `client/src/zoom/zoomDiagnostics.test.js`, `client/src/lib/reportError.test.js`

## Codex review (2026-06-25, base main, HEAD 726d919)

**Summary:** Reviewed the diff, log, and spec. Branch is scoped to the expected files and
leaves the server log sink untouched. Two IMPORTANT findings on the minimization/docs
guarantees. (Codex couldn't run `npm test` in its read-only sandbox — Vite `.vite-temp` write
EPERM; the gate was run here and is green, and PR #50 CI is green on this HEAD.)

**Findings:**

- **IMPORTANT — Allowlisted fields can still carry arbitrary nested payloads**
  (`client/src/lib/reportError.js:36`). `buildClientErrorPayload` allowlists top-level *keys*
  but copies any non-string value for an allowed key verbatim. A caller-supplied object/array
  under `message`/`stack`/`filename`/`lineno`/`colno`/`componentStack` would still be serialized
  to `/api/log`; since the server logs verbatim, this leaves a path for participant PII to ride
  through an allowed key and weakens the prevent-at-source invariant. *Suggestion:* normalize by
  expected type — cap/coerce string fields, keep only finite numbers for `lineno`/`colno`, drop
  arrays/objects/functions rather than copying them.

- **IMPORTANT — Privacy note overstates the telemetry guarantee** (`docs/privacy.html:115`).
  The new public note says telemetry "never includes participant names or individual values,"
  but the implementation intentionally preserves runtime error text (`message`, `stack`,
  `componentStack`); the spec accepts the residual risk that a thrown exception's text may
  contain a value, so the absolute public claim is inaccurate for `client-error` telemetry.
  *Suggestion:* qualify — diagnostics record only shapes/no values, while error reports are
  minimized to error text plus fixed technical fields and do not include arbitrary participant
  payloads.

- BLOCKER: 0 · IMPORTANT: 2 · QUESTION: 0 · NIT: 0

## Decisions (2026-06-25)

- **Finding ① — Allowlisted fields can carry nested payloads — FIX** (Thomas, after confirming
  low risk/cost). Type-normalize each allowlisted field in `buildClientErrorPayload`: text
  fields (`source`, `message`, `stack`, `filename`, `componentStack`) kept only as
  length-capped strings; `lineno`/`colno` kept only as finite numbers; objects/arrays/functions
  dropped. Tightens the prevent-at-source invariant from "top-level keys" to "scalars only," so
  no nested participant payload can ride an allowed key.
- **Finding ② — Privacy note overstates the guarantee — FIX, contingent on ①** (Thomas: "if we
  go with your suggestion then 2 is ok, but only then"). With ① fixed, the only residual is
  error *text*, so the note is accurate when qualified: diagnostics record only shapes (no
  values); error reports are minimized to error text plus a fixed set of technical fields, with
  no arbitrary participant payloads. ② is accurate ONLY because ① removes the nested-payload
  path — they ship together.

## Fixes (2026-06-25)

Applied both approved Codex findings:

- **① (nested payloads under allowed keys):** `client/src/lib/reportError.js` —
  `buildClientErrorPayload` now normalizes each field by expected type: string fields kept only
  if a string (length-capped), `lineno`/`colno` only if a finite number; objects/arrays/
  functions are dropped, not copied. The invariant is now "scalars only," so no nested
  participant payload can ride an allowed key. Added tests in `reportError.test.js`.
- **② (privacy note overstated):** `docs/privacy.html` — the Operational-logging note no longer
  claims telemetry "never includes … individual values." It now distinguishes diagnostics
  (shape only, no values) from error reports (error text + a fixed set of technical details, no
  participant data) — accurate now that ① removes the nested-payload path.

## Build note (2026-06-25, re-review)

Re-review of the fix delta only (base = last-reviewed SHA 726d919). Files changed since:

- **① fix** → `client/src/lib/reportError.js` (scalar-only normalization) +
  `client/src/lib/reportError.test.js` (added scalar-only / finite-number tests)
- **② fix** → `docs/privacy.html` (qualified Operational-logging note)

## Codex re-review (2026-06-25, base 726d919, HEAD 8039c39)

**Summary:** Re-reviewed only the fix delta (`git diff 726d919...HEAD`). **Finding ① is
correctly resolved** — the scalar-only `buildClientErrorPayload` drops nested
objects/arrays/functions under allowlisted keys and keeps only finite numeric line/column
values, with focused tests. **Finding ② is improved but not fully resolved** — one new
IMPORTANT below.

**Findings:**

- **IMPORTANT — Privacy note still overstates the error-report guarantee** (`docs/privacy.html`).
  The revised note says error reports "do not include participant names or other meeting data,"
  but the fix intentionally still forwards string `message`/`stack`/`componentStack` (length-
  capped only). A thrown error's own text could still contain a participant name — the spec
  accepts this as residual risk — so the public note should not promise it's impossible.
  *Suggestion:* keep the diagnostics/no-values claim, but qualify the error-report sentence:
  error reports are limited to error text plus fixed technical fields and do not **attach**
  arbitrary participant payloads or meeting-data fields.

- BLOCKER: 0 · IMPORTANT: 1 · QUESTION: 0 · NIT: 0
  (Prior ① — scalar-only client-error — verified resolved; not re-raised.)

## Decisions (2026-06-25, re-review round)

- **Privacy note still overstates error-report guarantee — FIX** (Thomas). Qualify the
  `docs/privacy.html` error-report sentence: keep the diagnostics "shape only / no values" claim,
  but change the error-report wording from "do not include participant names or other meeting
  data" to a promise the implementation actually backs — error reports are limited to error text
  plus a fixed set of technical details and do not **attach** participant or meeting-data fields
  (we don't promise the free-form error text can never contain a value — the accepted residual).
- (Prior ① scalar-only client-error fix: verified resolved last round; no further action.)
