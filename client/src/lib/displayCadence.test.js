import { describe, it, expect } from 'vitest';
import {
  DISPLAY_INTERVALS,
  DEFAULT_DISPLAY_INTERVAL,
  normalizeDisplayInterval,
  quantizeForDisplay,
  formatCadenceDuration,
} from './displayCadence.js';

describe('displayCadence', () => {
  describe('normalizeDisplayInterval', () => {
    it('passes through allowed values', () => {
      for (const v of DISPLAY_INTERVALS) {
        expect(normalizeDisplayInterval(v)).toBe(v);
      }
    });
    it('snaps out-of-set values to the nearest allowed cadence', () => {
      expect(normalizeDisplayInterval(7)).toBe(10);
      expect(normalizeDisplayInterval(3)).toBe(1);
      expect(normalizeDisplayInterval(45)).toBe(10);
      expect(normalizeDisplayInterval(1000)).toBe(10);
    });
    it('falls back to the default for blank / non-finite input', () => {
      expect(normalizeDisplayInterval(null)).toBe(DEFAULT_DISPLAY_INTERVAL);
      expect(normalizeDisplayInterval('')).toBe(DEFAULT_DISPLAY_INTERVAL);
      expect(normalizeDisplayInterval(NaN)).toBe(DEFAULT_DISPLAY_INTERVAL);
    });
  });

  describe('quantizeForDisplay', () => {
    it('floors elapsed to the grid and walks the total back by the bucket fraction', () => {
      // cps = 2 $/s, 37s elapsed, total 74. Step 10 -> elapsed 30, total 74 - 2*7 = 60.
      const out = quantizeForDisplay({
        totalCost: 74,
        elapsedSeconds: 37,
        costPerSecond: 2,
        stepSeconds: 10,
      });
      expect(out.elapsedSeconds).toBe(30);
      expect(out.totalCost).toBeCloseTo(60, 6);
    });

    it('holds steady within a bucket and jumps at the boundary', () => {
      const at = (es) =>
        quantizeForDisplay({ totalCost: es * 2, elapsedSeconds: es, costPerSecond: 2, stepSeconds: 10 });
      expect(at(31).totalCost).toBeCloseTo(60, 6); // same bucket as 30
      expect(at(39).totalCost).toBeCloseTo(60, 6);
      expect(at(40).totalCost).toBeCloseTo(80, 6); // next boundary
    });

    it('floors at the 1s cadence too, so the display changes once per second (BUG-2)', () => {
      // elapsed 7.6s, cps 3 -> floor to 7s; total walked back by 3 * 0.6 = 1.8.
      const out = quantizeForDisplay({
        totalCost: 22.8,
        elapsedSeconds: 7.6,
        costPerSecond: 3,
        stepSeconds: 1,
      });
      expect(out.elapsedSeconds).toBe(7);
      expect(out.totalCost).toBeCloseTo(21, 6);
    });

    it('guards null / non-finite input', () => {
      expect(quantizeForDisplay({})).toEqual({ totalCost: 0, elapsedSeconds: 0 });
      expect(
        quantizeForDisplay({ totalCost: NaN, elapsedSeconds: -5, costPerSecond: null, stepSeconds: 10 })
      ).toEqual({ totalCost: 0, elapsedSeconds: 0 });
    });
  });

  describe('formatCadenceDuration', () => {
    it('shows h:mm:ss for the {1, 10}s cadences', () => {
      expect(formatCadenceDuration(83)).toBe('00:01:23');
      expect(formatCadenceDuration(70)).toBe('00:01:10');
    });
  });
});
