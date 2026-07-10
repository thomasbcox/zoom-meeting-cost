# docs-consistency-sweep — docs accuracy sweep + track deferred follow-ups

Date: 2026-07-09 · Branch: claude/docs-consistency-sweep · Status: approved

## Problem

The recent product shift (Simple mode is now the default for everyone; non-hosts are locked to
Simple; role-gating; empty-prompt count; participant-fetch breadcrumb) left several docs stale, and
the removed `multiplier` field is still documented in three places. Two known-but-deferred
follow-ups also aren't tracked anywhere durable. A discovery audit (read all docs, cross-checked
against the code) produced the concrete findings below.

## In scope

Fix the audited findings (MUST + SHOULD + NIT) and record the two deferred follow-ups.

**BACKLOG:**
1. Add the two deferred follow-ups to `BACKLOG.md` (Open): the panel-close-stops-counting meter
   re-architecture (**BUG-1**) and the participant self-heal retry poll (**OPS-1**).

**MUST-FIX (factually wrong / contradicts shipped behavior):**
2. `README.md` — lead with Simple-as-default for everyone + hosts/co-hosts can opt into
   per-participant + non-hosts are Simple-locked; stop framing the per-person rate table as the
   primary/only model (intro, Features, "Try it").
3. `README.md` — remove the "loaded-cost multiplier" control (the field was removed).
4. `server/zoom-app-config.md` — drop "multiplier" from the persisted-config field list.
5. `dev-docs/opportunity-cost-rate.md` — state the `multiplier` was **removed**, not
   pending-removal / "treat as neutral scaling factor."

**SHOULD-FIX (stale / inconsistent):**
6. `README.md` — architecture diagram: show totals are selected by cost model (default Simple path
   `selectActiveTotals`/`computeSimpleTotals`, not only the per-participant path).
7. `docs/security.html` — de-orphan: add Security to the site nav (all pages) and an index card.
8. `docs/privacy.html` + `docs/security.html` — add a one-line **operator-decryptable** disclosure
   (encrypted at rest but the running server/operator can decrypt; not end-to-end) — a stated
   pre-Marketplace requirement (roadmap Phase 6A).
9. `dev-docs/roadmap.md` — note `simple-default-role-gate` shipped (Simple-is-default + role gate).
10. `dev-docs/camera-overlay-no-draw.md` + `camera-overlay-no-update.md` — add a one-line
    RESOLVED/archival header (they read as live bugs at the top).

**NIT (polish):**
11. `README.md` — API list: add the shipped `/api/me/data` and `/api/me/export` endpoints, and
    mention the "keep the panel open while counting" limitation.
