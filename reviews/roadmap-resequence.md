Date: 2026-06-26 · Branch: claude/roadmap-resequence · Status: approved

## Problem

The project has two planning artifacts that have drifted apart:

- **`dev-docs/roadmap.md`** — the strategic, phased plan (Phase 0–6B). Last meaningfully
  updated **2026-06-11**, so its "Current state — verified from repo" table and several phase
  notes are now **stale**: they list as "❌ none / not built" work that has since shipped, and
  describe code that has since been removed.
- **`reviews/backlog.md`** — the tactical, per-item list. Kept current (DONE markers), but it
  is an unordered pile: it does not say *what to do next*, what blocks what, or which items are
  hard publishing gates vs. nice-to-haves.

Concretely, since 2026-06-11 these shipped (roadmap unaware of all of them):

- **data delete/export** (PR #52) — `DELETE /api/me/data` + `GET /api/me/export` + a neutral
  `uid` registry + the `userData.purgeUser(uid)` primitive. Roadmap still says data delete/export
  is "❌ none (not built)" and proposes a *different* shape (`DELETE /api/rates`).
- **loaded-cost multiplier removed** (PR #49) — roadmap still describes the cost model as
  "per-participant **and** simple `N × rate × multiplier`". The multiplier is gone.
- **`/api/log` redaction-at-source** (PR #50), **header-test order fix** (PR #51),
  **Railway PID-1 graceful shutdown** (merge `2b0954a`).

Net effect: there is no single, trustworthy, *sequenced* answer to "what's next and in what
order." Thomas asked for a roadmap pass that **inventories all outstanding work** (open backlog
items, unfinished features, known futures/gaps), **documents it in one place**, **sequences it
with dependencies and publishing gates called out**, and leaves the project set up for orderly
development.

This is a **planning / documentation story — no product code changes.**

## In scope

- **Reconcile `dev-docs/roadmap.md` with shipped reality.** Refresh the "Current state" table
  and any phase notes that contradict current code/commits as of 2026-06-26 (data delete/export
  shipped; multiplier removed; the recent ops/CI fixes). Code/commits are authoritative; mark
  refreshed rows.
- **Inventory every open item in one place.** Produce a single **authoritative execution plan**
  inside `dev-docs/roadmap.md` (a new/replacement section) that lists every *open* unit of work —
  drawn from `reviews/backlog.md` (non-DONE items) **and** the roadmap's own future phases
  (entitlements, billing, paid features) **and** the keystone overlay live-test gate — mapped to:
  its phase, its dependencies (what must land first), and whether it is a **publishing gate**
  (⛔ blocks Marketplace submission) vs. ongoing/optional.
- **Make the sequence real.** Replace the one-line "Rough sequence" with an ordered plan: the
  critical path to a first launch, plus the parallel tracks (in-Zoom UX hardening, ops/CI,
  cleanup) that don't sit on it.
- **Keep DRY.** The roadmap *references* backlog items by name; it does not copy their full
  descriptions. `reviews/backlog.md` stays the tactical detail store. Cross-link both ways.

## Non-goals

- **No product code.** No endpoints, no client UI, no config — this story only edits planning
  docs.
- **Not building any backlog item.** Each remains its own future `/frame` story.
- **Not re-deciding strategy.** The phase model, the US-only-first / Zoom-native billing
  decision, the privacy invariant, and the one-app-with-entitlements call all stand as recorded.
  This pass *sequences and reconciles*; it does not relitigate decisions Thomas already made.
- **Not rewriting `reviews/backlog.md`'s item descriptions** (e.g. the stale "multiplier
  persists" aside inside the harvest item). Correcting those is a separate tidy — see Open
  questions. The DONE markers there are already accurate.

## Acceptance criteria

1. `dev-docs/roadmap.md`'s "Current state — verified from repo" table reflects 2026-06-26
   reality: data delete/export shown as **shipped** (backend; UI still pending) with the correct
   endpoint shape (`/api/me/data`, `/api/me/export`, `purgeUser`); the cost-model row no longer
   mentions a `multiplier`; the recent ops/CI fixes (PID-1 shutdown, log redaction, header-test)
   are accounted for. Each changed row is marked as refreshed with its date.
2. The roadmap contains a single **"Execution plan"** section that inventories **every open
   item** — each open (non-DONE) `reviews/backlog.md` item, each unbuilt roadmap phase
   (3 entitlements / 4 billing / 5 paid features), and the overlay live-test matrix gate. No open
   item is silently dropped; anything deliberately excluded is named as excluded.
3. Each item in the Execution plan carries: **phase**, **dependencies** (what must ship first, or
   "none"), and a **gate flag** (⛔ publishing gate / 🔧 ongoing / 🧹 cleanup / ✨ feature).
4. The plan states the **critical path** to first launch as an explicit ordered list, and
   separately lists the **parallel tracks** that are not on it.
5. Every backlog item referenced in the plan is linked to `reviews/backlog.md` (or its own review
   file) by name/anchor rather than having its description duplicated; `reviews/backlog.md` gains
   a pointer back to the roadmap's Execution plan as the authoritative sequencer.
6. The diff touches only documentation. `git diff --name-only main...HEAD` shows no files beyond
   `dev-docs/roadmap.md`, `reviews/backlog.md`, and this story file `reviews/roadmap-resequence.md`
   (plus `reviews/roadmap-resequence.design.json` if the design review runs). No product source,
   test, or config files.

## Test notes

- **AC1, AC2, AC3, AC4, AC5:** read-review of `dev-docs/roadmap.md`. Cross-check the refreshed
  current-state claims against the repo: `grep -n multiplier client/src/lib/cost.js`
  (expect none); `grep -n "api/me" server/src/app.js` (expect the delete/export routes);
  `git log --oneline` for the merge commits. Confirm every non-DONE heading in
  `reviews/backlog.md` appears by name in the Execution plan, and every unbuilt roadmap phase is
  represented.
- **AC6 (scope containment):** run `git diff --name-only main...HEAD` and verify no files appear
  beyond those AC6 enumerates. (Per the workflow convention, review artifacts under `reviews/` are
  exempt and expected.)
- No automated gate exercises docs, but the standard gate (`npm test && npm run build`) must
  still pass to prove the docs-only change broke nothing.

## Open questions

1. **One place = which file?** This story makes `dev-docs/roadmap.md` the single authoritative
   *sequencer* and keeps `reviews/backlog.md` as the tactical detail store (DRY: roadmap
   references, backlog details). Alternative: collapse everything into one file. Recommendation:
   keep the two-tier split (it already exists and works) — confirm.
2. **Stale backlog item descriptions.** A few `reviews/backlog.md` item *bodies* contain
   point-in-time asides that are now wrong (e.g. the harvest item says the multiplier "ALREADY
   persists to localStorage" — both the multiplier and localStorage are gone). Out of scope here;
   fold into this pass, or leave for a separate tidy? Recommendation: leave them — correcting
   bodies is detail-store maintenance, not sequencing — but flag it.
3. **Skip the Codex design review?** This is a docs-only planning story with no code shape,
   dependency, or cross-cutting pattern for Codex to judge. Recommendation: treat the design
   sketch as effectively mechanical and **skip** the Codex design pass (note the skip), since it
   reviews code shape, not prose. Confirm.

## Design sketch — HOW

A documentation edit, two files:

- **`dev-docs/roadmap.md`:**
  - *Reconcile the existing "Current state — verified from repo" table* in place — flip the stale
    rows (data delete/export, cost model) and add a short dated reconciliation note pointing at the
    PRs (#49/#50/#51/#52, merge `2b0954a`), mirroring the existing 2026-06-11 reconciliation
    callout style already in the file.
  - *Add one new section, "Execution plan (orderly development)"*, placed near the end beside the
    existing "Recommended MVP cut" / "Rough sequence" (replacing the thin Rough-sequence line). It
    is a **table** — columns: *Item · Phase · Depends on · Gate · Link* — with one row per open
    unit of work, grouped by track (Critical path to launch / In-Zoom UX / Ops & CI / Cleanup /
    Future phases). Below the table, an explicit ordered **critical-path list** and a short
    **parallel-tracks** list. Each *Item* cell names the backlog heading and links to it.
  - Legend reuse: keep the file's existing ✅/🔜/⚠️ legend; add the small gate-flag glyphs
    (⛔/🔧/🧹/✨) used in the plan.
- **`reviews/backlog.md`:** add a one-line pointer at the top — "Sequencing/priority lives in
  `dev-docs/roadmap.md` → Execution plan; this file holds the per-item detail." No item bodies
  changed.

No new structure, dependency, or pattern; the shapes are existing markdown tables and the
existing two-tier docs convention. This is the kind of prose/structure edit the design-review step
treats as mechanical.

## Codex design review

Skipped — docs-only story, no code shape to review (see Open question 3). Confirmed skipped at
the frame consult (2026-06-26).

## Build note (2026-06-26)

AC → file map (docs-only story):

- **AC1** (reconcile "Current state" table + Phase 1 notes to 2026-06-26 reality) — `dev-docs/roadmap.md`
- **AC2** (single Execution plan inventorying every open item) — `dev-docs/roadmap.md`
- **AC3** (each item carries phase · dependencies · gate flag) — `dev-docs/roadmap.md`
- **AC4** (explicit ordered critical path + parallel tracks) — `dev-docs/roadmap.md`
- **AC5** (DRY links; backlog points back to the roadmap sequencer) — `dev-docs/roadmap.md`,
  `reviews/backlog.md`
- **AC6** (scope containment: docs only) — `dev-docs/roadmap.md`, `reviews/backlog.md`, and this
  story file only

## Codex review (2026-06-28, base 98e66b2, HEAD f2e466c) — re-review, correctness-only

**Summary:** *"The approved fixes were applied correctly against 98e66b2. The stale Phase 1
data/API, privacy, and settings-model multiplier claims are reconciled; the backlog-derived
Execution plan rows now link to valid backlog headings with only sequencing metadata left in the
roadmap; the excluded workflow-skill item is explicitly named; and the diff stays
docs/review-artifact only with no product source, test, or config changes. Per instruction, I did
not re-raise the deferred esbuild item."*

**Findings: none (clean).** The deferred esbuild/Vite item (#4) was correctly not re-raised.

## Fixes (2026-06-27)

Applied the approved correctness/approach findings (all docs-only, within the blessed shape):

- **#1 (FIX) — stale claims swept** (`dev-docs/roadmap.md`): Phase 1 "Data/API changes" now says
  delete/export endpoints **shipped** (PR #52) and remaining work is the deauth webhook + UI; the
  "Server persistence vs privacy" cross-cutting note updated to "backend endpoints shipped;
  remaining = UI/policy/deauth/retention"; `multiplier` removed from the proposed `settings` data
  model (noted legacy-ignored, PR #49).
- **#2 (FIX) — Execution plan now DRY-linked**: every backlog-derived row's Item cell is a
  markdown link to its exact `reviews/backlog.md` heading (CSP links to its backlog heading too);
  the keystone/`drawWebView` rows link to `overlay-live-test-matrix.md`; rows trimmed to
  sequencing metadata (phase · deps · gate) rather than copied tactical prose. Fragile intra-doc
  Phase self-links were dropped in favour of the Phase column. **All 14 cross-references verified
  to resolve** via the GitHub slug algorithm.
- **#3 (FIX) — exclusion named**: added an "Excluded (named per AC2)" line linking *Workflow skill
  defects — moved out of this repo* and stating why it's omitted from the sequence.
- **#4 (DEFER) — esbuild/Vite**: backlog body left untouched (per scope decision); the Execution
  plan row now carries a ⚠️ caveat ("likely already satisfied — lock resolves vite 6.4.3 /
  esbuild 0.25.12; confirm + mark DONE separately") so the inventory stays truthful.

## Codex approach review (2026-06-27, base main, HEAD 98e66b2)

**Verdict:** *"Spec-first, I would keep the two-tier split: roadmap as sequencer, backlog as
detail store, with dated current-state reconciliation and linked execution rows. The chosen shape
is directionally right, but it is not yet cleanly DRY or internally reconciled."* — the shape is
**blessed**; all findings are tidies *within* it (no redesign).

### IMPORTANT (3)

1. **Reconciliation leaves stale shipped/removed claims elsewhere in the roadmap** — two-way ·
   dated · `dev-docs/roadmap.md` Phase 1 + cross-cutting + data-model.
   *Claim:* the table now says delete/export shipped and the multiplier is gone, but later
   authoritative sections still say Phase 1 "data/API changes: add DELETE + export endpoints,"
   still say delete/export endpoints are "required," and keep `multiplier` in the proposed future
   `settings` data model — so the doc contradicts its own reconciled current-state.
   *Alternative:* sweep the remaining authoritative sections — rewrite Phase 1 data/API changes as
   UI/privacy-page/deauth follow-up, update the "Server persistence vs privacy" cross-cutting note
   to "backend endpoints shipped; remaining = UI/policy/deauth," and drop `multiplier` from the
   `settings` model (legacy-ignored at most).
   *Win:* eliminates false future work; stops a later story resurrecting a removed field or
   rebuilding shipped endpoints.

2. **Execution plan duplicates backlog detail without stable item links** — two-way · kludgy ·
   `dev-docs/roadmap.md` Execution plan.
   *Claim:* the plan says detail lives in the backlog, but most rows copy tactical descriptions and
   aren't linked to their backlog headings — two prose stores to keep in sync (weakens the
   approved two-tier split / AC5).
   *Alternative:* make each backlog-derived Item cell a link to its backlog heading/review file,
   keep only minimal sequencing metadata in the roadmap, and add an explicit **exclusion row** for
   any backlog heading intentionally omitted (e.g. "Workflow skill defects — moved out of repo").
   *Win:* one detail authority, two-way navigation, no duplicated clauses that can drift.

3. **`esbuild / Vite` bump is sequenced as open but the manifest shows it satisfied** — two-way ·
   dated · `dev-docs/roadmap.md` Execution plan + `reviews/backlog.md`.
   *Claim:* the plan lists the dev-only bump as open, but `client/package.json` pins `vite ^6.4.2`
   and the lockfile resolves **vite 6.4.3 + esbuild 0.25.12** — exactly the backlog item's "done
   looks like." A phantom open item. *(Verified by Claude against the manifest/lock, 2026-06-27.)*
   *Alternative:* mark the backlog item DONE (with manifest evidence) and drop it from the
   Execution plan, or rename it to the actual remaining dependency concern if one exists.
   *Win:* keeps the open-work inventory truthful; avoids a future story on an already-satisfied bump.

## Codex review (2026-06-27, base main, HEAD 98e66b2)

**Summary:** *"Docs/review-artifact only and the relative links exist, but the planning docs do
not yet satisfy the acceptance criteria — the roadmap still contains stale post-reconciliation
claims, the execution plan is not DRY-linked to backlog anchors, and the open-work inventory is
not fully truthful."* These four findings **mirror the approach pass** (same issues, graded
against the ACs); dispositions inherit the approach decisions.

### BLOCKER (2)

1. **Roadmap still contradicts shipped delete/export + multiplier state** — `dev-docs/roadmap.md`
   (Phase 1 data/API line, cross-cutting privacy note ~line 385, `settings` model ~line 397 still
   lists `multiplier`). Fails AC1. *(= approach #1.)*
2. **Execution plan rows not linked to backlog anchors** — `dev-docs/roadmap.md` Execution plan;
   rows are bold text + copied detail rather than links to backlog headings. Fails AC5.
   *(= approach #2.)*

### IMPORTANT (2)

3. **One non-DONE backlog heading silently excluded** — `Workflow skill defects — moved out of
   this repo` (`reviews/backlog.md`) is neither inventoried nor named as excluded. Fails AC2.
   *(Covered by approach #2's approved "add an exclusion row" alternative.)*
4. **esbuild/Vite bump carried as open though the repo already satisfies it** — vite `^6.4.2` /
   lock vite 6.4.3 + esbuild 0.25.12. *(= approach #3, deferred.)*

## Decisions (2026-06-27)

Thomas, on the approach menu: *"Fix #1 & #2, defer #3."* On the consolidated correctness menu
(which mirrored the approach pass): *"looks good"* — confirming the mapping below.

- **A#1 / C#1 — stale claims survive elsewhere in the roadmap → FIX.** Sweep the remaining
  authoritative sections: rewrite Phase 1 "data/API changes" as UI/privacy-page/deauth follow-up,
  update the "Server persistence vs privacy" cross-cutting note to "backend delete/export
  endpoints shipped; remaining = UI/policy/deauth," and drop `multiplier` from the proposed future
  `settings` data model.
- **A#2 / C#2 — Execution-plan rows not DRY-linked → FIX.** Convert each backlog-derived Item cell
  to a markdown link to its `reviews/backlog.md` heading (or owning review file) and trim to
  sequencing metadata.
- **C#3 — "Workflow skill defects" not named as excluded → FIX** (the exclusion-row half of A#2's
  approved alternative). Add an explicit exclusion row linking that heading and stating it is
  excluded because it was moved out of this repo.
- **A#3 / C#4 — esbuild/Vite phantom open item → DEFER.** Keep the backlog body untouched per the
  scope decision (open question 2). To keep the roadmap inventory truthful without touching the
  backlog, add a **one-line caveat** on that Execution-plan row noting it is likely already
  satisfied (lock resolves vite 6.4.3 / esbuild 0.25.12) and should be confirmed + marked DONE
  separately.

## Scope decision (2026-06-26)

Thomas: "i approve the scope" — approved as drafted, with the three recommended dispositions:

1. **One place** — keep the two-tier split: `dev-docs/roadmap.md` is the authoritative
   *sequencer*; `reviews/backlog.md` stays the tactical detail store (DRY).
2. **Stale backlog item bodies** — left out of scope (detail-store maintenance, not sequencing);
   flagged for a possible separate tidy.
3. **Codex design review** — skipped (docs-only; nothing for a code-shape review to judge).
