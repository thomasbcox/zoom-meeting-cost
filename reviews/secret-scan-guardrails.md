# secret-scan-guardrails

Date: 2026-06-04 · Branch: claude/secret-scan-guardrails · Status: approved

> **Approved (2026-06-04, Thomas):** "approve - implement and then /review."
> Accepted the three defaults: self-contained scanner, guarded postinstall,
> pre-commit only.

Backlog **#2** (Secret-leak guardrails), scope **A + B**. Prompted by a live Zoom
client secret previously committed/pushed in a test fixture (Codex caught it; the
secret was rotated). Defense-in-depth so a secret in a diff can't reach the remote.

## Problem

The repo has only a behavioral guard against committing secrets (memory:
`feedback-no-real-secrets-in-repo`) — nothing mechanical. A secret in a staged diff
can still be committed and pushed. Two backstops are missing:

- **A. No local pre-commit scan.** Nothing blocks a commit whose staged diff
  contains a secret — the strongest lever, because it catches the secret *before
  it ever enters a commit*, on the developer's machine.
- **B. GitHub is blind to generic secrets.** Push protection is enabled, but
  `secret_scanning_non_provider_patterns` is **disabled**, so GitHub's server-side
  push protection won't catch a generic secret like a Zoom client secret (only
  recognised provider tokens). One repo-setting flip closes that gap.

Current GitHub state (verified): repo is **public**, `secret_scanning` enabled,
`secret_scanning_push_protection` enabled, `secret_scanning_non_provider_patterns`
**disabled**. `gitleaks` is **not installed** on the machine.

## In scope

**A — local pre-commit secret scan (self-contained, no external binary):**
- A tracked `.githooks/pre-commit` that scans the **staged** diff and exits
  non-zero (blocking the commit) when a likely secret is found, printing the
  offending file/line and how to allowlist a deliberate fixture.
- The detection logic lives in a standalone, unit-tested Node module
  (`scripts/secret-scan/detect.mjs`, exporting `findSecrets(text, opts)`), so it
  runs in the test gate independently of git. Patterns cover at minimum: PEM
  private-key blocks, AWS-style access keys, and high-entropy values assigned to
  secret-named identifiers (e.g. `*_secret`, `client_secret`, `api_key`, `token`,
  `password`).
- An **allowlist convention** so intentional synthetic fixtures pass: a line
  carrying an inline `pragma: allowlist secret` marker is skipped. Existing
  fixtures (`test-secret-not-a-real-credential`, `SECRET123`, etc.) must continue
  to pass — they are low-entropy/descriptive; markers added only where needed.
- **Activation:** a guarded `postinstall` in the root `package.json` sets
  `git config core.hooksPath .githooks` **only** inside a git work tree (skips CI /
  Railway / tarball builds with no `.git`). Documented in `README.md`.

**B — enable GitHub non-provider secret-scanning patterns:**
- Flip `secret_scanning_non_provider_patterns` to `enabled` for the repo via
  `gh api`, and verify it reads back `enabled`. Record before/after in the build
  note. (Explicitly authorised by Thomas; reversible.)

**Folded-in slight scope increase (per Thomas):**
- In `reviews/backlog.md`, replace the **"Workflow skill defects — /close merge
  gate + status lifecycle"** entry with a one-line pointer noting it was exported
  to its own story (`~/workflow-skill-defects.story.md`) for the skills repo — it
  doesn't belong in this project's backlog.

## Non-goals

