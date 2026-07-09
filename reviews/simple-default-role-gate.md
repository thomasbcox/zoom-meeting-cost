# simple-default-role-gate — Simple-by-default + non-host lockdown + panel shrink

Date: 2026-07-08 · Branch: claude/simple-default-role-gate · Status: approved

## Problem

Non-hosts can't read the participant list (`getMeetingParticipants` is host/co-host only), so the
per-participant model is unusable for them: the live count reads 0 and the meter sits at $0 until a
number is manually entered. The app currently boots into per-participant mode (shipped last story)
and shows an 8-section control panel to everyone — most of it (rate table, aliases, overrides) is
dead weight for a non-host. Product direction: **Simple mode (attendees × a standard rate) is the
right default for everyone**, non-hosts should see *only* that, and the panel should be smaller.

## In scope

1. **Boot in Simple mode for everyone** — hydration defaults `costModel` to `'simple'` (reverses
   last story's `'perParticipant'` boot). Hosts/co-hosts may still switch to per-participant during
   a session; a relaunch resets to Simple.
2. **Role-gate the UI** — surface the presenter's `role` (already returned by `getUserContext()` as
   `self.role`, just not used). **Non-hosts see only the Simple interface**: no Cost-model toggle,
   none of the per-participant panels. **Hosts/co-hosts** keep the toggle and per-participant.
   Reading role once at load is sufficient — a role change (promoted to co-host) **requires a panel
   relaunch** to get the fuller UI (Thomas: relaunch OK).
