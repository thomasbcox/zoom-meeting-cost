# audit-ci-hygiene — AUDIT-2 (shell) + AUDIT-3

Date: 2026-07-06 · Branch: claude/audit-ci-hygiene · Status: approved

## Problem

The 2026-07-02 repo audit ([audit-2026-07-02.md](audit-2026-07-02.md)) left two CI/audit-hygiene
follow-ups in [BACKLOG.md](../BACKLOG.md):

- **AUDIT-2** — Thomas's estate-wide shell standard (`shellcheck` for correctness, `shfmt -i 2 -ci`
  for format) is **not enforced in CI**. The one non-conforming script,
  `dev-docs/marketing/marketplace-cover.sh`, fails `shfmt -i 2 -ci` (compact one-liners not split,
  continuation-indent). It also currently sits **untracked** (see Open questions).
- **AUDIT-3** — external secret scanners (`gitleaks`, run by `/dev-audit`) flag 3 **synthetic**
  fixtures as leaks. They are intentional fake secrets (repo policy: synthetic fixtures only), so
  every future audit re-reports the same false positives, lowering signal.

This story does the **shell** half of AUDIT-2 plus all of AUDIT-3. The optional `eslint`/`prettier`
JS-lint work named in AUDIT-2 is **deferred to a separate story** (much larger diff: config + a
first-run reformat across all JS + a new CI step).

## In scope

1. Add a shell-lint gate to CI (`.github/workflows/ci.yml`) running `shellcheck` and
   `shfmt -d -i 2 -ci` over the repo's shell files.
2. Reformat `dev-docs/marketing/marketplace-cover.sh` with `shfmt -w -i 2 -ci` so it conforms
   (and, if Thomas approves committing it, track it so CI actually gates it).
3. Add a durable gitleaks allowlist for the 3 synthetic-fixture paths so external secret scans
   stay green:
   - `scripts/secret-scan/detect.test.mjs`
   - `server/test/loadEnv.test.js`
   - `reviews/secret-scan-guardrails.codex.json`

## Non-goals

- `eslint` / `prettier` config and a JS-lint CI step (AUDIT-2 "optional" tail) — **separate story**.
- Any change to the `.githooks/pre-commit` hook (already `shfmt`/`shellcheck`-clean) beyond
  whatever the new CI gate happens to assert on it.
- Committing the broader `dev-docs/marketing/` marketing assets (the `.png` cover, and the
  untracked `docs/image-market-cover.png`) — a marketing decision, out of scope here.
- Reordering / restyling the script's logic; the reformat is `shfmt`-mechanical only.

## Acceptance criteria

1. CI runs `shellcheck` and `shfmt -d -i 2 -ci` over the repo's shell files and **fails** the
   build on any violation.
2. `dev-docs/marketing/marketplace-cover.sh` passes both `shellcheck` and `shfmt -d -i 2 -ci`.
   The two intentional `SC2016` info notes on the `$1,240` / `$18/min` ImageMagick literals are
   silenced by a single inline `# shellcheck disable=SC2016` on the `magick` command (keeps
   default strictness elsewhere).
3. A repo-root `.gitleaksignore` lists the 3 immutable finding fingerprints, and a default-config
   `gitleaks detect` (git-history mode) reports **0** findings.
4. The change touches only: `.github/workflows/ci.yml`, `dev-docs/marketing/marketplace-cover.sh`,
   `dev-docs/marketing/marketplace-cover.png`, `docs/image-market-cover.png` (the two marketing
   assets committed per the scope decision), `.gitleaksignore`, `reviews/audit-ci-hygiene.md`,
   `reviews/audit-ci-hygiene.design.json`, and `BACKLOG.md` (moving AUDIT-2/AUDIT-3 to Done). No
   product code (`client/`, `server/`) is modified.

## Test notes

- **AC1/AC2:** run the exact commands the CI job will run, locally against the tree:
  `shfmt -d -i 2 -ci $(shfmt -f .)` (expect no diff) and `shellcheck $(shfmt -f .)` (expect no
  error-level findings). `shfmt -f .` is shfmt's shell-file finder; in a fresh CI checkout it
  resolves to the tracked shell files. The two `SC2016` notes on the `$1,240` / `$18/min`
  ImageMagick literals are **info** severity (shellcheck exits 0), intentional, and not gated.
