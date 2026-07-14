Date: 2026-07-14 · Branch: claude/panel-simplify-and-reorg · Status: approved

# panel-simplify-and-reorg

## Problem

The presenter side panel is cluttered and reads **backwards**. Today (`App.jsx` +
`PresenterControls.jsx`) it:

- leads with the **"Cost overlay"** action section (Show-on-video button + the session
  buttons + a dense status line + the cadence buttons + a viewer preview) **before** the
  cost inputs — so you're asked to *act* before you've *set your numbers*;
- shows **two previews** — the in-panel viewer preview (`CostOverlay` on a striped stage)
  **and**, in mock dev, a separate simulated-camera frame (`.sim-camera` mounting
  `OverlayApp`) — plus a third cost surface, the big `$total` readout (`.cost-screen`);
- crowds the overlay toggle, session buttons, and cadence buttons together in one box;
- puts **spinner steppers** on both number fields (`<input type="number">`);
- uses **dense helper copy** (e.g. "renders on your camera feed, so everyone sees it —
  keep this panel open while counting"; "Your best guess of the average hourly opportunity
  cost per attendee × the number of attendees").

Thomas asked to simplify and reorganize: **one screen, configure-first, one preview,
fewest buttons, no spinners, clearer / larger / simpler text.** He picked the **Option A —
"one screen, top-down"** structure from the frame mockups.

## In scope

- **Reorganize** the presenter panel to a single-column, top-down layout (Option A):
  **(1) cost inputs → (2) one live preview → (3) the Show/Hide-on-video button →
  (4) status-relevant session controls → (5) the two cadence buttons.**
- **Collapse to one preview:** keep the honest viewer preview (`CostOverlay` on a
  video-like stage, captioned as what viewers see). Remove the separate big-`$total`
  readout (`.cost-screen` / `.big-total`) and the mock simulated-camera frame
  (`.sim-camera` + its `OverlayApp` mount) from the panel.
- **Remove number-input spinners** on both fields (attendee count + hourly rate) via a CSS
  `appearance` reset.
- **Enlarge + simplify** the field labels and helper copy; keep the opportunity-cost
  meaning in a short hint rather than a jargon label.
- CSS in `styles.css` to support the single column, the larger inputs, and the caption.

## Non-goals

- **No behavior change** to the cost engine or session logic: `cost.js` (`computeSimpleTotals`),
  `displayCadence.js` (already `[1, 10]`, default `10` — the picker is unchanged),
  `quantizeForDisplay`, the session state machine (`sessionControls.js` + App's
  `sessionActions`), the overlay message bridge, and the camera auto-recover all stay as-is.
- **No change to which session buttons appear per status** — `sessionControls(status)` is
  reused unchanged; the reorg only *relocates* the buttons (it does not remove any session
  capability — that would regress `session-restart-controls`).
- **No change to the real camera overlay** (`OverlayApp` via `Root`, `cameraDraw`) — only
  its *mock preview mount* inside `App.jsx` is removed.
- No new controls or features (no notetakers, harvest, or persistence).
- No new dependency. No server, `docs/`, or marketplace-page changes.

## Acceptance criteria

1. The panel renders as a **single top-down column** (no two-column presenter grid), in the
   order: (a) cost inputs, (b) one live preview, (c) the primary Show/Hide-on-video button,
   (d) status-relevant session controls, (e) the 1s / 10s cadence buttons.
2. **Exactly one preview** is present: the literal viewer preview (`CostOverlay` on a
   video-like stage, with the existing caption), rendered **compact** — a smaller stage with
   little empty space around the card. The big-`$total` readout (`.cost-screen` /
   `.big-total`) and the mock simulated-camera frame (`.sim-camera` + its `OverlayApp` mount)
   are gone from the panel.
3. Neither panel number input shows a **spinner stepper** (verified in the browser preview) —
   the CSS `appearance` reset is **scoped to the panel field** (`.num-input input[type='number']`),
   leaving every other number input in the stylesheet (rolebar, `.add-row`, `.inline.num`) with
   its steppers intact.
4. Session buttons appear **only when relevant to the status**, driven by the unchanged
   `sessionControls(status)`: idle → the Show button (auto-starts the session as today) plus
   the existing Start control; running → Pause + End; paused → Resume + End; ended →
   Start-new + Resume. No session button is added or removed relative to today.
5. **Existing copy strings are kept verbatim** (field labels, the opportunity-cost helper,
   the overlay status line, the preview caption) — Thomas's call. The "clearer / larger /
   simpler" goal is delivered through **typography and layout** (larger label + value text,
   cleaner grouping, more breathing room between groups), **not rewording**.
