Date: 2026-07-01 · Branch: claude/min-client-version-warning · Status: approved

# Minimum supported Zoom client version — user-facing warning + decision record

## Problem

The camera overlay — the product's core feature — relies on Zoom's camera rendering
context (`runRenderingContext({view:'camera'})` + `drawWebView`). An active Zoom regression,
**ZSEE-195647**, makes those calls resolve `ok:true` while rendering **nothing** on the camera
feed on **Zoom Workplace 6.7.8 / 7.0.2** (devforum thread 143155). The roadmap previously carried
this as the **#1 keystone ⛔ gate**: run a live client-version test matrix and possibly build a
`drawImage` fallback before treating the overlay as production-ready.

**Decision (Thomas, 2026-07-01):** the overlay is confirmed working across weeks of real meetings
on current builds, so rather than run the matrix or build a fallback, we **accept the risk on old
builds**, declare a **supported floor of Zoom Workplace 7.1.0+** (the first GA above the affected
7.0.2), and **document a user-facing warning**. No in-app code, no matrix, no `drawImage` fallback.

This story records that decision in the user-facing docs and the internal roadmap, and folds in the
already-verified esbuild/Vite backlog closure (bookkeeping).

> **Note on state:** the edits for this story were drafted in the working tree *before* framing (at
> Thomas's direction) and carried onto this branch; nothing is committed. Framing formalizes the
> spec + review + branch. The only remaining implementation work is **correcting this-session dates
> to 2026-07-01** (AC7) and any adjustments from the frame consult.

## In scope

1. **User-facing warning** of the minimum supported version (Zoom Workplace **7.1.0+**) in:
   - `README.md`
   - `docs/documentation.html` (Requirements callout + Troubleshooting line)
   - `docs/support.html` (FAQ entry)
2. **Internal decision record:** mark the overlay live-test matrix **gate DROPPED** in
   `dev-docs/roadmap.md` (live-render callout, execution-plan row, critical path, MVP gates), and add
   **SUPERSEDED** banners to `dev-docs/overlay-live-test-matrix.md` and
   `dev-docs/overlay-live-test-guide.md` (the new operator guide, kept as reference).
3. **esbuild/Vite closure (fold-in):** mark the already-verified backlog item DONE in
   `reviews/backlog.md` and the roadmap execution-plan row.
4. **Date correction:** every date this session stamped (currently 06-28 / 06-29 / 06-30) set to
   today, **2026-07-01**.

## Non-goals

- **No in-app / product code** (`client/`, `server/`) — the warning is docs-only, per Thomas's
  "Docs/marketplace only" choice. No runtime version detection, no in-panel notice.
- **No live-test matrix run and no `drawImage` fallback** — explicitly dropped by the decision.
- **No new feature work** — Phase 1 etc. is out of scope here.

## Acceptance criteria

1. `README.md` states the app requires **Zoom Workplace desktop 7.1.0 or later** for the on-camera
   overlay, notes older desktop clients may not render it, and links the ZSEE-195647 reference.
2. `docs/documentation.html` carries a **Requirements** note (Getting started) and a version line in
   **Troubleshooting → "The overlay isn't showing"**, both citing 7.1.0+.
3. `docs/support.html` has an FAQ entry for the overlay not appearing that cites 7.1.0+ and points to
   the Documentation.
4. **Honest framing everywhere:** 7.1.0 is described as the supported floor *above the affected 7.0.2
   build*, **not** as a documented fix of ZSEE-195647 (which is unconfirmed).
5. **Internal record:** `dev-docs/roadmap.md` marks the overlay live-test matrix gate DROPPED
   (resolved-by-decision) across the live-render callout, the execution-plan inventory row, the
   critical-path list, and the MVP pre-launch-gates bullet; `overlay-live-test-matrix.md` and
   `overlay-live-test-guide.md` each carry a SUPERSEDED-reference banner.
6. **esbuild/Vite:** `reviews/backlog.md` item and the roadmap execution-plan row are marked DONE,
   reflecting the verified state (vite 6.4.3 / esbuild 0.25.12, `npm ci` clean, 0 vulns, gate green).
7. **Dates:** no this-session edit carries 2026-06-28/-29/-30; all such stamps read **2026-07-01**.
   Genuinely historical dates (prior reviews, PR numbers, the ZSEE report, doc "Effective date")
   are unchanged.
8. **Scope containment:** the diff touches only the files enumerated below (docs + this story), and
   **no product code** under `client/` or `server/`.

## Test notes

- **Gate:** run `npm test && npm run build` — docs-only, so it must stay green (confirms nothing
  code-side was disturbed).
- **AC1–3:** inspect `README.md`, `docs/documentation.html`, `docs/support.html` — each contains the
  `7.1.0` requirement string in the stated location; HTML tags balanced (the additions reuse existing
  `.callout` / `<h3><p>` patterns).
- **AC4:** `grep -rn "7.1.0\|7.0.2" README.md docs/` — confirm every user-facing mention frames 7.1.0
  as "above" the affected build, not as a fix.
- **AC5:** inspect `dev-docs/roadmap.md` (callout + row + critical path + MVP bullet) and the two
  dev-docs banners.
- **AC6:** inspect the backlog item + roadmap row show DONE.
- **AC7:** `grep -rn "2026-06-28\|2026-06-29\|2026-06-30" README.md docs/ dev-docs/ reviews/backlog.md
  reviews/min-client-version-warning.md` returns nothing; `2026-07-01` present in the new/edited
  stamps.
- **AC8:** `git diff --name-only main...HEAD` shows no files beyond those the AC enumerates.

### Files touched
`README.md`, `docs/documentation.html`, `docs/support.html`, `dev-docs/roadmap.md`,
`dev-docs/overlay-live-test-matrix.md`, `dev-docs/overlay-live-test-guide.md` (new),
`reviews/backlog.md`, `reviews/min-client-version-warning.md` (this spec).

## Open questions

- **Bundling the esbuild closure here.** It's unrelated to the version warning but is small,
  already-verified bookkeeping that's currently sitting uncommitted in the same working tree.
  Folded in for tidiness (AC6) — flag if you'd rather it ship on its own.
- None blocking; the scope decision (7.1.0 floor, docs-only) is already yours.

## Design sketch — HOW

**N/A — mechanical.** Docs-only: prose/HTML copy in README + the static docs site, and
Markdown edits to the dev-docs roadmap/matrix/guide + backlog. No new module, data shape, pattern,
or dependency; no product code. Per the frame protocol, the Codex design review (step 6) is a
**noted skip** for a mechanical story.

## Design decisions (2026-07-01)

- **Scope approved** by Thomas 2026-07-01: *"yes fold in the vite closure and approve"* — the
  min-version 7.1.0+ warning (docs-only), the roadmap gate-drop record, **and** the esbuild/Vite
  backlog closure (AC6) all ship in this one story.
- **No design findings** — mechanical docs story; Codex design review skipped by protocol. No
  one-way-door decisions.
