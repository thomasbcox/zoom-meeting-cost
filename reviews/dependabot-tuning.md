Date: 2026-06-21 · Branch: claude/dependabot-tuning · Status: approved

Approved 2026-06-21 by Thomas ("yes to all"): tune dependabot.yml (ignore react/react-dom/
express majors, group github-actions), write the dated dependency-review report, close PRs
#42/#43. Defaults confirmed: `@zoom/appssdk` updates flow but flagged "review each"; hold
React 19 + Express 5, take dev-deps/Actions/minor-patch/security; report at
`dev-docs/dependency-review.md`.

## Problem
Dependabot's first run (after the CI + Dependabot config shipped in `security-program`)
opened **7 PRs at once**, dominated by unwanted **major-version** bumps — `express 4→5`
(closed: breaking, failed CI), `react`/`react-dom 18→19`, and major GitHub-Actions bumps —
plus a dev-dependencies group. There are **no open security alerts** (the 3 alerts are
dev-tooling — `vite`/`esbuild` — and already satisfied by our installed versions). Dependabot
is working correctly; it's just configured to propose deliberate, breaking upgrades as
auto-PRs and fired a salvo.

We want to (a) **quiet Dependabot** so it proposes the right things going forward, and
(b) produce a **written, reasoned dependency-decision record**: what to upgrade and why, what
to hold and why holding is safe.

## In scope
1. **Tune `.github/dependabot.yml`:**
   - Add `ignore` for **major** updates on `react`, `react-dom`, and `express` — deliberate,
     breaking upgrades we drive by hand, not via auto-PR. Minor/patch + security updates for
     them still flow.
   - **Group** `github-actions` updates into a single PR (kills the 3-PR salvo).
   - Keep the existing single root npm entry, weekly cadence, and dev-dependencies group.
   - Effect on next Dependabot run: the `react`/`react-dom` major PRs become ignored (auto-
     closed), and the individual Actions PRs consolidate into one grouped PR.
2. **Dependency review report — `dev-docs/dependency-review.md`:** a dated snapshot covering
   every runtime, dev, and CI-action dependency — current version, latest/proposed, a
   recommendation (**upgrade now / hold**), and the rationale **and safety reasoning** for
   each. Explicitly addresses all 7 first-run PRs (#38–#44).
3. **Close the won't-take PRs now:** `react` #42 and `react-dom` #43 (major). (`express` #44
   already closed.) Leave the dev-deps and Actions updates per the report's recommendation.

## Non-goals
- **No runtime dependency upgrades in this story** — `package.json` / `package-lock.json` are
  untouched. This story tunes config + writes the decision record; actually merging the
  recommended-safe updates (dev-deps #41, the grouped Actions PR) is done via those PRs'
  own CI/ruleset-gated merges, not here.
- No React 19 / Express 5 migration — explicitly deferred, with rationale in the report.
- No change to `@zoom/appssdk` handling beyond what the report recommends (see Open
  questions — it's pre-1.0 and the core integration).

## Acceptance criteria
1. `.github/dependabot.yml` is valid and: ignores **major** updates for `react`, `react-dom`,
   `express`; groups `github-actions`; retains the single root npm entry, weekly schedule,
   and dev-dependencies group.
2. `dev-docs/dependency-review.md` exists and, for each dependency below, gives current
   version, recommendation (upgrade now / hold), rationale, and a safety note:
   - runtime: `@zoom/appssdk`, `react`, `react-dom`, `express`
   - dev: `vite`, `vitest`, `@vitejs/plugin-react`, `npm-run-all`
   - CI actions: `actions/checkout`, `actions/setup-node`, `github/codeql-action`
   It explicitly states the disposition of each first-run PR #38–#44.
3. PRs #42 and #43 are `CLOSED` (verified via `gh pr view`).
4. No runtime dependency version changed: `git diff main...HEAD` does not touch
   `package.json`, `client/package.json`, `server/package.json`, or `package-lock.json`.
5. Gate green (`npm test && npm run build`).
6. Scope containment: `git diff --name-only main...HEAD` shows only
   `.github/dependabot.yml`, `dev-docs/dependency-review.md`, and this story file.

## Test notes
- AC1: parse the YAML; confirm the `ignore` blocks (update-type `version-update:semver-major`)
  and the `github-actions` group.
- AC2: read the report; confirm every listed dependency + PR has a recommendation + safety
  note.
- AC3: `gh pr view 42 --json state` / `gh pr view 43 --json state` → `CLOSED`.
- AC4/AC6: `git diff --name-only main...HEAD`.
- AC5: run the gate.

## Open questions
1. **`@zoom/appssdk` (pre-1.0, `^0.16.38`).** Pre-1.0 *minor* bumps can be breaking, but it's
   the core Zoom integration we want to keep current. Default: **let all its updates through**
   (review each PR), do **not** add an ignore rule — flagged as "review carefully" in the
   report. OK, or treat it more conservatively?
2. **Confirm the holds.** Default recommendation: **hold** React 19 and Express 5 (stay on
   18 / 4); **take** the dev-deps group, the grouped Actions updates, and any minor/patch +
   security updates. The report will justify each. Agree, or upgrade any of the held ones?
3. **Report location/lifespan.** `dev-docs/dependency-review.md` as a dated snapshot we
   refresh periodically — OK, or prefer a different home?