6. **Scope containment:** the **product** diff is limited to `client/src/App.jsx`,
   `client/src/components/PresenterControls.jsx`, and `client/src/styles.css`. Beyond those,
   `git diff --name-only main...HEAD` carries only this story file and the workflow's own
   review artifacts — `reviews/panel-simplify-and-reorg.{design,approach,codex}.json`, produced
   by `/frame` + `/review`, not product code. (Amended 2026-07-14 per the correctness-pass
   BLOCKER — see Decisions.)
7. The gate (`npm test && npm run build`) stays green.

## Test notes

- **No panel render tests exist** (no `App.test`/`PresenterControls.test`; the only
  panel-adjacent test is `usePresenterStore.test.js`, whose subject is unchanged), and adding
  jsdom render tests for the panel is out of scope / not this repo's pattern. Because the
  change is observable in the browser preview (Option A depth = reorg + light layout),
  primary verification is the **`/verify` / preview flow**:
  - **AC1/AC2/AC4/AC5** — run `npm run dev`, drive the panel: confirm single-column
    inputs-first order; exactly one preview; per-status session buttons (idle → no
    Pause/End; running → Pause + End); simplified/enlarged copy. Screenshot as proof.
  - **AC3** — in the browser preview, confirm the two number fields show no up/down arrows;
    confirm the `appearance` reset in `styles.css`.
- **AC6 (scope):** run `git diff --name-only main...HEAD` and verify no files appear beyond
  the three product files, this story file, and the workflow's review artifacts
  (`.design.json` / `.approach.json` / `.codex.json`) enumerated in AC6.
- **AC7:** run `npm test && npm run build`.
- **Regression safety:** the unchanged pure modules (`cost`, `displayCadence`,
  `sessionControls`, `usePresenterStore`, `CostOverlay`, `overlayState`) keep their existing
  tests green — the reorg alters none of their logic.

## Open questions

All resolved at the frame consult — see **Design decisions (2026-07-14)** below.

## Design sketch — HOW

Pure presentational reorg — reuse existing pure components and hooks; no new abstractions,
state, props, or dependencies.

- **`App.jsx`** — replace the two-column `<main className="layout presenter">` (the
  `screen-col` + `controls-col` split) with a **single-column** container that renders the
  header + `PresenterControls`. **Remove** the `.cost-screen` big-`$total` block and the
  `adapter?.isMock` `.sim-camera` `OverlayApp` mount. All hooks stay **exactly as-is** — the
  session engine, 1 s tick, `postOverlay`, `previewDisplay` memo, overlay start/stop, and the
  `getVideoState` auto-recover are untouched; only the returned JSX changes. Drop any imports
  that become unused after removing the big-readout/sim-camera (`OverlayApp`, and the
  `formatMoney`/`formatCadenceDuration` used only by the removed block — verify before
  deleting).
- **`PresenterControls.jsx`** — reorder to Option A: **(1)** the two `NumberInput`s first;
  **(2)** the single `CostOverlay` preview on a `.overlay-preview-stage` with a plain
  caption; **(3)** the primary Show/Hide button; **(4)** the status-gated session buttons
  (`sessionControls(session.status)` unchanged); **(5)** the two cadence buttons
  (`DISPLAY_INTERVALS` = `[1, 10]`). Simplify the headings, hint, and status line. The
  `NumberInput` component's commit-on-blur/Enter logic is **untouched** — only its
  surrounding label copy and a size class change.
