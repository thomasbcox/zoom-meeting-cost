import { describe, it, expect } from 'vitest';
import {
  computeTotals,
  computeSimpleTotals,
  selectActiveTotals,
  formatMoney,
  formatDuration,
} from './cost.js';

describe('cost calculations and formatting', () => {
  describe('computeTotals', () => {
    it('should handle an empty list of participants', () => {
      const result = computeTotals([]);
      expect(result).toEqual({
        attendeeCount: 0,
        combinedHourly: 0,
        costPerMinute: 0,
        costPerSecond: 0,
      });
    });

    it('should sum rates correctly and compute minute/second rates', () => {
      const resolved = [
        { rate: 100 },
        { rate: 50 },
        { rate: 250 },
      ];
      const result = computeTotals(resolved);
      expect(result.attendeeCount).toBe(3);
      expect(result.combinedHourly).toBe(400);
      expect(result.costPerMinute).toBe(400 / 60);
      expect(result.costPerSecond).toBe(400 / 3600);
    });

    it('should ignore invalid rates gracefully', () => {
      const resolved = [
        { rate: 100 },
        { rate: 'not-a-number' },
        { rate: null },
        { rate: undefined },
      ];
      const result = computeTotals(resolved);
      expect(result.attendeeCount).toBe(4);
      expect(result.combinedHourly).toBe(100);
    });
  });

  describe('computeSimpleTotals', () => {
    it('computes N × rate × multiplier in the computeTotals shape', () => {
      const result = computeSimpleTotals({ userCount: 5, averageRate: 100, multiplier: 1.2 });
      expect(result).toEqual({
        attendeeCount: 5,
        combinedHourly: 600,
        costPerMinute: 600 / 60,
        costPerSecond: 600 / 3600,
      });
    });

    it('clamps negative / non-numeric inputs to 0', () => {
      expect(computeSimpleTotals({ userCount: -3, averageRate: 100, multiplier: 1 }).combinedHourly).toBe(0);
      expect(computeSimpleTotals({ userCount: 4, averageRate: 'x', multiplier: 1 }).combinedHourly).toBe(0);
      expect(computeSimpleTotals({ userCount: 4, averageRate: 100, multiplier: -1 }).combinedHourly).toBe(0);
      expect(computeSimpleTotals({}).combinedHourly).toBe(0);
    });
  });

  describe('selectActiveTotals', () => {
    const resolved = [{ rate: 100 }, { rate: 50 }];

    it("uses computeTotals(resolved) for 'perParticipant' (and unknown) models", () => {
      expect(selectActiveTotals({ costModel: 'perParticipant', resolved }).combinedHourly).toBe(150);
      expect(selectActiveTotals({ costModel: 'whatever', resolved }).combinedHourly).toBe(150);
      expect(selectActiveTotals({ resolved }).combinedHourly).toBe(150);
    });

    it("uses simple totals for 'simple' with simpleUserCount when set", () => {
      const t = selectActiveTotals({
        costModel: 'simple',
        resolved,
        simpleAverageRate: 100,
        simpleMultiplier: 1,
        simpleUserCount: 8,
        liveCount: 3,
      });
      expect(t.attendeeCount).toBe(8);
      expect(t.combinedHourly).toBe(800);
    });

    it("falls back to liveCount when simpleUserCount is null/blank", () => {
      const t = selectActiveTotals({
        costModel: 'simple',
        resolved,
        simpleAverageRate: 100,
        simpleMultiplier: 1,
        simpleUserCount: null,
        liveCount: 3,
      });
      expect(t.attendeeCount).toBe(3);
      expect(t.combinedHourly).toBe(300);
    });

    it("treats an explicit simpleUserCount of 0 as 0 (not the live count)", () => {
      const t = selectActiveTotals({
        costModel: 'simple',
        resolved,
        simpleAverageRate: 100,
        simpleMultiplier: 1,
        simpleUserCount: 0,
        liveCount: 3,
      });
      expect(t.attendeeCount).toBe(0);
      expect(t.combinedHourly).toBe(0);
    });
  });

  describe('formatMoney', () => {
    it('should format numbers to USD format', () => {
      expect(formatMoney(100)).toBe('$100.00');
      expect(formatMoney(1234.56)).toBe('$1,234.56');
      expect(formatMoney(0)).toBe('$0.00');
    });

    it('should handle custom decimal lengths', () => {
      expect(formatMoney(100.456, { decimals: 0 })).toBe('$100');
      expect(formatMoney(100.456, { decimals: 1 })).toBe('$100.5');
    });

    it('should handle non-numeric inputs gracefully', () => {
      expect(formatMoney('abc')).toBe('$0.00');
      expect(formatMoney(null)).toBe('$0.00');
    });
  });

  describe('formatDuration', () => {
    it('should format seconds into HH:MM:SS format', () => {
      expect(formatDuration(0)).toBe('00:00:00');
      expect(formatDuration(45)).toBe('00:00:45');
      expect(formatDuration(60)).toBe('00:01:00');
      expect(formatDuration(3600)).toBe('01:00:00');
      expect(formatDuration(3665)).toBe('01:01:05');
    });

    it('should handle negative numbers gracefully', () => {
      expect(formatDuration(-10)).toBe('00:00:00');
    });

    it('should handle float values by flooring them', () => {
      expect(formatDuration(65.7)).toBe('00:01:05');
    });
  });
});