12. Effective-date consistency across the `docs/` pages (bump `documentation.html` — updated but its
    date wasn't; reconcile the 1-June vs 25-June drift so dates reflect real last-update).
13. `dev-docs/railway-setup.md` — `DATA_DIR`/`/data` volume is effectively **required** for
    persistence, not merely "recommended."
14. `dev-docs/dependency-review.md` — add a short "trails current roadmap; refresh on next
    Dependabot batch" note (it's a dated snapshot).

## Non-goals

- Any product code, tests, config, or CI change — **docs and `BACKLOG.md` only**.
- Implementing the two deferred follow-ups themselves (this only *records* them).
- Wholesale rewrites — targeted fixes to the audited issues only.
- New legal commitments beyond an accurate factual disclosure of the existing encryption posture.

## Acceptance criteria

1. `BACKLOG.md` has **BUG-1** (panel-close meter re-arch) and **OPS-1** (participant self-heal poll)
   under Open, each with enough context to action later.
2. `README.md` accurately presents Simple-as-default + non-host lock + host-only per-participant;
   contains no "multiplier" control; the architecture diagram reflects cost-model selection; the API
   list includes `/api/me/data` + `/api/me/export`; the keep-panel-open limitation is mentioned.
3. No doc claims the `multiplier` field exists: `grep -ri multiplier README.md server/zoom-app-config.md dev-docs/`
   returns only historical/removal references, none describing it as present.
4. `docs/security.html` is reachable from the site nav and the index; `privacy.html` + `security.html`
   each carry an operator-decryptable clarification.
5. `dev-docs/roadmap.md` records the simple-default-role-gate shipment; the two camera-overlay briefs
   carry a RESOLVED header.
6. NITs 12–14 applied (date consistency; DATA_DIR required wording; dependency-review refresh note).
7. **Scope containment:** the diff touches only docs (`README.md`, `docs/*.html`, `dev-docs/*.md`,
   `server/zoom-app-config.md`) and `BACKLOG.md` — plus the review artifacts. No `client/` or
   `server/src/` change.

## Test notes

- **AC1–AC6:** read/grep verification against the finding list; `grep -ri multiplier` for AC3;
  optionally render the `docs/*.html` pages in the preview to confirm nav links resolve and no markup
  broke.
- **AC7:** `git diff --name-only main...HEAD` shows no files beyond those AC7 enumerates (+ the
  `reviews/docs-consistency-sweep.*` artifacts).
- Gate: `npm test && npm run build` green (docs changes don't touch the JS, so this is a
  no-regression check).

## Open questions

None — scope (all findings incl. NITs and the operator-decryptable legal-page disclosure) approved
by Thomas.

## Design sketch — HOW

N/A — mechanical. Pure documentation content edits + a `BACKLOG.md` append; no new module, structure,
pattern, or dependency. Per `/frame` step 6, the codex design review is a noted skip. The operator-
decryptable wording will mirror the in-app disclosure (`PresenterControls.jsx`) and the roadmap
Phase-6A requirement — a factual clarification of the existing posture, not a new commitment.

## Build note (2026-07-09)

AC → file map:
- **AC1** → `BACKLOG.md` (BUG-1, OPS-1).
- **AC2/AC3** → `README.md`, `server/zoom-app-config.md`, `dev-docs/opportunity-cost-rate.md`.
- **AC4** → `docs/index.html`, `docs/documentation.html`, `docs/privacy.html`, `docs/security.html`,
  `docs/support.html`, `docs/terms.html` (Security nav on all; card + operator-decryptable
  disclosure on the content pages).
- **AC5** → `dev-docs/roadmap.md`, `dev-docs/camera-overlay-no-draw.md`,
  `dev-docs/camera-overlay-no-update.md`.
- **AC6** → date bumps (`docs/documentation.html`/`privacy.html`/`security.html`),
  `dev-docs/railway-setup.md`, `dev-docs/dependency-review.md`.
- **AC7** → docs + `BACKLOG.md` only; no product code.

## Codex approach review (2026-07-09, base main, HEAD b9222a2)

**Verdict:** *"The sweep is directionally sound on the implementation claims … The operator-
decryptable wording is an accurate clarification, not a new commitment, and the July 9 date bumps
are defensible on the pages with substantive changes. I would not call the shape fully sound yet
because it leaves a stale README visual, stale public-page copy, and split backlog references."*

### BLOCKER — README still embeds the old per-person-only architecture image _(two-way · dated)_
> The ASCII diagram was updated, but README still embeds `dev-docs/meeting-cost-architecture.png`
> (source `.svg`), which shows only the per-person path — the most visible diagram now contradicts
> the Simple-default model and AC2's "diagram reflects cost-model selection."
> - **alternative:** regenerate the SVG/PNG to match the new ASCII shape, or drop the PNG and keep
>   the ASCII as the single diagram.

### IMPORTANT — Public policy/support copy still describes the per-person-only model _(two-way · dated)_
> `docs/privacy.html:56` ("estimates each person's opportunity cost … default for anyone not
> listed") and `docs/support.html` still frame per-person as the model, and Support's storage FAQ
> still says "only you can retrieve," undercutting the new operator-decryptable disclosure.
> - **alternative:** neutralize the use/data-entry copy (Simple default = average rate + count;
>   per-person is host/co-host optional) and point Support's FAQ at the Privacy operator-decryptable
>   explanation.

### IMPORTANT — Deferred items recorded in a different backlog than the roadmap points to _(two-way · nonstandard)_
> BUG-1/OPS-1 went into root `BACKLOG.md`, but `dev-docs/roadmap.md` says tactical work lives in
> `reviews/backlog.md` — so the new items are invisible to the roadmap's advertised work source
> (split-brain planning docs).
> - **alternative:** pick one canonical backlog — update the roadmap to point at root `BACKLOG.md`,
>   or also link the items in `reviews/backlog.md`.

## Decisions (2026-07-09, approach)

All three approach findings → **fix** (applied in `/close`; correctness pass does not run this
round — approved fixes reshape the docs deliverable, so it goes back through `/review` after):
- **BLOCKER (stale README diagram)** → **drop the embedded PNG + the stale SVG link**; the updated
  ASCII diagram is the single source of truth (no in-repo diagram-regen tooling — regeneration not
  worth it).
- **IMPORTANT (stale public copy)** → **fix**: neutralize the use/data-entry copy on
  `docs/privacy.html` + `docs/support.html` (Simple default = average rate + count; per-person is
  host/co-host optional), and repoint Support's "only you can retrieve" at the operator-decryptable
  explanation.
- **IMPORTANT (split backlog)** → **fix**: make root `BACKLOG.md` canonical — update
  `dev-docs/roadmap.md`'s work-source references to point there.

## Fixes (2026-07-09)

Applied the three approved approach findings:
- **BLOCKER (stale diagram)** → removed the embedded `meeting-cost-architecture.png` and the
  "Full diagram source" `.svg` link from `README.md`; the updated ASCII diagram is now the single
  source. No live doc references the old images (only historical review artifacts do); the unused
  asset files are left in place.
- **IMPORTANT (public copy)** → neutralized the per-person-only framing on `docs/privacy.html`
  (lede, summary, "What the app is", "The figures you enter") and `docs/support.html` ("What number
  do I enter?") to Simple-default + optional host-only per-person; repointed Support's "Where are my
  settings stored?" from "only you can retrieve" to the operator-decryptable clarification.
- **IMPORTANT (split backlog)** → implemented the *intent* (no invisible items) rather than a literal
  single-file merge: `reviews/backlog.md` holds ~15 roadmap-deep-linked detailed items, so moving
  them into `BACKLOG.md` would break those links. Instead, `dev-docs/roadmap.md` now names **both**
  backlogs and their roles — `BACKLOG.md` = canonical tracked-work list (`AUDIT-`/`BUG-`/`OPS-`),
  `reviews/backlog.md` = detailed product/strategy backlog — and `BACKLOG.md` cross-links back. So
  BUG-1/OPS-1 are now discoverable from the roadmap. (Flagging the deviation from "make BACKLOG.md
  the *one* canonical" for the re-review.)

## Codex approach re-review (2026-07-10, base main, HEAD 41b09cb)

**Verdict:** *"Not fully sound yet. The README diagram, multiplier removal, operator-decryptable
disclosure, and privacy/support copy fixes are directionally resolved. The two-backlog approach is
acceptable in principle … but the roadmap still overclaims that its execution plan inventories every
open unit of work while omitting the root BACKLOG BUG/OPS queue. I also found remaining
per-person-only wording in canonical/public docs and one stale Support effective date."*

### IMPORTANT — Canonical/public docs still define input as per-person-only _(two-way · dated)_
> `dev-docs/opportunity-cost-rate.md:6` ("for each person"), `docs/documentation.html:38` ("The
> figure you enter for each person"), and `docs/terms.html:45` still frame the input per-person —
> conflicting with the Simple default (average rate + count; non-hosts can't use per-person).
> - **alternative:** rewrite around "the rate(s) you enter — an average in Simple mode, or per-person
>   values in host/co-host per-person mode"; make the default-rate tip explicitly per-person-only.

### IMPORTANT — Execution-plan "every open unit" claim too broad _(two-way · nonstandard)_
> Naming both backlogs helped, but `dev-docs/roadmap.md:463` still says the execution plan
> inventories *every* open unit from `reviews/backlog.md`, while BUG-1/OPS-1/AUDIT-4 live only in
> root `BACKLOG.md`; `reviews/backlog.md:5` also calls the roadmap the authoritative inventory.
> - **alternative:** narrow the execution-plan language to product/strategy work and say AUDIT/BUG/OPS
>   workflow items are tracked separately in `BACKLOG.md` (or add a root-BACKLOG queue row).

### NIT — Support effective date stayed stale after copy changes _(two-way · dated)_
> `docs/support.html:31` still says "1 June 2026" despite the new Simple-default + operator-decryptable
> copy.
> - **alternative:** bump Support's header/footer date to 9 July 2026.

## Decisions (2026-07-10, approach re-review)

All three residuals → **fix** (applied in `/close`; approach fixes → re-review again, no merge this
round):
- **Per-person wording** → **fix comprehensively**: a repo-wide grep for remaining per-person-only
  phrasing across all docs, neutralized in one pass (not just the 3 cited files), to converge.
- **Execution-plan overclaim** → **fix**: narrow the roadmap execution-plan language to
  product/strategy work and state AUDIT/BUG/OPS workflow items are tracked in `BACKLOG.md`
  (no roadmap ordering); soften `reviews/backlog.md`'s "authoritative inventory" claim.
- **Support date NIT** → **fix**: bump `docs/support.html` to 9 July 2026.

## Fixes (2026-07-10, round 2)

Applied the three approach-re-review findings:
- **Per-person wording** → neutralized via a repo-wide grep: `dev-docs/opportunity-cost-rate.md`
  (canonical definition), `docs/documentation.html` ("What you enter"), `docs/terms.html` (estimates
  callout), and `dev-docs/roadmap.md` terminology gloss now read "average (simple) or per-person
  (host-only)". Left the legit "no per-person values shown to participants" statements as-is.
- **Execution-plan overclaim** → `dev-docs/roadmap.md` execution plan now scopes to product/strategy
  work and states `AUDIT-`/`BUG-`/`OPS-` items live in `BACKLOG.md` (not roadmap-ordered);
  `reviews/backlog.md`'s reciprocal claim scoped to "product item below" + a `BACKLOG.md` pointer.
- **Support date NIT** → `docs/support.html` bumped to 9 July; `docs/terms.html` also bumped (its
  content changed this round). Verified: no residual per-person input-framing; all `docs/*.html`
  well-formed.

## Codex approach re-review (2026-07-10, base main, HEAD d3ce1f5)

**Verdict:** *"Mostly sound. The public docs, README, operator-decryptable disclosure,
Simple-default/non-host lock copy, multiplier removal, endpoint list, dates, and two-backlog
top-level roles now line up with the code. I found one remaining real inconsistency in the linked
tactical backlog, which now functions as part of the docs source of truth."*

### IMPORTANT — Tactical backlog carries obsolete product-state claims _(two-way · dated)_
> `reviews/backlog.md` (:31 deauth gated behind an overlay live-test matrix "not yet run"; :243
> `rateTable`/`defaultRate`/`multiplier` persist to `localStorage`; :255 browser-only "rates/names
> never leave the browser") contradicts the matrix-dropped decision, the removed multiplier, and the
> server-backed/operator-decryptable store.
> - **alternative:** refresh those entries in place (matrix dropped; server-side encrypted-at-rest
>   but operator-decryptable; drop `multiplier`/`localStorage` current-state claims).
> - **note (Claude):** `reviews/backlog.md` was **not** in the original sweep scope (README/`docs/`/
>   `dev-docs/`/server config); it surfaced only because this story's backlog-reconciliation named it
>   the "detailed product backlog." Convergence tail — see decision below.

## Decisions (2026-07-10, approach re-review r3)

- **IMPORTANT (stale claims in `reviews/backlog.md`)** → **defer + track**. Out of the original
  sweep scope (README/`docs/`/`dev-docs/`/server config); pulled in only by this story's
  backlog-reconciliation. Tracked as **OPS-2** (refresh `reviews/backlog.md` current-state notes).
  Deferring blesses the shape → the correctness pass runs this round.

## Codex review (2026-07-10, base main, HEAD f326043)

**Summary:** *"The branch is mostly aligned with the docs-consistency sweep … I found two remaining
public-doc consistency issues plus one date NIT."*

### IMPORTANT — Security index card reintroduces client-only wording
> `docs/index.html:49` — the new card says Security covers "what never leaves the Zoom client,"
> which can read like the retired browser-only privacy claim now that config is server-stored +
> operator-decryptable. → reword to "encryption, headers, and aggregate-only overlay data."

### IMPORTANT — Default-rate tip is still per-person-only
> `docs/documentation.html:107` — "Set a sensible default so people you have not listed are still
> counted" assumes per-person mode; non-hosts are Simple-locked and have no default/listed people.
> → scope the tip to per-person mode.

### NIT — Index effective date stayed stale
> `docs/index.html:67` — footer still "1 June 2026" while the other touched pages are 9 July.
> → bump index to 9 July.

## Decisions (2026-07-10, correctness)

All three correctness findings → **fix** (bounded one-line doc edits): reword the `docs/index.html`
Security card off "what never leaves the Zoom client"; scope the `docs/documentation.html`
default-rate tip to per-person mode; bump `docs/index.html`'s effective date to 9 July. Correctness
fixes → `/close` reaches the re-review/merge fork.

Thomas approved the full scope — all audited findings (MUST + SHOULD + NIT), including the
operator-decryptable disclosure on the public legal pages (privacy.html/security.html), and the two
BACKLOG follow-ups. Mechanical story → codex design review skipped (`N/A — mechanical`).