- **`styles.css`** — add a single-column presenter layout (reuse the `.layout.viewer`
  max-width idiom, or a new single-col rule); add the spinner reset **scoped to the panel
  field** — `.num-input input[type='number'] { appearance: textfield; -moz-appearance: textfield; }`
  plus `.num-input input[type='number']::-webkit-outer-spin-button, .num-input input[type='number']::-webkit-inner-spin-button
  { -webkit-appearance: none; margin: 0; }` (per codex finding 2 — do **not** use a global
  `input::-webkit-*` selector); enlarge the input/label text; **compact the preview** by
  scoping a smaller stage + reduced card inset to the preview only (e.g.
  `.overlay-preview-stage { max-width: … }` and `.overlay-preview .cost-overlay { padding: … }`)
  so the **shared** `.cost-overlay` / `.cost-overlay-card` rules used by the real camera
  overlay are left untouched. Retire only clearly-dead rules; keep churn minimal.
- **Data shapes unchanged:** `config` (`simpleAverageRate` / `simpleUserCount` /
  `displayIntervalSeconds`), `previewDisplay` (`buildOverlayState` + `quantizeForDisplay`),
  and `sessionControls(status)`. No new state, no new props.
- **Cross-cutting:** none new — no new error model, retries, or validation; no new dependency.

## Design decisions (2026-07-14)

Scope **approved** by Thomas at the frame consult: *"Approve — build it"* — Option A
(one-screen, top-down), reorg-only, with the choices below. No one-way doors.

- **Structure:** Option A — single top-down column: inputs → one preview → Show/Hide button
  → status-relevant session buttons → 1s/10s cadence.
- **Cadence:** two buttons, 1s / 10s, default 10s — already the current `DISPLAY_INTERVALS`;
  **no `displayCadence.js` change**.
- **Copy:** *keep today's wording verbatim* — no rewording of labels, helper, status line, or
  caption. "Clearer / larger / simpler" is delivered by typography + layout only (AC5).
- **Idle Start button:** *keep it* — `sessionControls(status)` stays unchanged; no session
  button added or removed (AC4). Avoids regressing `session-restart-controls`.
- **Preview:** *the literal `CostOverlay` viewer card*, but **compacted** — smaller stage,
  less empty space around the card; scoped CSS so the real camera overlay is untouched (AC2).
- **Finding dispositions (both codex findings):**
  - *"Spinner reset should not target every number input" (IMPORTANT/kludgy)* → **fix**: scope
    the reset to `.num-input input[type='number']` (folded into AC3 + the CSS sketch bullet).
  - *"Required copy references a missing decision" (QUESTION)* → **resolved**: labels keep
    today's wording, so there is no new copy contract to define; AC5 rewritten accordingly.

## Codex design review (2026-07-14)

**Verdict:** sound. "The proposed component shape is modern, minimal, and consistent with the
repository: it reuses `CostOverlay`, `sessionControls`, and existing state rather than adding
abstractions or dependencies. It is ready once the wording contract is resolved and the
spinner CSS is explicitly scoped."

**Findings**

- **QUESTION · two-way · standard — "Required copy references a missing decision"**
  (`reviews/panel-simplify-and-reorg.md` AC5). AC5 requires exact wording from a "Design
  decisions" section that does not yet exist, while the wording is still an open question, so
  the sketch doesn't uniquely specify the labels/hint the implementation is reviewed against.
  - *alternative:* have Thomas confirm the recommended wording, promote it into a
    `## Design decisions` section, and drop the corresponding open question.
  - *win:* one objective copy contract; no subjective copy call at correctness-review time.
- **IMPORTANT · two-way · kludgy — "Spinner reset should not target every number input"**
  (`## Design sketch — HOW`, the CSS bullet). The sketched WebKit selectors are global
  (`input::-webkit-outer-spin-button` / `-inner-spin-button`); the stylesheet has other
  number-input contexts (`.rolebar` fields, `.add-row input[type='number']`, `input.inline.num`),
  so a literal implementation would strip their steppers too — but AC3 targets only the two
  panel fields.
  - *alternative:* scope every reset selector to the presenter field, e.g.
    `.num-input input[type='number']` and `.num-input input[type='number']::-webkit-*`.
  - *win:* satisfies AC3 without changing unrelated inputs or hiding a cross-panel rule.

## Build note (2026-07-14)

