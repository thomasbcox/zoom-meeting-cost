Date: 2026-07-03 · Branch: claude/save-attendee-and-name · Status: approved

## Problem

Two presenter-panel UX issues (Thomas's original criticisms #1 and #3):

1. **Redundant "Your name" field.** The RoleBar always renders an editable "Your name"
   input (`RoleBar.jsx`). In real Zoom the presenter's identity already comes from the SDK —
   `seedPresenterName(self)` seeds `myName` from `self.displayName`
   (`App.jsx:26`) — so the field is redundant and editing it is pointless; it only feeds the
   readout's "Presenter: X" line (`SharedCostScreen.jsx:31`). It exists as a mock harness
   convenience, but shows in the real product where it "makes no sense."
2. **No way to promote a live attendee into the saved list.** The Per-participant section
   (`OverridesEditor` in `PresenterControls.jsx`) lists current attendees with a per-meeting
   override box, entirely separate from the saved private rate table — there's no one-click
   way to move an attendee (at the value you're using for them) into your saved list.

## In scope

- **(Part 1)** Render the editable "Your name" field **only in mock mode**; in real Zoom
  the presenter name is taken from the Zoom identity (`self.displayName`, unchanged) and
  shown in the readout — no editable field.
- **(Part 2)** Add a per-attendee **"Save to list"** control in the Per-participant section
  that adds an attendee **not already in the private list** to the saved rate table
  (`addRule`) at their currently-resolved rate and clears any per-meeting override for them.
  List membership is determined **explicitly** by normalized-name direct-or-alias match
  against the saved `rateTable`/`aliases` — **not** by the resolved `source` (a manual
  override makes an already-saved attendee's `source` `'manual'`, so `source` is not a safe
  membership proxy). Attendees already in the list show no Save control.
- A small **pure, unit-tested** helper for the save decision + payload.

## Non-goals

- No change to identity resolution (`seedPresenterName` / `getUserContext`), the readout, or
  the overlay. `myName` stays derived from `self.displayName`.
- No change to the store's `addRule` / `clearOverride` semantics, the matching logic, or the
  rate table editor.
- No new test dependency (client tests stay node-env; the save logic is tested via the
  extracted helper, not a rendered component).
- No changes beyond `RoleBar.jsx`, `PresenterControls.jsx`, and the new helper + its test.

## Acceptance criteria

1. **(Part 1)** In **real Zoom** mode the editable "Your name" field is **not** rendered in
   the RoleBar; the presenter name in the readout still comes from the Zoom identity
   (`self.displayName`). In **mock** mode the editable field remains (harness convenience).
2. **(Part 2)** Each attendee **not** already in the saved list — by normalized-name direct
   or alias match against `config.rateTable`/`aliases`, **regardless of current `source`** —
   shows a "Save to list" control. Clicking it calls `addRule(displayName, resolvedRate)`
   **and** `clearOverride(id)`; after the re-resolve the attendee is `matched` at the saved
   rate (no lingering override).
3. **(Part 2)** An attendee **already in the saved list** (direct or alias match) shows
   **no** Save control (a muted "in list" marker instead) — **even when a per-meeting override
   currently makes its `source` `'manual'`** — so clicking never creates a duplicate or
   alias-conflicting row.
4. The save decision + payload is a **pure exported helper** with unit tests.
5. Scope containment: `git diff --name-only main...HEAD` shows no files beyond
   `client/src/components/RoleBar.jsx`, `client/src/components/PresenterControls.jsx`, the new
   helper module + its test under `client/src/lib/**`, and `reviews/save-attendee-and-name*`.

## Test notes

- **AC2/AC3/AC4:** `client/src/lib/saveToList.test.js` — `saveToListTarget(participant, config)`
  returns `null` when the name is already in the list and `{ name: displayName, rate }` when
  not, driven by explicit membership (not `source`). Cases: **direct match → null**;
  **manual override over a direct match → null** (the BLOCKER case); **manual override over an
  alias match → null**; **default, not in list → { name, rate }**; **manual override on a
  name not in list → { name, rate: overrideRate }**. The `addRule` + `clearOverride` wiring and
  re-resolve-to-`matched` are consequences of existing, already-tested store + matching code.
- **AC1:** verified by the diff (the `isMock` gate around the name field). `RoleBar` is a
  hooks component with no node-env render harness, so it isn't unit-rendered — the change is
  a declarative conditional.
- **AC5 (scope containment):** run `git diff --name-only main...HEAD` and verify no files
  appear beyond those AC5 enumerates.
- Gate: `npm test && npm run build`.

## Open questions

1. **Part 1 — mock-only vs remove entirely.** Recommend **mock-only** (keeps the local
   harness ability to test a different presenter name; removes it from the real product,
   which is the objection). Alternative: drop it in mock too.
2. **Part 2 — clear the override on save.** Recommend **yes** (so the row cleanly resolves to
   the new `matched` rule instead of showing a lingering per-meeting `manual` override of the
   same value). Alternative: leave the override.
3. **Part 2 — matched-row affordance.** Recommend a muted **"in list"** marker (vs an empty
   cell) so the state is legible. Minor.

## Design sketch — HOW

- **Part 1 (`RoleBar.jsx`):** wrap the existing `<label className="rb-field">Your name …
  </label>` block in `{isMock && ( … )}`. Nothing else changes — `myName` is still seeded
  from `self.displayName` in `App.jsx` and flows to the readout. `setMyName` stays used only
  inside the mock-gated input.
- **Part 2 helper (`client/src/lib/saveToList.js`):** membership is explicit, mirroring
  `resolveParticipant`'s matched branch and **reusing** `matching.js` exports (no reinvention):
  ```
  import { normalizeName, buildRateIndex, buildAliasIndex } from './matching.js';
  export function saveToListTarget(participant, config) {
    const rateIndex = buildRateIndex(config.rateTable);
    const aliasIndex = buildAliasIndex(config.aliases);
    const norm = normalizeName(participant.displayName);
    const inList = rateIndex.has(norm) || (aliasIndex.has(norm) && rateIndex.has(aliasIndex.get(norm)));
    return inList ? null : { name: participant.displayName, rate: participant.rate };
  }
  ```
  `null` ⇒ already saved (direct or alias), regardless of a current manual override ⇒ no
  button. Otherwise the `{ name, rate }` to persist. Pure, node-testable. (Indexes are rebuilt
  per call; the attendee list is tiny, so this is negligible — passing precomputed indexes is
  an option but not worth the extra surface.)
- **Part 2 UI (`OverridesEditor` in `PresenterControls.jsx`):** thread `config` into
  `OverridesEditor` (already a prop of `PresenterControls`). Per row: add a trailing `<td>`
  with `const target = saveToListTarget(p, config);` then render either a
  `<button className="btn tiny" onClick={() => { actions.addRule(target.name, target.rate); actions.clearOverride(p.id); }}>＋ Save</button>`
  when `target`, or a `<span className="muted small">in list</span>` when already saved. Reuses
  the existing `addRule` / `clearOverride` actions and `.btn.tiny` styling — no new dependency,
  no new store action, no CSS.

## Codex design review (2026-07-03)

**Verdict: right small shape, one BLOCKER — folded in.** Mock-gating the name field is
sound (`myName` still flows from `seedPresenterName(self)` in real Zoom), and reusing
`addRule` + `clearOverride` avoids a needless store action.

- **[BLOCKER · one-way · kludgy] Save helper confused rate `source` with saved-list
  membership.** `resolveParticipant` gives manual overrides precedence over direct/alias
  matching, so an attendee already in the private list becomes `source: 'manual'` when
  overridden — the sketched `source !== 'matched'` test would show Save and `addRule` a
  **duplicate same-name / alias-conflicting rule** (persisted before `clearOverride`
  re-resolves). One-way because it writes bad data into the user's saved store.
  _Alternative:_ explicit membership predicate — helper takes `(participant, config)`, reuses
  `normalizeName` / `buildRateIndex` / `buildAliasIndex`, returns `null` for direct- or
  alias-backed saved names regardless of current override; wire `addRule`+`clearOverride`
  only when the target is non-null. Tests for manual-over-direct, manual-over-alias, default
  unsaved, manual unsaved. **→ folded into In scope, AC2/AC3, test notes, and the sketch.**

## Design decisions (2026-07-03)

Thomas approved the scope as written. Dispositions:

1. **Codex BLOCKER (source vs saved-list membership)** — **fix.** `saveToListTarget(participant,
   config)` decides membership explicitly via `normalizeName`/`buildRateIndex`/`buildAliasIndex`,
   independent of `source`. (Folded into the sketch.)
2. **Open questions** — all three taken at the recommendation: (1) name field **mock-only**;
   (2) **clear the override** on save; (3) muted **"in list"** marker for saved rows.

This shape is binding on implementation.

## Build note (2026-07-03)

AC → file map:

- **AC1 (name field mock-only)** — `client/src/components/RoleBar.jsx` (`isMock` gate).
- **AC2/AC3 (save-to-list button + membership)** — `client/src/components/PresenterControls.jsx`
  (`OverridesEditor`: `config` threaded, Save button / "in list" marker).
- **AC4 (pure helper + tests)** — `client/src/lib/saveToList.js` · test
  `client/src/lib/saveToList.test.js`.
- **AC5 (scope containment)** — `git diff --name-only main...HEAD`.

## Codex approach review (2026-07-04, base main, HEAD d735202)

**Verdict: Sound shape — no findings.** Codex's own sketch matched: mock-gate only the
RoleBar name input, keep identity flowing from `self.displayName`, a pure
`saveToListTarget(participant, config)` reusing the matching indexes/normalization for
explicit membership, wired to existing `addRule` + `clearOverride` — no new store action or
dependency. Branch follows that shape, within approved scope. (Focused Vitest run blocked by
the read-only sandbox's `.vite-temp` write — environmental, not a finding.)

_Empty findings → shape blessed; proceeded to the correctness pass in the same round._

## Codex review (2026-07-04, base main, HEAD d735202)

**Summary: no issues.** The branch stays within the approved file scope, mock-gates the
presenter name field, implements explicit direct/alias saved-list membership via a pure
helper, and wires Save to `addRule(target.name, target.rate)` + `clearOverride(p.id)` as
specified. (Focused Vitest blocked by the read-only sandbox's `.vite-temp` write — the gate
was run green locally before both passes.)

No findings.