- **C** (CI gitleaks Action on PRs) — deferred (backlog #2 keeps it as optional).
- A **pre-push** hook — pre-commit is the primary lever this story delivers;
  pre-push (scanning the push range) can be a follow-up.
- Requiring/installing the `gitleaks` binary — using a self-contained scanner
  avoids a system dependency and keeps the detector unit-testable in the gate.
- Scanning git history for pre-existing secrets (this guards *new* diffs).
- Marking backlog #2 itself DONE — that's a `/close`-time / follow-up bookkeeping
  step, not part of this implementation diff.

## Acceptance criteria

1. `scripts/secret-scan/detect.mjs` exports `findSecrets(text, opts)` returning the
   matches (with line numbers + rule) for secret-shaped content, and an empty
   result for clean content. Unit-tested with **synthetic** inputs only.
2. The detector flags, in tests: a PEM `BEGIN ... PRIVATE KEY` block, an
   AWS-style `AKIA…` key, and a high-entropy value assigned to a secret-named
   identifier — and does **not** flag clean code or the repo's existing low-entropy
   synthetic fixtures.
3. A line carrying `pragma: allowlist secret` is skipped by the detector
   (allowlist convention), verified by test.
4. `.githooks/pre-commit` runs the detector over the staged diff and exits
   non-zero when a secret is detected, zero otherwise; it prints the offending
   file/line and the allowlist hint. Verified by an integration test that runs the
   hook/scan against a staged synthetic secret (blocked) and clean content (passes).
5. Root `package.json` `postinstall` sets `core.hooksPath` to `.githooks` only when
   run inside a git work tree (no-op when `.git` is absent), so the hook activates
   on `npm install` without breaking CI/Railway builds. `README.md` documents the
   guardrail + allowlist marker.
6. The detector unit + integration tests run inside the existing gate
   (`npm test`) — i.e. the root `test` script is extended to include them — and the
   full gate stays green.
7. `secret_scanning_non_provider_patterns` is `enabled` on the GitHub repo.
   **Implementation deviation (2026-06-04):** the REST API accepts a PATCH (HTTP
   200) but silently leaves the field `disabled` — confirmed feature-gated, not a
   permissions issue (a sibling sub-field no-ops identically under a full-`repo`
   token). Enablement therefore requires the GitHub **UI** (repo *Settings → Code
   security → Secret scanning → "Scan for non-provider patterns"*) — a one-click
   manual step for Thomas, consistent with this project's established pattern that
   GitHub dashboard config is a manual step. The attempted `gh api` command + the
   200-but-unchanged result are recorded in the build note; this AC is **pending
   Thomas's one-click toggle** (or his decision to defer B). Part A is unaffected.
8. `reviews/backlog.md`'s skill-defects entry is replaced by the one-line export
   pointer; no other backlog entry changes.

## Test notes

- **AC1–3** — `scripts/secret-scan/detect.test.mjs` (node:test): synthetic
  positives flagged with correct line numbers; clean strings, the existing-fixture
  strings, and `pragma: allowlist secret` lines all pass. No real credentials.
- **AC4** — integration test stages/feeds a synthetic secret to the scan entry
  point and asserts non-zero exit + message; feeds clean content and asserts zero.
- **AC5** — `postinstall` guarded by `git rev-parse --is-inside-work-tree`;
  verified by reading the script (and that `npm install` in-repo wires
  `core.hooksPath`). README diff reviewed.
- **AC6** — root `test` script extended (e.g. append `node --test scripts/secret-scan/`)
  so `npm test` (the gate's command, unchanged) covers the new tests.
- **AC7** — `gh api repos/:owner/:repo` shows `non_provider: disabled` before and
  `enabled` after; commands + outputs pasted in the build note.
- **AC8** — read `reviews/backlog.md`; only the skill-defects entry changed.

## Open questions

1. **Scanner approach** — self-contained Node regex/entropy scanner (recommended:
   no system dependency, detector is unit-testable in the gate, portable) vs.
   requiring the `gitleaks` binary (stronger rules, but adds an install step and
   isn't gate-testable without the binary). _Default: self-contained._
2. **Hook activation** — guarded `postinstall` auto-sets `core.hooksPath`
   (recommended: zero-friction, activates on `npm install`) vs. an explicit
   `npm run setup-hooks` the developer runs once (less magic, but easy to forget).
   _Default: guarded postinstall._
3. **Hook scope** — pre-commit only (recommended) vs. pre-commit **and** pre-push.
   _Default: pre-commit only; pre-push as a possible follow-up._

## Build note (2026-06-04)

AC → file map:
- **AC1–3** detector + tests: `scripts/secret-scan/detect.mjs`, `scripts/secret-scan/detect.test.mjs`
- **AC4** hook + runner + integration test: `.githooks/pre-commit`, `scripts/secret-scan/scan-staged.mjs`, `scripts/secret-scan/detect.test.mjs`
- **AC5** activation + docs: `package.json` (postinstall), `README.md`
- **AC6** gate wiring: `package.json` (`test` script)
- **AC7** GitHub non-provider (deviation — manual UI step): `README.md`, spec note
- **AC8** backlog pointer: `reviews/backlog.md`

`git diff --stat main...HEAD` (substantive files; the story file + `.codex.json` are this story's workflow trail):
```
 .githooks/pre-commit                  | (new) pre-commit hook
 README.md                             | secret-scanning section + accurate B note
 package.json                          | test-gate wiring + guarded postinstall
 reviews/backlog.md                    | skill-defects entry → export pointer
 scripts/secret-scan/detect.mjs        | (new) findSecrets() detector
 scripts/secret-scan/detect.test.mjs   | (new) unit + integration tests
 scripts/secret-scan/scan-staged.mjs   | (new) staged-diff hook runner
```

**Gate:** `npm test && npm run build` green — secret-scan tests run inside `npm test`.

**Live verification of Part A:** the pre-commit hook blocked a staged synthetic
secret (`assigned-secret`), passed clean content, and caught a PEM literal in the
test file during a real commit (fixed by assembling the fixture at runtime). The
implementation commit itself passed the hook.

**Part B (AC7) — deviation:** `secret_scanning_non_provider_patterns` is feature-
gated; the REST PATCH returns HTTP 200 but leaves it `disabled` (a sibling sub-field
no-ops identically under a full-`repo` token), so it is **not** settable via API.
Recorded attempt:
```
$ printf '{"security_and_analysis":{"secret_scanning_non_provider_patterns":{"status":"enabled"}}}' \
    | gh api -X PATCH repos/thomasbcox/zoom-meeting-cost --input - --jq '.security_and_analysis.secret_scanning_non_provider_patterns.status'
disabled            # before: disabled; after PATCH (HTTP 200): still disabled
```
Enablement is a one-click GitHub UI toggle (Thomas's manual step).

## Codex review (2026-06-04, base main, HEAD d0da3e5)

**Summary:** The branch adds the requested local hook, detector, docs, and
test-gate wiring, and the new secret-scan tests pass. Four issues to fix before
relying on it: the hook shells staged filenames, the detector misses encrypted PEM
headers and quoted JSON-style secret keys, and the AC4 test doesn't exercise the
real git hook path.

### IMPORTANT
1. **Hook shells staged filenames** (`scripts/secret-scan/scan-staged.mjs:37`) —
   `readStagedBlob` interpolates a staged filename into a shell command; a filename
   with shell metacharacters could execute commands when the hook runs (worse
   because `postinstall` auto-enables it). _Fix:_ `execFileSync('git', ['show',
   `:${file}`])`; consider `git diff -z` + NUL parsing.
2. **Encrypted PEM private keys missed** (`scripts/secret-scan/detect.mjs:51`) —
   `PEM_RE` doesn't match `-----BEGIN ENCRYPTED PRIVATE KEY-----`. _Fix:_ broaden to
   `-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----`; add a synthetic test.
3. **Quoted JSON secret keys missed** (`scripts/secret-scan/detect.mjs:47`) —
   `ASSIGN_RE` requires the secret name directly before `:`/`=`, so
   `"client_secret": "<high-entropy>"` is ignored (closing quote precedes the colon).
   _Fix:_ allow optional quotes around the key name; add a synthetic test.
4. **AC4 doesn't test the real hook path** (`scripts/secret-scan/detect.test.mjs:68`)
   — the test calls `scanFiles` with an in-memory object, never validating
   `.githooks/pre-commit`, `runHook()`, `stagedFiles()`, `readStagedBlob()`, exit
   code, or the stderr message. _Fix:_ temp-git-repo integration test invoking the
   hook/runner, asserting exit codes + output.
