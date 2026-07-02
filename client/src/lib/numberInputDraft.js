// The draft string a NumberInput should display for a given external `value` and focus
// state. This is the single source of the "controlled draft" rule:
//
//   - focused   → the user owns the draft; keep whatever they've typed (currentDraft).
//   - unfocused → mirror the external value, so an async-loaded (hydrated) value replaces
//                 the stale mounted default, and a clamped commit (e.g. -1 → 0) shows the
//                 clamped value after blur. null/undefined → '' (empty field).
//
// Extracted as a pure function so it's unit-testable in the node-env test runner (no
// jsdom / rendered component). NumberInput applies it in a [value, isFocused] effect.

export function displayDraft({ value, isFocused, currentDraft }) {
  return isFocused ? currentDraft : String(value ?? '');
}
