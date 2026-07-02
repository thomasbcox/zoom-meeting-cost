Date: 2026-07-02 · Branch: claude/rate-input-sync · Status: approved

## Problem

Two bugs in the presenter panel's rate inputs, found in live dev testing:

1. **Stale display after hydration (the "borked memory").** The rate-table cells (and the
   default-rate / simple-rate fields) use `NumberInput`, whose editable text is a local
   `draft` seeded **once at mount** and only re-synced **on focus**
   (`PresenterControls.jsx:362`). The panel mounts with the *default* config, then the
   presenter's saved config loads from the server a beat later (async). `resolveAll` reads
   the rate straight from `config.rateTable` (`matching.js:56`) so the resolved readout
   immediately shows the saved value (e.g. `Thomas Cox · matched · $250`), but each
   `NumberInput`'s draft is still the pre-hydration default (`150`) and never updates — so
   the *editable table* shows `150` while the readout shows `250`. The data is correct and
   persisted; only the input display is stale until the field is focused.

2. **Negative value accepted in the input.** The rate inputs are `<input type="number">`
   with no `min="0"`, so a negative (e.g. `-1`) can be typed/spun and is shown until blur.
   It cannot *persist* (the store's `clampNum(_, 0)` and the server's `validateConfig`
   reject negatives), but the input should not present it.

## In scope

- Make `NumberInput` re-sync its draft from the `value` prop when the field is **not
  focused**, so an async-loaded (hydrated) value replaces the stale default — while
  **preserving** the in-progress draft when the field **is** focused (the existing
  live-attendee-count-tracking behavior, guarded by `focusedValueRef`, must not regress).
- Extract the focused/unfocused draft decision into a small **pure, unit-tested** helper.
- Add `min="0"` to the panel's rate number inputs (`NumberInput`, the add-row `$/hr`
  input, and the per-participant override input) so negatives are rejected by the browser
  and self-correct to `≥0` on blur (via the resync above + existing store clamp).

## Non-goals

- No change to the store clamp (`clampNum`) or server validation (`validateConfig`) — they
  already prevent negative *persistence*; this story is the input UX + stale display.
- No new test dependency (jsdom / testing-library). Client tests stay node-env pure-logic;
  the draft-sync logic is tested via the extracted helper, not a rendered component.
- No hard per-keystroke blocking of a partial negative (`-`); `min="0"` + clamp-on-blur is
  sufficient.
- No changes outside `PresenterControls.jsx` and the new helper + its test.

## Acceptance criteria

1. When a `NumberInput`'s `value` prop changes while the field is **not focused**, the
   displayed draft updates to match the new value (a server-loaded rate replaces the stale
   mounted default). When the field **is focused**, the in-progress draft is preserved
   (not clobbered by a `value` change) — so the live-attendee-count field still tracks the
   live count while unfocused and honors the user's typing while focused.
2. The focused/unfocused draft decision is a **pure exported helper** with unit tests.
3. The rate number inputs (`NumberInput`, the add-row `$/hr` input, and the override
   input) carry `min="0"`. A negative committed via any of them ends up `≥0` in both the
   store and the displayed field (store clamp + AC1 resync).
4. Scope containment: `git diff --name-only main...HEAD` shows no files beyond
   `client/src/components/PresenterControls.jsx`, the new helper module + its test under
   `client/src/lib/**`, and `reviews/rate-input-sync*`.

## Test notes

- **AC1/AC2:** `client/src/lib/numberInputDraft.test.js` — `displayDraft({ value, isFocused,
  currentDraft })` returns `String(value)` when **unfocused** (covers `150→'150'`,
  `250→'250'`, `null/undefined→''`) and returns `currentDraft` unchanged when **focused**.
  This encodes both the resync rule and the focus-preservation invariant that `NumberInput`
  applies in its effect.
- **AC3:** verified by the diff (the declarative `min="0"` on the three inputs) plus the
  existing, already-tested guarantee that negatives can't persist (`clampNum` in the store;
  `validateConfig` on the server) — no behavior regression. The transient of a partial
  negative resolves to `≥0` on blur via the AC1 resync.
- **AC4 (scope containment):** run `git diff --name-only main...HEAD` and verify no files
  appear beyond those AC4 enumerates.
- Gate: `npm test && npm run build`.

## Open questions

1. Also hard-block negatives per-keystroke (sanitize `onChange`), or is `min="0"` +
   clamp-on-blur enough? Recommend **enough** — keystroke blocking fights partial input and
   the value self-corrects on blur. (Minor; not a blocker.)

## Design sketch — HOW

