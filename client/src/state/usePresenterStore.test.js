import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, clampNum } from './usePresenterStore.js';

// The store is a thin session-only useState hook (no persistence). Its unit-testable
// surface is the shipped default config and the clamp its setters apply.

describe('usePresenterStore config', () => {
  it('defaults to 2 attendees × $100/hr at the 10s cadence', () => {
    expect(DEFAULT_CONFIG).toEqual({
      simpleAverageRate: 100,
      simpleUserCount: 2,
      displayIntervalSeconds: 10,
    });
  });

  it('clamps setter input to a numeric value at or above the floor', () => {
    expect(clampNum('42', 0)).toBe(42);
    expect(clampNum(-5, 0)).toBe(0);
    expect(clampNum('nope', 0)).toBe(0);
    expect(clampNum('', 0)).toBe(0);
  });
});
