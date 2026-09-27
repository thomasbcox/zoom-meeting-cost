Date: 2026-09-27 · Branch: claude/retire-codexmodel-key · Status: approved · Class: deployed

Scope approved by Thomas, 2026-09-27: "Approve as proposed". The four criteria as written, risks
R1–R4, and all five regressions with the tightened checks.

## Problem

`.claude/workflow.json` still carries `"codexModel": ""`. The `codexModel` field (and `reviewer`,
which this repo does not carry) was retired on 2026-08-20, when the pushed-context backend was
removed. Codex routing now lives only in the deployed, derived `codex-models.json` table under
`~/.claude/skills/review/`, which is never edited per repo.

The empty value passes today's preflight. It is still residue, for two reasons:

- It invites a future edit that fills it in. The runner stops loudly on any non-empty
  `codexModel`, so that edit would halt the review loop in this repo.
- It misleads a reader into thinking model routing is set per repo, when it lives in one
  global table.

This is the same class of cleanup as OPS-79 in the workflow repo.

**Prelude, already shipped.** This branch could not be cut from GitHub's `main` as it stood.
A 2026-08-07 deletion of a stale copy of the shared reviewer contract (`AGENTS.md`, OPS-25)
had been merged into local `main` but never pushed. Branching from GitHub's `main` would have
brought that stale copy back, and the loop's contract preflight refuses to run with it
present. On Thomas's decision, 2026-09-27, the deletion shipped first as its own PR
([thomasbcox/zoom-meeting-cost#99](https://github.com/thomasbcox/zoom-meeting-cost/pull/99),
merged, all checks green). This branch starts from the result, so its diff is only this story.

## In scope

- Delete the `codexModel` key from `.claude/workflow.json`.

## Non-goals

- No change to `baseBranch`, `branchPrefix` or `testCommand`.
- No change to the deployed runner, its routing table, or any other repo. The sibling rows
  (sudoku-hints, ruleset-sim) are separate stories in their own repos.
- No app, build or deploy change.

## Acceptance criteria

1. `.claude/workflow.json` parses as JSON and contains exactly the three live keys
   (`baseBranch`, `branchPrefix`, `testCommand`), each with the same value as on `main`.
2. From the repo root, `python3 ~/.claude/skills/review/review_runner.py
   --check-codex-model-retired` and `--check-reviewer-retired` both exit 0.
3. The repo's gate (`npm test && npm run build`) is green.
4. No other file is touched. `reviews/retire-codexmodel-key.*` is exempt.

## Test notes

**Risks — what could go wrong that reaches a person:**

- **R1** — The edit leaves the config as invalid JSON (a dangling comma after `testCommand`).
  Every loop step in this repo then stops at its preflight or config read, and no work can go
  through the review loop until someone repairs the file.
- **R2** — The edit changes or drops a live key. The loop then branches from the wrong base,
  names branches wrongly, or runs the wrong gate, or no gate, before a merge that is a
  production deploy.
- **R3** — A file other than the config changes. That change then rides unscoped into the
  production deploy the merge triggers.
- **R4** — The merge ships a build that does not pass. Every merge to `main` redeploys the app.

**Oracle table:**

| AC | Oracle | Mechanism |
|----|--------|-----------|
| 1 | manual | Loop check, run once, after `git fetch origin`. Parse the file with Python's `json`, rejecting duplicate keys, and compare its key set and the three values against `git show origin/main:.claude/workflow.json`, the base the PR merges into. Then confirm `git diff origin/main -- .claude/workflow.json` changes exactly two lines: the `codexModel` line removed, and the trailing comma dropped from the `testCommand` line, with indentation and the final newline untouched. Catches R1 and R2. **Red when:** the file fails to parse (a dangling comma), a key repeats, the key set is not exactly {`baseBranch`, `branchPrefix`, `testCommand`}, any value differs from `origin/main`, or the text diff touches any other line. Not a suite test: the runner's preflight is this config's validator, and it stops loudly on a broken file before every loop step. A copy in this repo's gate would fail the app's deploy CI whenever the workflow protocol changes the config's shape, a change owned elsewhere, and each sibling repo would carry its own copy. |
| 2 | manual | The loop's own preflights, which `/review` step 1 runs and records. Catches R1: both checks stop on unparseable JSON. **Red when:** the file does not parse, `codexModel` holds a non-empty value, or `reviewer` names anything but codex. Honest limit: both checks already pass on `main`, where an empty value is accepted. So this criterion shows the edit introduced no bad value. It cannot show the key is gone; AC1 shows that. |
| 3 | manual | Run the gate once locally, on the final committed state with a clean worktree (`git status --porcelain` empty). CI's required `test + build` check then runs on the PR's final head commit, and the `main` ruleset will not merge without it passing. Catches R4. **Red when:** any test or the build fails. No size is named, because the change touches nothing the suite exercises and CI already enforces the gate, so there is no test to write and no meaningful regression to demonstrate red. |
| 4 | manual | Loop check, after `git fetch origin`: `git diff --name-only origin/main...HEAD -- . ':(exclude)reviews/retire-codexmodel-key.*'` prints only `.claude/workflow.json`. The exclusion covers this story's own files only, so a change to any other file under `reviews/` still shows. Catches R3. **Red when:** any other path appears. |

**Regressions proposed by the step-6 design review.** All five were ratified at the frame consult, 2026-09-27. Each one is answered by the tightened mechanism in the table above:

- **R1** — The edit parses, but leaves a duplicate key (for example two `testCommand` lines
  after the comma edit). Python's `json` silently keeps the last one, so the parse and key-set
  check both pass while the file says two different things to two different readers.
- **R2** — The value comparison runs against a local `main` that is behind the PR's real base
  (the divergence this repo's prelude documents). The check goes green against the wrong base.
- **R3** — The scope check's exclusion of all of `reviews/` hides an unrelated change inside
  that directory (another story's file, a stray artifact from a different round). Something
  unscoped ships while the evidence says nothing did.
- **R4** — The gate is green on a state that is not what merges: run before a final amend, in a
  dirty worktree, or on an earlier PR commit followed by a "harmless" push.
- **AC1 (manual)** — The file parses with the right keys and values, but the deletion leaves
  inconsistent indentation or drops the trailing newline. The next hand edit of this file then
  produces a noisy reformatting diff that can hide a value change from review.

**Coverage:** every risk (R1–R4) received at least one regression. No criterion names a size,
so there is no sized-criterion gap, and step 9's demonstrate-red has nothing to run against.

## Loop record

- frame/6 — ran (codex on kimi-latest, 3 findings, 5 regressions) → /Users/thomasbcox/Projects/zoom-meeting-cost/reviews/retire-codexmodel-key.design.4098560.json
- frame/9 — not yet reached
- review/6 — not yet reached
- review/8 — not yet reached
- close/3b — not yet reached
- close/4 — not yet reached

## Open questions

None.

## Design sketch — HOW

The edit is confined to `.claude/workflow.json`: delete the `"codexModel": ""` line, and the
comma it leaves at the end of the `testCommand` line. It is a hand edit of the text, so the
file keeps its existing 2-space indent, key order and trailing newline. It is not a round-trip
through a JSON library, which could reorder or reformat the file.

No code, dependency or tooling changes. Nothing in this repo reads `codexModel`: `git grep`
finds only the config line itself. The only readers are the deployed runner's preflights,
which treat an absent key and an empty one the same way (both pass). The AC2 evidence is those
preflights, run by the loop itself.

## Codex (kimi-latest) design review (2026-09-27)

**Verdict:** Sound shape. The reviewer endorsed the hand edit over a JSON-library round-trip and
the absence of new code or tooling. Its reservations are in the oracle table, not the edit.

**IMPORTANT**

- **AC1 compares against local `main`, which this repo has already shown can be stale.**
  *two-way · nonstandard.* A comparison against a stale local `main` goes green while checking
  the wrong base. *Alternative:* compare against `origin/main` after a fetch (the base the PR
  merges into). *Win:* the check that carries R2 is anchored to the real base.

**NIT**

- **AC2's oracle is already green before the change.** *two-way · kludgy.* Both preflights
  pass on `main` with the empty value present, so AC2 cannot show the key is gone.
  *Alternative:* drop AC2 as a numbered criterion and fold the preflight run into AC1's
  evidence as a no-regression guard. *Win:* the criteria list becomes exactly what separates
  done from not done.

**QUESTION**

- **Should AC1 be a small durable test in the gate instead of a run-once check?**
  *two-way · standard.* A roughly 10-line `node --test` under `scripts/` would catch R1 and R2
  on every future PR. The reviewer states the counterargument itself: the runner's preflight
  already stops loudly on unparseable JSON, and a suite test would couple this repo's gate to
  a config shape the workflow protocol owns. *Alternative:* add the test, or record in the
  story why the loud preflight stop is enough, so the two sibling repos don't reopen the
  question. *Win:* permanent CI coverage, or one sentence that settles it for all three repos.

## Design decisions (2026-09-27)

Thomas's disposition per design finding. Binding on implementation.

- **IMPORTANT, AC1 base ref: fix.** Checks 1 and 4 compare against `origin/main` after a fetch,
  not against local `main`.
- **NIT, AC2 cannot fail on the change: accept (keep AC2).** AC2 goes red if the edit leaves
  the file unreadable (R1), and it matches the sibling repos' version of this story. AC1
  carries the proof that the key is gone.
- **QUESTION, durable test for AC1: decline, reason recorded.** The reason is in AC1's oracle
  row: the runner's preflight is the config's validator, and a gate test would couple the
  app's deploy CI to a config shape the workflow protocol owns.
- **Regressions:** all five ratified; AC1, AC3 and AC4 mechanisms tightened to match.
