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

## Design decisions (2026-07-09)

Thomas approved the full scope — all audited findings (MUST + SHOULD + NIT), including the
operator-decryptable disclosure on the public legal pages (privacy.html/security.html), and the two
BACKLOG follow-ups. Mechanical story → codex design review skipped (`N/A — mechanical`).
