import { describe, it, expect } from 'vitest';
import { shouldPersistConfig } from './usePresenterStore.js';

// The persistence guard that fixes the hydration double-save / clean-load echo
// (rate-list-dedupe review). The store marks the loaded/healed config as `lastSaved`
// at hydration; the debounced effect saves only a genuinely changed config (a new
// object), never echoing what was just loaded or just saved.

describe('shouldPersistConfig', () => {
  const cfg = { rateTable: [] };

  it('does not save before hydration', () => {
    expect(shouldPersistConfig(false, cfg, null)).toBe(false);
    expect(shouldPersistConfig(false, cfg, cfg)).toBe(false);
  });

  it('does not echo a just-hydrated config (clean load writes zero, dirty double-save suppressed)', () => {
    // Hydration sets lastSaved to the exact loaded/healed object → same reference → skip.
    expect(shouldPersistConfig(true, cfg, cfg)).toBe(false);
  });

  it('saves a genuine user edit after a clean load (a new object ≠ lastSaved)', () => {
    const edited = { ...cfg, defaultRate: 120 }; // an edit always produces a new object
    expect(shouldPersistConfig(true, edited, cfg)).toBe(true);
  });

  it('saves again on a subsequent distinct edit', () => {
    const first = { ...cfg, defaultRate: 120 };
    const second = { ...first, defaultRate: 130 };
    // After `first` was saved, lastSaved advances to `first`; the next edit still differs.
    expect(shouldPersistConfig(true, second, first)).toBe(true);
  });
});
