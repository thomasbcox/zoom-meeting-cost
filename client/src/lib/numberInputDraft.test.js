import { describe, it, expect } from 'vitest';
import { displayDraft } from './numberInputDraft.js';

describe('displayDraft', () => {
  it('mirrors the external value when NOT focused (fixes stale hydration display)', () => {
    // The mounted default was 150; the server-loaded value is 250 → unfocused draft follows.
    expect(displayDraft({ value: 250, isFocused: false, currentDraft: '150' })).toBe('250');
    expect(displayDraft({ value: 150, isFocused: false, currentDraft: '150' })).toBe('150');
  });

  it('shows the clamped value when unfocused (a committed -1 → 0 displays as "0")', () => {
    // After blur, value is the clamped 0 even if the stale draft was "-1".
    expect(displayDraft({ value: 0, isFocused: false, currentDraft: '-1' })).toBe('0');
  });

  it('renders null/undefined value as an empty string when unfocused', () => {
    expect(displayDraft({ value: null, isFocused: false, currentDraft: '5' })).toBe('');
    expect(displayDraft({ value: undefined, isFocused: false, currentDraft: '5' })).toBe('');
  });

  it('preserves the in-progress draft when FOCUSED (never clobbers typing)', () => {
    // While focused, a value change (e.g. the live attendee count ticking) must not
    // overwrite what the user is typing.
    expect(displayDraft({ value: 250, isFocused: true, currentDraft: '3' })).toBe('3');
    expect(displayDraft({ value: 0, isFocused: true, currentDraft: '-1' })).toBe('-1');
  });

  it('stringifies numeric values', () => {
    expect(displayDraft({ value: 95, isFocused: false, currentDraft: '' })).toBe('95');
  });
});