- **New `client/src/lib/numberInputDraft.js`** — a pure helper:
  `export function displayDraft({ value, isFocused, currentDraft }) {
     return isFocused ? currentDraft : String(value ?? ''); }`
  When focused the user owns the draft; when not, it mirrors the external `value`
  (`null/undefined → ''`). This is the single source of the resync rule and is unit-tested.
- **`NumberInput` (PresenterControls.jsx)** — add an effect keyed on `value` that applies
  the helper, using the **existing** `focusedValueRef` as the focus signal (non-null =
  focused), so no new focus state is introduced and the prior Codex-reviewed
  "don't-pin-the-live-count" behavior is preserved:
  `useEffect(() => {
     const isFocused = focusedValueRef.current != null;
     const next = displayDraft({ value, isFocused, currentDraft: draft });
     if (next !== draft) setDraft(next);
   }, [value]);`  // eslint-disable exhaustive-deps (draft/ref read intentionally)
  When focused, `displayDraft` returns the current draft → `next === draft` → no write, so
  typing is never clobbered. When unfocused, it mirrors `value` → fixes the stale table.
- **`min="0"`** added to: the `NumberInput` `<input>`, the add-row `$/hr` `<input>`, and the
  per-participant override `<input>`. Declarative; combined with the resync a committed
  negative shows as the clamped `≥0` after blur.
- No new dependency; reuses existing patterns (small tested `lib/` helper; the store's
  clamp and server validation are unchanged).

## Codex design review (2026-07-02)

**Verdict: not sound as sketched — one BLOCKER, folded in.** The high-level pattern
(controlled draft that mirrors `value` while unfocused, preserves typing while focused, no
new dependency) is right; the wiring was wrong.

- **[BLOCKER · two-way · kludgy] Ref-only resync misses unchanged clamped commits.** The
  `[value]`-only effect with `focusedValueRef` as the focus signal fails when a negative
  clamps back to the *same* `value`: field at `0`, type `-1`, blur commits `clampNum→0`, so
  `value` is unchanged and the effect never runs → draft stays `-1`, violating AC3.
  _Alternative:_ make `isFocused` explicit **state**; keep `focusedValueRef` only as the
  original-focus-value guard. Sync with
  `useEffect(() => { if (!isFocused) setDraft(cur => displayDraft({ value, isFocused: false, currentDraft: cur })); }, [value, isFocused])`.
  Blur flips `isFocused → false`, firing the effect and resyncing from `value` even when
  `value` didn't change. _Win:_ covers hydration, live-count tracking, focused typing, and
  the zero/clamp display path — without jsdom, per-keystroke sanitizing, or an
  exhaustive-deps suppression.

**Both the correctness gap and the cleaner shape are accepted (sketch revised below).**

### Sketch revision (folding in the BLOCKER fix)

Replace the `NumberInput` bullet's ref-only effect with **explicit focus state**:

- Add `const [isFocused, setIsFocused] = useState(false)`. Keep `focusedValueRef` solely as
  the original-focus-value guard (the live-attendee-count "don't pin" protection).
- `onFocus`: `setDraft(String(value ?? ''))`, `focusedValueRef.current = s`, `setIsFocused(true)`.
- `onBlur`: `commitIfChanged()`, then `setIsFocused(false)`. (Enter: `commitIfChanged()` +
  `blur()`, which runs the same blur path.)
- Effect: `useEffect(() => { if (isFocused) return; setDraft(cur => displayDraft({ value, isFocused: false, currentDraft: cur })); }, [value, isFocused]);` — deps complete (functional
  `setDraft`, so `draft` isn't a dep); no exhaustive-deps disable. Unfocused →
  `displayDraft` returns `String(value ?? '')` deterministically, so a blur (focus true→false)
  resyncs the draft even when `value` is unchanged, clearing a clamped `-1`.

## Design decisions (2026-07-02)

Thomas approved the scope as written. Aside: he considered a seed-data-policy change
(don't persist the sample rows for real users) and **declined** — "fine with users getting
our sample data stored when they don't bother to update things" — so the seed stays as-is
and is out of scope here (would be a separate story if ever wanted). Dispositions:

1. **Codex BLOCKER (ref-only resync misses clamped commits)** — **fix.** Explicit
   `isFocused` state; sync on `[value, isFocused]`; `focusedValueRef` kept only as the
   original-focus-value guard. (Folded into the sketch.)
2. **Open question (per-keystroke negative blocking)** — **no**; `min="0"` + clamp-on-blur
   is sufficient.

This shape is binding on implementation.
