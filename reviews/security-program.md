Date: 2026-06-21 · Branch: claude/architecture-diagram · Status: approved

Approved 2026-06-21 by Thomas ("do it"): expand the architecture-diagram branch to make
"Yes" on SSDLC + SAST truthfully supportable — CodeQL + Dependabot, an internal policy
set + a public Security page + SECURITY.md, and a server-enforced `main` ruleset (enabled
post-merge). Contact = thomas+mcsupport@txl-lab.com. No SOC2/ISO/pen-test/DAST claims.

## Problem
The Zoom Marketplace security questionnaire asks whether we have a secure SDLC, run
SAST/DAST, and have supporting policy documents. Today we can only truthfully say:
SSDLC **No** (real practices, but undocumented), SAST **No** (no scanner configured),
pen-test **No**, and we can attach only the Privacy Policy. This story expands the
current branch (which already adds the architecture diagram + README stack section) to
put **real, documented controls** in place so we can answer **Yes** to SSDLC and SAST
*with evidence*, and attach the recommended policy documents.

The hard rule: every claim must be **true**. We add controls that genuinely exist; the
documents describe what we actually do — no SOC 2/ISO 27001, no pen-test claims, no
aspirational "24/7 SOC" boilerplate. (3rd-party pen testing stays **No**.)

## In scope
1. **SAST — GitHub CodeQL.** Add `.github/workflows/codeql.yml` (JavaScript/TypeScript,
   on push + PR to `main` + a weekly schedule). Once it has run, "Does the app undergo
   SAST?" is a truthful **Yes**, with the Code Scanning results + workflow + run history
   as evidence.
2. **Dependency management — Dependabot.** Add `.github/dependabot.yml` (npm for the
   workspaces + github-actions, weekly). Real control behind the dependency policy.
3. **SSDLC document** — `dev-docs/policies/ssdlc.md`: the actual lifecycle —
   feature-branch + PR workflow, mandatory independent review and green test gate before
   merge, pre-commit secret-scanning hook, CodeQL SAST and Dependabot in CI, encrypted-
   at-rest data, least-privilege secrets via env vars. Accurate to current practice.
4. **Internal policy documents** (concise, small-operator-sized, in `dev-docs/policies/`),
   one per questionnaire line so they map 1:1 — the detailed operational set you attach as
   evidence:
   - `security-policy.md`
   - `vulnerability-management.md`
   - `data-retention-and-protection.md`
   - `incident-response.md`
   - `dependency-management.md`
   Each: scope, the actual controls, owner = Transformative Leadership Lab LLC, security
   contact `thomas+mcsupport@txl-lab.com`, and a review cadence. Privacy Policy already
   exists (public) and is referenced, not duplicated.
5. **External public Security page** — `docs/security.html` (styled like the rest of the
   legal site, served by GitHub Pages): a customer/reviewer-facing summary of the program
   (secure development, encryption, data handling, disclosure contact), linking the public
   Privacy Policy. This is the "external" half of the internal/external split.
6. **`SECURITY.md`** at the repo root — vulnerability-reporting contact + supported scope
   (the conventional, public coordinated-disclosure file); links the Security page.
7. **`main` ruleset (enforced branch protection).** Enable a GitHub repository ruleset on
   `main` via `gh api`: require a pull request before merge, require the CodeQL code-scanning
   check to pass, and block force-pushes + branch deletion. Turns the "mandatory review +
   protected base branch" SSDLC claim into a server-side-enforced control.
8. **README** — link the policy set + the Security page and note CodeQL/Dependabot/ruleset.

