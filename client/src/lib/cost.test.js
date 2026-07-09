import { describe, it, expect } from 'vitest';
import {
  computeTotals,
  computeSimpleTotals,
  selectActiveTotals,
  simpleCountCommit,
  costModelPatch,
  simpleCountDisplay,
  simpleLiveCount,
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
    it('computes N × rate in the computeTotals shape', () => {
      const result = computeSimpleTotals({ userCount: 5, averageRate: 100 });
      expect(result).toEqual({
        attendeeCount: 5,
        combinedHourly: 500,
        costPerMinute: 500 / 60,
        costPerSecond: 500 / 3600,
      });
    });

    it('ignores a stray legacy multiplier (the loaded-cost multiplier was removed)', () => {
      const result = computeSimpleTotals({ userCount: 5, averageRate: 100, multiplier: 99 });
      expect(result.combinedHourly).toBe(500);
    });

    it('clamps negative / non-numeric inputs to 0', () => {
      expect(computeSimpleTotals({ userCount: -3, averageRate: 100 }).combinedHourly).toBe(0);
      expect(computeSimpleTotals({ userCount: 4, averageRate: 'x' }).combinedHourly).toBe(0);
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
        simpleUserCount: 8,
        liveCount: 3,
      });
      expect(t.attendeeCount).toBe(8);
      expect(t.combinedHourly).toBe(800);
    });

    it("ignores a stray legacy simpleMultiplier in 'simple' mode", () => {
      const t = selectActiveTotals({
        costModel: 'simple',
        resolved,
        simpleAverageRate: 100,
        simpleMultiplier: 99,
        simpleUserCount: 8,
        liveCount: 3,
      });
      expect(t.combinedHourly).toBe(800);
    });

    it("falls back to liveCount when simpleUserCount is null/blank", () => {
      const t = selectActiveTotals({
        costModel: 'simple',
        resolved,
        simpleAverageRate: 100,
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
        simpleUserCount: 0,
        liveCount: 3,
      });
      expect(t.attendeeCount).toBe(0);
      expect(t.combinedHourly).toBe(0);
    });

    it("treats a blank ('') simpleUserCount as the live count (Codex #2)", () => {
      const t = selectActiveTotals({
        costModel: 'simple',
        resolved,
        simpleAverageRate: 100,
        simpleUserCount: '',
        liveCount: 4,
      });
      expect(t.attendeeCount).toBe(4);
      expect(t.combinedHourly).toBe(400);
    });
  });

  describe('simpleCountCommit (Codex #1: stray blur must not pin live tracking)', () => {
    it("returns '' (track live) for blank / non-numeric input", () => {
      expect(simpleCountCommit('', 3)).toBe('');
      expect(simpleCountCommit(null, 3)).toBe('');
      expect(simpleCountCommit('abc', 3)).toBe('');
    });

    it("returns '' (track live) when the value equals the live count", () => {
      expect(simpleCountCommit('3', 3)).toBe('');
      expect(simpleCountCommit(3, 3)).toBe('');
    });

    it('returns the value as an explicit override when it differs from live', () => {
      expect(simpleCountCommit('8', 3)).toBe('8');
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

  describe('costModelPatch', () => {
    it('switching to simple clears the attendee override (track the live count)', () => {
      expect(costModelPatch('simple')).toEqual({ costModel: 'simple', simpleUserCount: null });
    });

    it('switching to per-participant sets only the model (leaves simpleUserCount alone)', () => {
      const patch = costModelPatch('perParticipant');
      expect(patch).toEqual({ costModel: 'perParticipant' });
      expect('simpleUserCount' in patch).toBe(false);
    });

    it('any non-simple model resolves to per-participant', () => {
      expect(costModelPatch('anythingElse')).toEqual({ costModel: 'perParticipant' });
    });
  });

  describe('simpleCountDisplay', () => {
    it('shows a manual value as-is regardless of availability', () => {
      expect(simpleCountDisplay({ simpleUserCount: 5, liveCount: 9, participantsAvailable: true })).toBe('5');
      expect(simpleCountDisplay({ simpleUserCount: 5, liveCount: 0, participantsAvailable: false })).toBe('5');
    });

    it('tracks the live count when available and no manual value', () => {
      expect(simpleCountDisplay({ simpleUserCount: null, liveCount: 4, participantsAvailable: true })).toBe('4');
      expect(simpleCountDisplay({ simpleUserCount: '', liveCount: 4, participantsAvailable: true })).toBe('4');
    });

    it('is EMPTY (prompt), not 0, when the list is unavailable and nothing entered', () => {
      expect(simpleCountDisplay({ simpleUserCount: null, liveCount: 0, participantsAvailable: false })).toBe('');
      expect(simpleCountDisplay({ simpleUserCount: '', liveCount: 0, participantsAvailable: false })).toBe('');
    });
  });

  describe('simpleLiveCount', () => {
    it('passes the live count through when the list is available', () => {
      expect(simpleLiveCount(true, 5)).toBe(5);
      expect(simpleLiveCount(true, 0)).toBe(0);
    });

    it('is 0 when unavailable, even with a stale non-empty cached count', () => {
      // The regression: an unavailable list must not accrue on a cached snapshot.
      expect(simpleLiveCount(false, 3)).toBe(0);
      expect(simpleLiveCount(false, 99)).toBe(0);
    });

    it('coerces junk to 0', () => {
      expect(simpleLiveCount(true, undefined)).toBe(0);
      expect(simpleLiveCount(true, NaN)).toBe(0);
    });
  });
});
