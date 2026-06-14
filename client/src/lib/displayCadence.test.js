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
      expect(normalizeDisplayInterval(45)).toBe(60);
      expect(normalizeDisplayInterval(1000)).toBe(60);
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

    it('passes through unchanged for stepSeconds <= 1', () => {
      const out = quantizeForDisplay({
        totalCost: 12.5,
        elapsedSeconds: 7,
        costPerSecond: 3,
        stepSeconds: 1,
      });
      expect(out).toEqual({ totalCost: 12.5, elapsedSeconds: 7 });
    });

    it('guards null / non-finite input', () => {
      expect(quantizeForDisplay({})).toEqual({ totalCost: 0, elapsedSeconds: 0 });
      expect(
        quantizeForDisplay({ totalCost: NaN, elapsedSeconds: -5, costPerSecond: null, stepSeconds: 10 })
      ).toEqual({ totalCost: 0, elapsedSeconds: 0 });
    });
  });

  describe('formatCadenceDuration', () => {
    it('drops seconds entirely at the 1-minute cadence', () => {
      expect(formatCadenceDuration(90, 60)).toBe('1m'); // no colon / seconds
      expect(formatCadenceDuration(90, 60)).not.toMatch(/:/);
      expect(formatCadenceDuration(5160, 60)).toBe('1h 26m');
      expect(formatCadenceDuration(0, 60)).toBe('0m');
    });
    it('keeps h:mm:ss for the faster cadences', () => {
      expect(formatCadenceDuration(83, 1)).toBe('00:01:23');
      expect(formatCadenceDuration(70, 10)).toBe('00:01:10');
    });
  });
});