- **AC3:** `gitleaks detect --no-banner` (default config = git-history mode, auto-loading the
  repo-root `.gitleaksignore`) exits 0 with 0 leaks. Confirmed the 3 findings live in immutable
  historical commits (`27faeb58`, `9237c73c`, `ab421b3d`), so the fingerprints are stable; removing
  `.gitleaksignore` reproduces exactly the 3 findings (sanity check). Note: `server/.env` is
  gitignored/untracked — a `--no-git` scan flags its local dev secret, but the canonical git-mode
  scan does not; not a repo leak, no action.
- **AC4:** `git diff --name-only main...HEAD` shows no files beyond those enumerated in AC4.

## Open questions

1. **The reformat target is untracked.** `dev-docs/marketing/marketplace-cover.sh` is currently
   `?? untracked` (not gitignored). CI operates on the committed tree, so unless the script is
   **committed**, the new gate never sees it and AUDIT-2's "reformat the script" is a local-only
   no-op. Options:
   - **(A, recommended)** Commit the reformatted `marketplace-cover.sh` (the `.sh` only, not the
     `.png`) as part of this story, so CI genuinely gates it. Smallest change that makes AC2
     meaningful.
   - **(B)** Leave it untracked; scope AUDIT-2's CI gate to the tracked shell files only (today:
     just `.githooks/pre-commit`), and drop the script reformat from this story.
   - **(C)** Commit the whole `dev-docs/marketing/` dir (script + cover PNG). Broadest — pulls in a
     marketing-asset decision I've otherwise marked a non-goal.
2. **gitleaks allowlist mechanism.** `.gitleaksignore` uses per-finding *fingerprints*
   (`commit:file:rule:line`) — brittle, breaks when a fixture's line moves. A repo-root
   `.gitleaks.toml` with `[extend] useDefault = true` and an `[allowlist] paths = [...]` regex list
   is **path-based and durable**. The audit said "`.gitleaksignore` (or per-line allowlist)"; I
   recommend the `.gitleaks.toml` path-allowlist for durability. OK?

## Design sketch — HOW

- **CI (`ci.yml`):** add a second job `shell-lint` (parallel to `test`), `runs-on: ubuntu-latest`.
  `shellcheck` is preinstalled on GitHub's ubuntu runners; `shfmt` is not, so install the pinned
  official binary (`v3.13.1`, matching local) via a `curl` download to `/usr/local/bin`. Steps:
  checkout → install shfmt → `shfmt -d -i 2 -ci $(shfmt -f .)` → `shellcheck $(shfmt -f .)`. Using
  `shfmt -f .` as the file-finder (rather than a hard-coded list) means the gate auto-covers any
  future shell file and needs no maintenance. A non-empty `shfmt -d` diff or a shellcheck
  error-level finding fails the job.
- **ShellCheck policy (per Codex BLOCKER):** default `shellcheck` exits 1 on *any* finding, incl.
  the info `SC2016` notes. Add a single `# shellcheck disable=SC2016` comment on the `magick`
  command line (covers both currency-literal instances, which live in that one multi-line command),
  documenting the intentional single-quoted `$` literals. Keeps default strictness everywhere else.
