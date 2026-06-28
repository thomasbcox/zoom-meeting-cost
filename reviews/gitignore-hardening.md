Date: 2026-06-28 · Branch: claude/gitignore-hardening · Status: approved

## Problem
The repo's `.gitignore` enumerates only two env files (`.env`, `.env.local`) and
no key/certificate material. A real env file with any other suffix
(`.env.production`, `.env.staging`, a per-app `.env`) or any stray private key /
cert dropped into the tree (`*.pem`, `*.key`, `id_rsa`) would not be ignored and
could be committed by accident. The existing `scripts/secret-scan/` guard is a
staged-content backstop; broadening `.gitignore` is the cheaper, first-line
prevention. Harden the patterns so no real env or key material can slip in by
suffix, while keeping the committed `server/.env.example` template visible.

This is the exact block Thomas queued in a prior session:

```
# Env files — ignore all, keep the example template
.env*
!.env.example
!**/.env.example

# Key / certificate material
*.pem
*.key
*.p12
*.pfx
*.keystore
id_rsa*
```

## In scope
- Replace the two narrow env lines (`.env`, `.env.local`) with the broader
  `.env*` + example-template negations.
- Add the key/certificate-material block.
- `.gitignore` only.

## Non-goals
- No new ignore rules beyond the queued block (no coverage/, editor dirs, build
  artifacts, node_modules consolidation, or other tidy-ups — those were offered
  and not chosen).
- No changes to `scripts/secret-scan/` or any product code.
- No untracking of files already in the index.

## Acceptance criteria
1. `.env*` causes all env-file variants to be ignored: `server/.env` and
   `client/.env.local` remain ignored, and a hypothetical `.env.production` /
   `server/.env.staging` would also be ignored.
2. The committed template stays visible: `git check-ignore server/.env.example`
   reports it is **not** ignored (the `!**/.env.example` negation re-includes it),
   and a root-level `.env.example` would likewise not be ignored.
3. The key/certificate block ignores files matching `*.pem`, `*.key`, `*.p12`,
   `*.pfx`, `*.keystore`, and `id_rsa*`.
4. Scope containment: the only file changed is `.gitignore`.
5. The test gate (`npm test && npm run build`) still passes (sanity — a
   `.gitignore` edit should not affect it).

## Test notes
- **AC1:** `git check-ignore -v server/.env client/.env.local` → both matched by
  `.env*`. For the hypothetical variants, `git check-ignore -v .env.production
  server/.env.staging` (paths need not exist) → both matched.
- **AC2:** `git check-ignore server/.env.example` exits non-zero / prints nothing
  (not ignored); `git check-ignore .env.example` likewise not ignored.
- **AC3:** `git check-ignore -v foo.pem bar.key baz.p12 q.pfx r.keystore id_rsa
  id_rsa.pub` → each matched by its respective pattern.
- **AC4:** `git diff --name-only main...HEAD` shows no files beyond `.gitignore`
  (and the spec file `reviews/gitignore-hardening.md`).
- **AC5:** run `npm test && npm run build`.

## Open questions
None — the queued block is the exact, agreed scope.

## Design sketch — HOW
N/A — mechanical. Editing `.gitignore` glob patterns introduces no new module,
data shape, dependency, or cross-cutting pattern. The only correctness nuance is
glob/negation ordering (the `!**/.env.example` negation must follow the `.env*`
ignore, and is needed in addition to `!.env.example` because the tracked template
lives in a subdirectory, `server/.env.example`). That nuance is verified directly
by AC2's `git check-ignore`, not by a design review.

## Codex design review
Noted skip — sketch is `N/A — mechanical` (no design surface to review).

## Design decisions (2026-06-28)
- **Scope:** Thomas approved as scoped ("ye") — implement exactly the queued
  block, `.gitignore` only; the offered extras (artifacts, editor dirs,
  node_modules consolidation, tracked-file audit) are explicitly out.
- **Design findings:** none (Codex review skipped, mechanical). No one-way doors.
