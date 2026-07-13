import { describe, it, expect } from 'vitest';
import { computeSimpleTotals, formatMoney, formatDuration } from './cost.js';

describe('cost', () => {
  describe('computeSimpleTotals', () => {
    it('computes N × hourly rate into hourly / minute / second', () => {
      const t = computeSimpleTotals({ userCount: 3, averageRate: 120 });
      expect(t.attendeeCount).toBe(3);
      expect(t.combinedHourly).toBe(360);
      expect(t.costPerMinute).toBeCloseTo(6, 6);
      expect(t.costPerSecond).toBeCloseTo(0.1, 6);
    });

    it('clamps negative / non-numeric / missing count and rate to 0', () => {
      expect(computeSimpleTotals({ userCount: -2, averageRate: 100 }).attendeeCount).toBe(0);
      expect(computeSimpleTotals({ userCount: 3, averageRate: 'x' }).combinedHourly).toBe(0);
      expect(computeSimpleTotals({}).combinedHourly).toBe(0);
      expect(computeSimpleTotals()).toMatchObject({ attendeeCount: 0, combinedHourly: 0 });
    });
  });

  describe('formatMoney', () => {
    it('formats USD with 2 decimals by default', () => {
      expect(formatMoney(1234.5)).toBe('$1,234.50');
      expect(formatMoney(0)).toBe('$0.00');
    });

    it('honors a decimals override and coerces junk to $0', () => {
      expect(formatMoney(1234.5, { decimals: 0 })).toBe('$1,235');
      expect(formatMoney('nope')).toBe('$0.00');
    });
  });

  describe('formatDuration', () => {
    it('formats h:mm:ss and clamps negatives to zero', () => {
      expect(formatDuration(83)).toBe('00:01:23');
      expect(formatDuration(3661)).toBe('01:01:01');
      expect(formatDuration(-5)).toBe('00:00:00');
    });
  });
});
