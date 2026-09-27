Date: 2026-09-27 · Branch: claude/ignore-review-temps · Status: approved · Class: deployed

Scope approved by Thomas, 2026-09-27: "Approve A as proposed". The six criteria as written, risks
R1–R5, and the five builder-written regressions; the design review is skipped as mechanical.

## Problem

On 2026-09-27 the review runner (`~/.claude/skills/review/review_runner.py`, on a
`--run-codex` call from this repo) printed this warning:

> this repo does not ignore review publish temps (.<slug>.design.<sha>.json.probe.tmp style).
> A round killed mid-publish can leave one behind, and `git add -A` would commit it.
> Add `reviews/.*.tmp` to .gitignore.

How the temp arises: the runner publishes each review artifact by writing it to a
dot-prefixed temp file in `reviews/` (named `.<artifact>.<random>.tmp`), then renaming it
into place. If the round is killed between those two steps, no cleanup runs and the temp is
left behind. Nothing ever reads it, because every reader asks for an artifact by its exact
filename. The only harm is that git sees it as an ordinary untracked file. Thomas's
checkpoint discipline runs `git add -A`, which stages every untracked file, so the next
checkpoint would commit the stray temp. Once that commit is merged, removing the file from
history means rewriting `main`, which the ruleset protects.

The runner cannot fix this itself. The ignore rule belongs in each repo's own `.gitignore`,
and the workflow installer does not deploy one. Before the edit, both a dummy
`reviews/.x.tmp` and a file named the way the runner names a real temp were listed by
`git status --porcelain` as untracked (`??`), so the risk is live today.

## In scope

- Add one rule, `reviews/.*.tmp`, to `.gitignore`, with a one-line comment saying what it
  is for.

## Non-goals

- No change to the runner, its temp naming, or any other repo. The same warning in another
  repo is that repo's own story.
- No change to any existing `.gitignore` rule.
- No clean-up of stray temps. None exists: the main checkout's `reviews/` has no dot-files,
  and none is tracked.
- No app, build or deploy change. The merge still redeploys production, because
  `railway.json` sets no watch paths. The deployed code is identical.

## Acceptance criteria

1. `.gitignore` carries the rule `reviews/.*.tmp`, and git ignores any dot-prefixed `.tmp`
   file directly in `reviews/`. This covers the runner's real publish temps
   (`.<artifact>.<random>.tmp`) and the probe name its warning checks
   (`.<artifact>.probe.tmp`). Neither appears in `git status --porcelain`, and
   `git add -A` would not stage either.
2. No file the review trail keeps is ignored. Every file tracked under `reviews/` today is
   untouched by the rule. A new story file or round artifact (`reviews/<slug>.md`,
   `reviews/<slug>.<purpose>.<round>.json`) still shows up as untracked.
3. Every existing `.gitignore` rule behaves as it does on `main`. The change adds lines and
   removes or alters none.
4. The runner's warning does not print on the next `--run-codex` call from this branch.
5. The repo's gate (`npm test && npm run build`) is green.
6. No other file is touched. `reviews/ignore-review-temps.*` is exempt.

## Test notes

**Risks — what could go wrong that reaches a person:**

- **R1** — The rule does not match the names the runner actually writes. A killed round's
  temp then still gets committed by the next checkpoint, and once merged it can only be
  removed by rewriting protected `main`.
- **R2** — The rule is too broad and hides a real review-trail file. `git add -A` then
  silently never commits a story or a review artifact, and the audit trail loses a record
  with no error anywhere.
- **R3** — The runner keeps printing the warning after the fix. Every future round then
  carries a false alarm, and a warning people learn to skip stops protecting anyone.
- **R4** — The edit disturbs an existing rule. The worst case is the `.env*` or
  key-material block: an env file or private key becomes committable, and the next
  checkpoint's `git add -A` could put a secret into history.
- **R5** — The production redeploy the merge triggers ships something other than this
  change: a build that does not pass, or an unscoped file riding along.

**Oracle table:**