## Non-goals
- No SOC 2 / ISO 27001 (we don't have them — never claim them).
- No 3rd-party penetration test (answer stays **No**).
- No DAST (no dynamic scanner; we will not claim DAST — the SAST "Yes" stands on CodeQL).
- No application code / logic changes; no dependency upgrades in this story (Dependabot
  will propose those later as its own PRs).
- The `main` ruleset will require the CodeQL check — which only starts producing results
  after the workflow's first run on GitHub. The ruleset is configured so it does not
  deadlock the merge of this very story (see Open items / sequencing).

## Acceptance criteria
1. `.github/workflows/codeql.yml` exists, scans JS/TS, triggers on push + PR to `main`
   and a weekly cron, and is a valid workflow (parses; uses `github/codeql-action`).
2. `.github/dependabot.yml` exists with npm (workspace dirs) + github-actions ecosystems.
3. `dev-docs/policies/ssdlc.md` exists and describes only controls that actually exist
   (PR workflow, review + test gate, secret-scan hook, CodeQL, Dependabot, encryption at
   rest, env-var secrets). No claim of SOC2/ISO/pen-test/DAST.
4. These exist in `dev-docs/policies/`: `security-policy.md`, `vulnerability-management.md`,
   `data-retention-and-protection.md`, `incident-response.md`, `dependency-management.md`
   — each names the entity, a security contact, scope, controls, and a review cadence.
5. `SECURITY.md` exists at repo root with a reporting contact and supported scope.
6. `docs/security.html` exists — a public Security page matching the legal-site style,
   summarizing the program and linking the Privacy Policy; well-formed standalone HTML
   linking `styles.css`, no external resources, no JS.
7. No document asserts SOC 2, ISO 27001, penetration testing, DAST, or any control not
   actually in place. (Manual read + grep for those terms confirms only truthful usage.)
8. README links the policy set + Security page and notes CodeQL + Dependabot + ruleset.
9. `main` ruleset enabled (verified via `gh api repos/{owner}/{repo}/rulesets`): requires a
   PR, requires the CodeQL check, blocks force-push + deletion. (Enabled last, post-merge,
   per sequencing.)
10. Scope containment: `git diff --name-only main...HEAD` shows only the prior diagram/
    README commit's files plus those enumerated above and this story file.
11. Gate green (`npm test && npm run build`) — app build unaffected; CodeQL runs in CI,
    not the local gate.

## Test notes
- AC1/AC2: parse the YAML; confirm triggers/ecosystems; (CodeQL's first real run happens
  on GitHub after merge — note that "Yes" is truthful once it has run at least once).
- AC3–AC7: read each doc; grep the `dev-docs/policies/` set + `SECURITY.md` +
  `docs/security.html` for `SOC ?2|ISO ?27001|penetration|pen test|DAST` and confirm each
  hit is a truthful negative ("we do not currently…"), never a false positive claim.
- AC9: after the post-merge enablement, `gh api repos/{owner}/{repo}/rulesets` shows the
  `main` ruleset with the PR + CodeQL requirements.
- AC10: `git diff --name-only main...HEAD`.
- AC11: run the gate.

## Decisions (resolved 2026-06-21)
1. **Security contact:** `thomas+mcsupport@txl-lab.com` (existing support address).
2. **Two-tier docs:** detailed internal set in `dev-docs/policies/` (questionnaire
   evidence) **plus** an external public Security page `docs/security.html` + `SECURITY.md`.
   Note: the repo is **public**, so `dev-docs/` is world-readable too; the split is about
   audience/polish, not access control.
3. **Rulesets verified AVAILABLE** (repo is public → free). Enable a `main` ruleset
   (require PR, require the CodeQL check, block force-push + deletion) — in scope (AC).

## Open items / sequencing
- CodeQL's first run happens on GitHub after the workflow lands on `main`. So the SAST
  "Yes" and the ruleset's required-check both become live **after** the first merged run.
  Plan: merge this story (CodeQL runs once), then enable the ruleset requiring that check.
  The ruleset step is the last action so it never blocks merging this story itself.

## Build note (2026-06-21)
AC → file map:
- AC1 CodeQL SAST → `.github/workflows/codeql.yml`
- AC2 Dependabot → `.github/dependabot.yml`
- AC3 SSDLC → `dev-docs/policies/ssdlc.md`
- AC4 policy set → `dev-docs/policies/{security-policy,vulnerability-management,data-retention-and-protection,incident-response,dependency-management}.md`
- AC5 SECURITY.md → `SECURITY.md`
- AC6 public Security page → `docs/security.html`
- AC7 honesty (no false SOC2/ISO/pen-test/DAST) → all docs above
- AC8 README links → `README.md`
- AC9 `main` ruleset → enabled post-merge via `gh api` (needs CodeQL's first run)
- AC10/AC11 scope + gate

Branch also carries the architecture-diagram work (`dev-docs/meeting-cost-architecture.{svg,png}` + README stack section). Codex reviews the full branch vs `main`.

## Codex review (2026-06-21, base main, HEAD 306720f)
**Summary:** Scope + prohibited-assurance checks pass (no app logic/identifier changes; all
SOC2/ISO27001/pen-test/DAST mentions are negatives). But several security docs make claims
contradicted by the code/infra — should not merge as written.

### BLOCKER
1. **False "no third-party data processors" claim** — `README.md` (+ architecture SVG,
   public page). Railway/GitHub/Zoom *are* sub-processors (the security policy lists them),
   so "no third-party data processors" is internally contradictory. Fix: say no processors
   *beyond* the named infra providers; no analytics/advertising/sale. Align README, SVG,
   security.html, policies (+ privacy page if it repeats it).
2. **Key-rotation guidance risks data loss** — `dev-docs/policies/incident-response.md`.
   Rotating `RATE_STORE_KEY` makes every stored config undecryptable (key derived from it,
   no versioning, decrypt-fail → null). Fix: document that rotation resets all stored
   configs (needs user notification) or a dual-key re-encryption migration; distinguish from
   safely-rotatable Zoom credentials.
3. **Logs not scrubbed as claimed** — `dev-docs/policies/data-retention-and-protection.md`.
   `/api/log` writes the submitted JSON body verbatim (diagnostics include raw Zoom SDK
   results). No redaction exists. Fix: accurately document what logs may contain (or add
   server-side redaction — larger, separate).
4. **False "GitHub runs CI (tests)" claim** — `dev-docs/policies/dependency-management.md`.
   Only CodeQL runs in CI; `npm test`/`build` is not a GitHub check, and the ruleset
   requires only CodeQL. Fix: add a test/build CI workflow + require it, or revise docs to
   describe tests as a locally-enforced pre-merge step.

### IMPORTANT
5. **Dependabot splits the root workspace lockfile** — `.github/dependabot.yml`. One npm
   workspace rooted at `/` with one root lockfile; the `/client` + `/server` jobs target
   dirs without lockfiles and overlap the root job. Fix: one npm entry for `/` + the
   github-actions entry.

Last-reviewed SHA: 306720f

## Decisions (2026-06-21)
Thomas: "fix all" — all five approved to FIX, with the recommended approaches:
- **BLOCKER 1** — FIX: qualify the "no third-party data processors" claim in `README.md`
  and the architecture SVG (and regenerate the PNG) to "none beyond Railway/GitHub/Zoom".
- **BLOCKER 2** — FIX: rewrite `incident-response.md` so rotating `RATE_STORE_KEY` is
  described as resetting all stored configs (last resort, user notice), distinct from
  safely-rotatable Zoom credentials.
- **BLOCKER 3** — FIX: make `data-retention-and-protection.md` truthful about logs (no
  scrubbing today; describe content/retention/access) **and** flag a backlog item to add
  real `/api/log` redaction (separate code story).
- **BLOCKER 4** — FIX via **add a CI workflow** (`.github/workflows/ci.yml`: `npm ci && npm
  test && npm run build`) and require it in the `main` ruleset; align the docs. Tests
  become a real GitHub-enforced gate.
- **IMPORTANT 5** — FIX: one npm Dependabot entry for `/` + the github-actions entry.

## Fixes (2026-06-21)
Applied the five approved Codex findings:
- **B1** — `README.md` + architecture SVG (+regenerated PNG): replaced the flat "no
  third-party data processors" claim with "providers are Railway/GitHub/Zoom; no other
  processors, analytics, advertising, or sale." Now consistent with the policy set.
- **B2** — `incident-response.md`: rewrote secrets-rotation guidance — Zoom credentials
  rotate safely; `RATE_STORE_KEY` rotation makes all stored configs unreadable (last resort,
  user notice) or requires a dual-key re-encryption migration. Containment step updated.
- **B3** — `data-retention-and-protection.md` + `security-policy.md` + `ssdlc.md`: removed
  the false "logs are scrubbed" claim; documented that `/api/log` is not redacted today and
  may contain Zoom meeting context. Added a backlog item to add real `/api/log` redaction
  (`reviews/backlog.md`).
- **B4** — added `.github/workflows/ci.yml` (`npm ci && npm test && npm run build`) so the
  test/build gate runs in GitHub CI; aligned `dependency-management.md` + `ssdlc.md` and the
  README; the `main` ruleset will require both CodeQL and CI checks.
- **I5** — `.github/dependabot.yml`: collapsed to one npm entry for `/` (the workspace root /
  sole lockfile) + the github-actions entry.

## Codex review (2026-06-21, base 306720f, HEAD c6662f2) — re-review
**Summary:** Changes limited to docs, workflows, Dependabot config, review artifacts, and the
regenerated PNG; no application logic changed. Four of five fixes resolved.

### IMPORTANT
1. **security-policy.md still omits CI from the ruleset requirement** — `dev-docs/policies/security-policy.md`.
   B4 updated README/SSDLC/dependency-management to "ruleset requires CodeQL **and CI**", but
   the security policy's access-control line still says "PR + passing CodeQL required". Since
   this set is the questionnaire evidence, it should match.

Last-reviewed SHA: c6662f2

## Decisions (2026-06-21, re-review)
Thomas: apply the **proper (DRY) fix**, not the one-liner. Root cause = the merge-gate's
required checks were duplicated across six docs with no source of truth (one drifted).
- **FIX (DRY):** make `ssdlc.md` § Merge control the single canonical statement that
  enumerates the exact required checks (CodeQL + CI). Generalize the other docs
  (`security-policy.md`, `dependency-management.md`, `README.md`, `docs/security.html`) to
  the *stable* intent ("a PR and all required status checks must pass") + a reference to
  SSDLC, so the volatile check list lives in exactly one prose place. `vulnerability-management.md`
  (passing mention) left as-is.
- **Backlog:** ruleset-as-code (`.github/rulesets/main.json` + a drift check) so the enforced
  config becomes the real single source of truth — filed, not done now.
