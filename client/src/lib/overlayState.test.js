import { describe, it, expect } from 'vitest';
import { buildOverlayState, extrapolateOverlay } from './overlayState.js';

const totals = {
  attendeeCount: 3,
  combinedHourly: 465,
  costPerMinute: 7.75,
  costPerSecond: 465 / 3600,
};

describe('buildOverlayState', () => {
  it('emits exactly the sanitized aggregate fields', () => {
    const out = buildOverlayState({
      status: 'running',
      totalCost: 12.345,
      totals,
      elapsedSeconds: 90,
      updatedAt: 1000,
    });
    expect(Object.keys(out).sort()).toEqual(
      [
        'attendees',
        'costPerSecond',
        'currency',
        'elapsedSeconds',
        'prefs',
        'status',
        'totalCost',
        'updatedAt',
      ].sort()
    );
    expect(out.totalCost).toBe(12.35); // rounded to cents
    expect(out.attendees).toBe(3);
    expect(out.currency).toBe('USD');
  });

  it('never carries participant names or individual rates', () => {
    const out = buildOverlayState({
      status: 'running',
      totalCost: 5,
      totals,
      elapsedSeconds: 10,
      updatedAt: 1,
    });
    const serialized = JSON.stringify(out).toLowerCase();
    expect(serialized).not.toContain('name');
    expect(serialized).not.toContain('rate');
    expect(serialized).not.toContain('participant');
    expect(out.prefs).toEqual({});
  });
});

describe('extrapolateOverlay', () => {
  it('returns null without state', () => {
    expect(extrapolateOverlay(null)).toBe(null);
  });

  it('advances total + elapsed while running', () => {
    const state = {
      status: 'running',
      totalCost: 10,
      costPerSecond: 2,
      elapsedSeconds: 100,
      updatedAt: 1000,
    };
    const out = extrapolateOverlay(state, 1000 + 5000); // +5s
    expect(out.totalCost).toBeCloseTo(20, 5);
    expect(out.elapsedSeconds).toBeCloseTo(105, 5);
  });

  it('stays frozen when not running', () => {
    const state = {
      status: 'paused',
      totalCost: 10,
      costPerSecond: 2,
      elapsedSeconds: 100,
      updatedAt: 1000,
    };
    expect(extrapolateOverlay(state, 9999)).toEqual({
      totalCost: 10,
      elapsedSeconds: 100,
    });
  });
});