AC → file map:

- **AC1** (single top-down column; inputs → preview → action → session → cadence) —
  `client/src/App.jsx` (single-column `<main className="layout solo">`),
  `client/src/components/PresenterControls.jsx` (reordered sections),
  `client/src/styles.css` (`.layout.solo`).
- **AC2** (exactly one, compacted preview) — `client/src/components/PresenterControls.jsx`
  (the single `CostOverlay` preview), `client/src/App.jsx` (removed the `.cost-screen`
  big-`$total` block and the `.sim-camera` `OverlayApp` mount; dropped now-unused imports),
  `client/src/styles.css` (compact `.overlay-preview-stage` + scoped `.overlay-preview
  .cost-overlay` inset; retired `.cost-screen*` / `.sim-camera*`).
- **AC3** (no spinner steppers, scoped) — `client/src/styles.css`
  (`.num-input input[type='number']` `appearance: textfield` + scoped `::-webkit-*-spin-button`).
- **AC4** (session buttons per status, logic unchanged) —
  `client/src/components/PresenterControls.jsx` (same `sessionControls(session.status)` gating,
  relocated).
- **AC5** (copy verbatim; larger via typography/layout) —
  `client/src/components/PresenterControls.jsx` (strings unchanged),
  `client/src/styles.css` (enlarged input value/affix + label font sizes).
- **AC6** (scope containment) — diff touches only `client/src/App.jsx`,
  `client/src/components/PresenterControls.jsx`, `client/src/styles.css`, this story file, and
  `reviews/panel-simplify-and-reorg.design.json`.
- **AC7** (gate green) — implicit (this review exists).

## Codex approach review (2026-07-14, base main 87ae63d, HEAD cc79b39)

**Verdict:** CLEAN — empty findings. "Sound and idiomatic approach. I would build it this way:
a presentational JSX reorder, deletion of the redundant preview surfaces, reuse of
`CostOverlay` / `sessionControls` / `DISPLAY_INTERVALS`, and narrowly scoped CSS. It adds no
state, abstraction, behavior, or dependency; the changed-file scope also matches the spec."

No findings — the shape is blessed; proceeded to the correctness pass in the same round.

## Codex review (2026-07-14, base main 87ae63d, HEAD cc79b39)

**Summary:** "The UI changes match the requested layout, preview, copy, session-control, and
spinner behavior, but the branch violates the explicit changed-file scope. The test/build gate
could not run in the read-only environment because Vite attempted to create a temporary config
file." *(The gate note is a read-only-sandbox limitation on codex's side — the gate ran green
locally: client 157, server 25, secret-scan 14, build.)*

**BLOCKER**

- **"Branch exceeds the approved file scope"** (`reviews/panel-simplify-and-reorg.approach.json`).
  AC6 enumerates only the three client files, the story file, and `…design.json`; but
  `git diff --name-only main...HEAD` also includes the **review's own artifacts**
  (`…approach.json`, and now `…codex.json`), so the diff carries files AC6 didn't list.
  - *suggestion:* remove the file, or get Thomas's approval to amend AC6.
  - *note:* these `.approach.json` / `.codex.json` files are produced **by the `/review`
    workflow itself** (steps 6 + 8 instruct committing them). AC6 was written at frame time to
    contain **product/implementation** scope and listed the frame-time artifact (`.design.json`);
    the review-time artifacts didn't exist yet to enumerate. The product diff (`App.jsx`,
    `PresenterControls.jsx`, `styles.css`) is exactly in scope.

## Decisions (2026-07-14, base main 87ae63d, HEAD cc79b39)

Approach pass: CLEAN (no findings) — nothing to decide.

Correctness pass:

- **BLOCKER — "Branch exceeds the approved file scope"** → **amend AC6** (Thomas: "Amend AC6").
  AC6 rewritten so the `/review` workflow's own `.approach.json` / `.codex.json` artifacts
  count as expected outputs alongside the frame-time `.design.json`, not a scope violation. No
  product-code change; the product diff (`App.jsx`, `PresenterControls.jsx`, `styles.css`) was
  already exactly in scope. Test note for AC6 updated to match.