- **Reformat:** `shfmt -w -i 2 -ci dev-docs/marketing/marketplace-cover.sh` — purely mechanical
  (splits the compact `NAVY=...; DEEPTEAL=...` one-liners, normalizes continuation indent). Verify
  semantics are unchanged by re-reading the diff (it's whitespace/line-splitting only); the script
  itself isn't runnable in CI (needs macOS fonts + ImageMagick) so no execution check. Commit the
  script **and** its rendered `marketplace-cover.png` + `docs/image-market-cover.png` (scope
  decision: commit the whole marketing dir).
- **gitleaks allowlist (per Codex IMPORTANT + history-mode finding):** new repo-root
  `.gitleaksignore` listing the 3 immutable fingerprints:
  ```
  27faeb580080566a34a544151bae952c1e1a8c82:reviews/secret-scan-guardrails.codex.json:private-key:1
  9237c73ca279680a8f9db89e660e249ac707b7e6:scripts/secret-scan/detect.test.mjs:generic-api-key:13
  ab421b3dbb664a800fb3aef4d776b3daf5472e6b:server/test/loadEnv.test.js:generic-api-key:10
  ```
  gitleaks scans git *history*, so all 3 findings are in frozen ancestor commits — inline
  `gitleaks:allow` comments (working-tree-only) cannot suppress them, but fingerprints are
  immutable and **per-finding** (no whole-file blind spot, resolving Codex's IMPORTANT). gitleaks
  auto-loads repo-root `.gitleaksignore`; no `.gitleaks.toml` needed. Verified: exit 0.
- **Backlog:** move AUDIT-2 and AUDIT-3 to `## Done` in `BACKLOG.md`, noting the eslint/prettier
  tail was split out.

## Build note (2026-07-06)

AC → file map:
- **AC1** (shell-lint CI gate: shellcheck + shfmt over `shfmt -f .`) → `.github/workflows/ci.yml`
  (new `shell-lint` job).
- **AC2** (script passes both tools) → `dev-docs/marketing/marketplace-cover.sh` (`shfmt -w`
  reformat + inline `# shellcheck disable=SC2016`).
- **AC3** (gitleaks allowlist, 0 findings) → `.gitleaksignore` (3 immutable fingerprints).
- **AC4** (scope containment) → also `dev-docs/marketing/marketplace-cover.png`,
  `docs/image-market-cover.png` (marketing assets committed per scope decision), `BACKLOG.md`
  (AUDIT-2/3 → Done, split AUDIT-4), and the story/design artifacts. No product code.

## Codex design review (2026-07-06)

**Verdict:** *"The sketch is close but not sound as written. I would not build it this way without
changing the ShellCheck pass/fail policy and narrowing the gitleaks allowlist."* Two findings —
both confirmed empirically.

### BLOCKER — ShellCheck gate fails on accepted info findings _(two-way · nonstandard)_
> `shellcheck $(shfmt -f .)` exits **1** on *any* finding, including the two info-level `SC2016`
> notes on the intentional `$1,240` / `$18/min` ImageMagick literals. The proposed `shell-lint`
> job would be red and AC1/AC2 could not pass. **Verified:** default `shellcheck` → exit 1;
> `shellcheck -S warning` → exit 0. My original Test-notes assumption (info ⇒ exit 0) was wrong.
> - **alternative:** targeted `SC2016` suppression beside the literals, *or* `shellcheck -S warning`
>   to gate only warning/error correctness.
> - **win:** removes a guaranteed CI failure while keeping an explicit shell standard.

### IMPORTANT — Path-only gitleaks allowlist creates whole-file blind spots _(one-way · kludgy)_
> A global `[[allowlists]] paths = [...]` suppresses **every** finding in each listed path, not
> just the 3 known synthetic hits. Two are active test files, so a future *real* token committed
> there would be invisible to `/dev-audit`. The invariant becomes "these files are unscanned"
> instead of "these synthetic strings are allowed."
> - **alternative:** narrower allowlists combining `paths` with `regexes`/`stopwords`/`regexTarget`,
>   or native `gitleaks:allow` line comments.
> - **win:** silences the known false positives while keeping default coverage live on the rest of
>   each file.

## Design decisions (2026-07-06)

Thomas approved scope (shell half of AUDIT-2 + all of AUDIT-3; eslint/prettier deferred to a
separate story) and ratified the following, resolving the Open questions and both Codex findings:

- **Open Q1 — untracked script → Commit whole marketing dir.** Track the reformatted
  `marketplace-cover.sh`, its `marketplace-cover.png`, and `docs/image-market-cover.png`. This
  makes the CI gate genuinely cover the script.
- **BLOCKER (ShellCheck) → fix, inline `disable=SC2016`.** One inline directive on the `magick`
  command; keeps default strictness elsewhere. (Rejected `-S warning`, which would blanket-silence
  future info notes.)
- **IMPORTANT (gitleaks) → fix, `.gitleaksignore` fingerprints.** After finding that all 3 hits are
  in immutable historical commits (so inline `gitleaks:allow` can't work and fingerprints are
  *stable*, not brittle), Thomas approved switching from the sketched path-allowlist/hybrid to a
  `.gitleaksignore` with the 3 fingerprints — narrow per-finding (no whole-file blind spot),
  verified exit 0.