3. **Empty-prompt attendee count** — in Simple mode, when the participant list is unavailable (the
   non-host case), the attendee-count field shows **empty with a prompt** ("Enter the number of
   attendees") instead of a misleading `0`; the meter reads $0 until filled, then the value persists
   as the presenter's best guess (no coercion back to 0).
4. **Shrink the control panel** — the role/mode gating removes ~4 panels for Simple users
   (structural shrink); additionally, consolidate each panel's multiple explanatory paragraphs into
   one concise line. (Heavier restructuring is a flagged open question, not assumed.)
5. **Document everywhere** — rewrite the in-app Simple-panel copy to state the model (the presenter
   makes a best guess of the **average opportunity cost per participant** and the **number of
   participants**), and update the public `docs/documentation.html` to match. Include a one-line
   "keep this panel open while counting" note (the deferred stop-counting limitation).

## Non-goals

- **The panel-close-stops-counting bug** — the accrual loop lives in the panel ([App.jsx:194](../client/src/App.jsx#L194));
  closing the panel freezes the on-camera meter. Deferred to its own story (Thomas). This story only
  *documents* the limitation.
- Mid-meeting reactivity to role changes (relaunch is acceptable).
- The participant self-heal retry poll (separate follow-up).
- Removing the "Collaborate" button (Zoom platform chrome, not our code).
- Changing the cost math, the camera overlay, or the persistence/hydration guard.

## Acceptance criteria

1. **Boots in Simple.** After hydration, `costModel` is `'simple'` for everyone (was
   `'perParticipant'`); a clean load does not echo-save (the `lastSavedRef` guard still holds).
2. **Non-hosts are Simple-locked.** When `self.role` is not host/co-host, `PresenterControls`
   renders no Cost-model toggle and none of the per-participant panels (Opportunity-cost settings,
   Private per-person values, Name aliases, Per-participant overrides) — only Cost overlay, Simple
   cost estimate, and Past meetings. Hosts/co-hosts still see the toggle and can reach
   per-participant.
2b. **Simple never shows "can't calculate" (BLOCKER fix).** The main readout gates the
   "Participants unavailable" screen on an **effective** model: `effectiveCostModel =
   canPerParticipant ? config.costModel : 'simple'`, and the block shows only when
   `effectiveCostModel !== 'simple' && !participantsAvailable`. In Simple mode the meter always
   calculates from the manual count regardless of list availability. (Also covers a host whose fetch
   failed while in Simple.)
3. **Role parsing is robust.** A pure helper maps Zoom's role variants (`'host'`, `'coHost'`,
   `'cohost'`, `'co-host'`, case-insensitive) → host-privileged; anything else / missing / mock →
   per the mock rule below.
4. **Empty-prompt count.** In Simple mode with participants unavailable and no manual count entered,
   the attendee field is empty with a placeholder prompt (not `0`); entering a number drives the
   meter and persists; it is never overwritten back to 0 by the unavailable live count.
5. **Panel is smaller.** Simple-mode users no longer see the four per-participant panels; each
   remaining panel's helper copy is a single concise line (no multi-paragraph blocks), and the
   Cost-overlay status collapses to one line. **The private-data disclosure is preserved** as a
   concise one-liner in the per-person panel (not deleted).
6. **Docs updated.** In-app Simple copy states the best-guess model; `docs/documentation.html`
   describes Simple-first + the two inputs + the keep-panel-open note.
7. **Scope containment.** The diff touches only the files enumerated in Test notes.

## Test notes

- **AC1:** unit — hydration boots `'simple'` (extend the store's boot test / assert `costModelPatch`
  is not the vehicle here — boot is a fixed `'simple'`). Browser: fresh load shows the Simple panel.
- **AC2/AC5:** browser — with a host role, the toggle + per-participant panels render; with a
  non-host role (mock override or a fake `self.role`), only the 3 Simple-side panels render. Count
  the rendered `<h3>` sections.
- **AC3:** unit — `lib/role.js` `isHostRole()` truth table over the casings + null/undefined.
- **AC4:** unit — the count-display helper returns empty (not 0) when unavailable + no manual value;
  browser — non-host Simple view shows the prompt, entering a number drives the meter, re-render
  keeps it.
- **AC6:** grep `docs/documentation.html` for the best-guess wording + keep-panel-open note.
- **AC7:** `git diff --name-only main...HEAD` shows no files beyond: `client/src/lib/role.js`,
  `client/src/lib/role.test.js`, `client/src/state/usePresenterStore.js`,
  `client/src/components/PresenterControls.jsx`, `client/src/App.jsx`,
  `client/src/zoom/zoomAdapter.js` (mock role), `client/src/lib/cost.js` (+ its test, if the
  count-display helper lands there), `docs/documentation.html` — plus the review artifacts.
- Full gate: `npm test && npm run build` green.

## Open questions

_All resolved at the frame consult — see Design decisions._
1. **Shrink extent** → **baseline + single status line** (structural gating + one-line helper copy +
   merge Cost-overlay status to one line; preserve the privacy disclosure). Preview-disclosure /
   cadence-overflow deferred.
2. **Mock/unknown-role default** → **mock `self.role: 'host'`; production unknown/missing → Simple-
   locked.**
3. **Host in Simple with unavailable list** → covered by the effective-model gate (2b); no separate
   handling.

## Design sketch — HOW

- **`lib/role.js` (new, pure, tested):** `isHostRole(role)` → normalizes (`String(role).toLowerCase()`
  stripping non-alphanumerics) and returns true for `host`/`cohost`. Mirrors the repo's pure-helper
  convention (`role.test.js`).
- **Role flow:** `App` already receives `self`. Compute `const canPerParticipant = isHostRole(self?.role)`
  and pass it to `PresenterControls`. `MockZoom.init()` self gains `role: 'host'` (dev sees full UI);
  RealZoom already returns `getUserContext()` verbatim as `self`, which carries `role`.
- **Boot in Simple:** in `usePresenterStore` hydration, the `booted` config forces
  `costModel: 'simple'` (was `'perParticipant'`), still via the single `booted` object so the
  `lastSavedRef` guard suppresses a clean-load save. `DEFAULT_CONFIG.costModel` → `'simple'` too (new
  users / mock with no server data).
- **Gating in `PresenterControls`:** when `!canPerParticipant`, render only the Cost overlay + Simple
  panel + Past meetings; suppress the Cost-model `<section>` and the per-participant branch entirely
  (force Simple). When host, unchanged (toggle + both modes).
- **Empty-prompt count:** `SimpleCostPanel` takes `participantsAvailable`. The attendee `NumberInput`
  shows `''` (placeholder "Enter # of attendees") when `!participantsAvailable && simpleUserCount == null`,
  instead of `?? liveCount` (which is 0). A tiny pure helper (`simpleCountDisplay({ simpleUserCount,
  liveCount, participantsAvailable })` in `cost.js`) computes the field value + placeholder so it's
  unit-testable. Cost math already yields $0 for a blank/0 count — no change there.
- **Shrink (baseline):** delete the secondary explanatory `<p className="muted small">` blocks,
  keeping one concise line each; the structural removal falls out of the gating. No new component
  pattern.
- **Docs:** rewrite `SimpleCostPanel` copy; update `docs/documentation.html` prose. Both are content
  edits, no logic.
- **Error model:** unchanged. Role is best-effort (missing → Simple-locked, the safe path); nothing
  new throws.

## Build note (2026-07-08)

AC → file map:
- **AC1** (boot Simple) → `client/src/state/usePresenterStore.js` (DEFAULT_CONFIG + `booted`).
- **AC2/2b** (role-gate + effective-model) → `client/src/lib/role.js` (`isHostRole`),
  `client/src/App.jsx` (`canPerParticipant`/`effectiveCostModel`/`participantListRequired` + gated
  banner + props), `client/src/components/PresenterControls.jsx` (toggle + panels gated on
  `canPerParticipant`/`showSimple`), `client/src/zoom/zoomAdapter.js` (mock `self.role`).
- **AC3** (role parsing) → `role.js` + `role.test.js`.
- **AC4** (empty-prompt count) → `client/src/lib/cost.js` (`simpleCountDisplay`) + `cost.test.js`;
  `PresenterControls.jsx` (`SimpleCostPanel` + `NumberInput` placeholder).
- **AC5** (shrink) → `PresenterControls.jsx` (gating + one-line copy, disclosure preserved).
- **AC6** (docs) → `PresenterControls.jsx` copy + `docs/documentation.html`.

## Codex design review (2026-07-08)

**Verdict:** *"The role source is the right one: `getUserContext().role` is the privilege signal,
while `participantsAvailable()` should remain a list-availability signal (it conflates role with
scope/config/fetch failures). The pure `lib/role.js` helper, booting through the existing `booted`
object, and a tiny count-display helper all fit the repo's conventions. I would not approve as-is:
it misses one existing App-level availability gate and the shrink risks deleting the server-storage
disclosure."*

### BLOCKER — Simple mode still inherits the global "participants unavailable" block _(two-way · kludgy)_
> `App` renders the "Participants unavailable" screen ([App.jsx:302](../client/src/App.jsx#L302))
> **before** checking session/cost model, suppressing the meter. But non-host Simple mode should
> calculate from the manual attendee count *even when the list is unavailable* — so this global gate
> contradicts the Simple-first + empty-prompt ACs (non-hosts would still see "can't calculate").
> - **alternative:** derive `effectiveCostModel = canPerParticipant ? config.costModel : 'simple'`
>   and `participantListRequired = effectiveCostModel !== 'simple'`; show the unavailable block only
>   when `participantListRequired && !participantsAvailable`. Use the effective model for
>   totals/summary/readout. Keep passing `participantsAvailable` to the Simple count helper only to
>   decide blank/prompt.
> - **win:** centralizes the role-lock + list-availability invariant, kills the false "cannot
>   calculate" path for non-hosts, makes $0-until-filled testable from one predicate.

### IMPORTANT — Panel shrink can delete the private-data disclosure _(two-way · nonstandard)_
> The "delete secondary helper paragraphs" rule would remove the ⚠️ disclosure in the private
> per-person panel ([PresenterControls.jsx:237](../client/src/components/PresenterControls.jsx#L237))
> — that values are stored server-side, encrypted but operator-decryptable, and included in
> export/delete. That's an informed-consent notice, not filler; deleting it is a privacy regression
> for hosts still using per-participant.
> - **alternative:** keep the one-line-helper rule but **explicitly preserve** that disclosure as a
>   concise single note.
> - **win:** shrinks the panel without removing the consent notice for persisted per-person data.

## Design decisions (2026-07-08)

Thomas approved scope (Simple-by-default for everyone + non-host lockdown + panel shrink + docs
everywhere; relaunch-OK for role; stop-counting bug deferred) and ratified:

- **BLOCKER (App-level effective-model gate) → fix.** In `App`, derive
  `canPerParticipant = isHostRole(self?.role)`, `effectiveCostModel = canPerParticipant ?
  config.costModel : 'simple'`, and `participantListRequired = effectiveCostModel !== 'simple'`. The
  "Participants unavailable" screen shows only when `participantListRequired && !participantsAvailable`;
  totals/summary/readout use `effectiveCostModel`. Non-hosts (and hosts in Simple) always calculate.
- **IMPORTANT (preserve disclosure) → fix.** The shrink keeps the server-storage/consent disclosure
  in the per-person panel as a concise single line; only genuinely-redundant helper paragraphs are
  collapsed.
- **Shrink extent → baseline + single status line.** Structural gating + one-line helper copy +
  one-line Cost-overlay status. Preview-disclosure and cadence-overflow are deferred follow-ups.
- **Role default → mock `self.role: 'host'`; production unknown/missing role → Simple-locked.**
- **Boot default → `'simple'` for everyone** (reverses last story's `'perParticipant'`), via the
  existing `booted` object so the `lastSavedRef` clean-load guard still suppresses an echo save.