| AC | Oracle | Mechanism |
|----|--------|-----------|
| 1 | manual | Loop check, run once on the committed state. Create three files in `reviews/`: Thomas's dummy `.x.tmp`, a real-shaped temp `.ignore-review-temps.design.abc1234.json.k3j9x_q2.tmp` (the runner's `mkstemp` shape), and the probe name `.ignore-review-temps.design.abc1234.json.probe.tmp`. Then confirm that `git status --porcelain --untracked-files=all` lists none of them, and that `git add -A --dry-run` would stage none of them. Next, `git check-ignore -v` on each must name `.gitignore:<line>:reviews/.*.tmp` as the matching rule, so the result comes from this repo's file and not a machine-local exclude. Delete all three afterwards. Catches R1. **Red when:** any of the three is listed by status or dry-run, or check-ignore attributes it to anything but the new line. **Observed red before the edit (2026-09-27):** the first two dummies were listed as `??`. Not a suite test: the runner itself re-runs an equivalent `git check-ignore` probe on every round, and its warning is the standing guard. |
| 2 | manual | Loop check, run once. `git ls-files reviews/ \| git check-ignore --no-index -v --stdin` must print nothing. It asks git whether any tracked review file matches any ignore rule, and it reads git's own index as the complete list, not a hand-picked sample. Then create an untracked `reviews/zz-probe.md` and `reviews/zz-probe.design.abc1234.json`, confirm both appear as `??` in `git status --porcelain`, and delete them. Catches R2. **Red when:** check-ignore prints any tracked file, or either new real-shaped file fails to appear. |
| 3 | manual | Loop check, after `git fetch origin`. `git diff origin/main -- .gitignore` contains added lines only, with no `-` line. Then run one `git check-ignore -v --no-index --non-matching` over a fixed path list, once with the `origin/main` `.gitignore` (captured before the edit) and once after. The list is `.env`, `server/.env.local`, `.env.example`, `client/.env.example`, `x.pem`, `id_rsa`, `a.keystore`, `.claude/settings.local.json`, `node_modules/x`, `dist/x`, `debug.log`, `.DS_Store`. The two outputs must be byte-identical: every path keeps the same ignored/not-ignored answer and the same matching rule. The example templates must stay un-ignored. Catches R4. **Red when:** the diff has any removed line, or the before and after outputs differ in any line. Line numbers do not shift, because the new rule is appended at the end. |
| 4 | manual | Two checks, both reading **stderr**, where the warning is printed. The runner's stdout carries only the artifact path. (a) A free pre-check before any paid round: from this worktree, import the runner and call its `warn_if_temp_uncommittable` on a would-be artifact path in this repo's `reviews/`. It must return `True` and print nothing. (b) `/review`'s first `--run-codex` call from this branch has its stderr captured and searched for `does not ignore review publish temps`. Catches R3. **Red when:** (a) returns `False` or prints the warning, or (b)'s stderr contains the string. Honest limit: the main checkout at `~/Projects/zoom-meeting-cost` sits on `main`. It keeps warning until this merges and that checkout is updated. |
| 5 | manual | Run the gate once locally, on the final committed state with a clean worktree (`git status --porcelain` empty). CI's required `test + build` check then runs on the PR's final head commit, and the `main` ruleset will not merge without it. Catches R5 (failing build). **Red when:** any test or the build fails. No size is named: nothing the suite exercises reads `.gitignore`, and CI already enforces the gate. |
| 6 | manual | Loop check, after `git fetch origin`: `git diff --name-only origin/main...HEAD -- . ':(exclude)reviews/ignore-review-temps.*'` prints only `.gitignore`. The exclusion covers this story's own files only, so a change to any other file under `reviews/` still shows. Catches R5 (unscoped file). **Red when:** any other path appears. |

**Regressions — written by the builder, not the reviewer.** The design sketch below is
`N/A — mechanical`, so the step-6 design review, which normally proposes these, is skipped.
Each names the risk it targets and the check above that must catch it.

- **R1** — The rule is fitted to the name the warning mentions, e.g. `reviews/.*.probe.tmp`.
  That silences the runner (AC4 goes green), but the real temps are
  `.<artifact>.<random>.tmp` and stay committable. AC1's real-shaped dummy is what catches
  this. A check using only the probe name would pass.
- **R2** — An over-broad rule, e.g. `reviews/*`, or `reviews/*.*` from a slipped dot.
  Both hide every story and artifact. AC2 catches both twice over: the `--no-index` sweep
  prints every tracked review file, and the new `zz-probe.md` fails to appear.
- **R3** — The AC4 check reads stdout, which is where a shell capture like `ART="$(...)"`
  looks. The warning goes to stderr, so a stdout check is green whatever the rule says.
  AC4 names stderr explicitly for this reason.
- **R4** — The new line is appended to a file with no trailing newline and fuses with the
  last rule: `.claude/settings.local.jsonreviews/.*.tmp`. That silently un-ignores
  `settings.local.json`, and the new rule matches nothing. AC3's "no removed line" and its
  `settings.local.json` probe both catch it. The file does end in a newline today; the risk
  is the edit, not the starting state.
- **R5** — The gate is green on a state that is not what merges: run before a final amend,
  in a dirty worktree, or on an earlier PR commit. AC5 runs on the final committed state
  with a clean tree, and CI re-runs it on the PR's head.

**Coverage:** every risk (R1–R5) has at least one regression. No criterion names a size, so
step 9's demonstrate-red has nothing to run against. AC1 was observed red before the edit
anyway, as recorded above.

## Loop record

- frame/6 — n/a — design sketch is `N/A — mechanical` (one appended ignore rule; no new structure, pattern or dependency), so no design review ran; the builder wrote the regressions instead, as Test notes says
- frame/9 — not yet reached
- review/6 — not yet reached
- review/8 — not yet reached
- close/3b — not yet reached
- close/4 — not yet reached

## Open questions

None.

## Design sketch — HOW

N/A — mechanical. One rule appended to `.gitignore` under its own comment, in the file's
existing style (a `#` header line, then the pattern). The pattern `reviews/.*.tmp` contains
a slash, so git anchors it to the repo root, where `reviews/` lives. It matches only
dot-prefixed `.tmp` files directly in `reviews/`, which is the only place the runner
writes its temps. No real trail file starts with a dot or ends in `.tmp`. No code,
dependency or tooling change.
