import { describe, it, expect } from 'vitest';
import {
  buildRateIndex,
  buildAliasIndex,
  resolveParticipant,
  resolveAll,
  SOURCE,
} from './matching.js';

describe('rate matching logic', () => {
  const rateTable = [
    { id: 'r1', name: 'Thomas Cox', rate: 150 },
    { id: 'r2', name: 'Jane Smith', rate: 95 },
  ];

  const aliases = [
    { id: 'a1', alias: 'Tom Cox', canonical: 'Thomas Cox' },
  ];

  const ctx = {
    rateIndex: buildRateIndex(rateTable),
    aliasIndex: buildAliasIndex(aliases),
    overrides: {},
    defaultRate: 75,
  };

  describe('resolveParticipant', () => {
    it('should match a participant directly by exact canonical name', () => {
      const p = { id: 'p1', displayName: 'Thomas Cox' };
      const res = resolveParticipant(p, ctx);
      expect(res.baseRate).toBe(150);
      expect(res.source).toBe(SOURCE.MATCHED);
      expect(res.matchedName).toBe('Thomas Cox');
    });

    it('should match a participant ignoring capitalization and trailing spaces', () => {
      const p = { id: 'p1', displayName: '  thomas   cox. ' };
      const res = resolveParticipant(p, ctx);
      expect(res.baseRate).toBe(150);
      expect(res.source).toBe(SOURCE.MATCHED);
      expect(res.matchedName).toBe('Thomas Cox');
    });

    it('should match a participant via name alias', () => {
      const p = { id: 'p1', displayName: 'Tom Cox' };
      const res = resolveParticipant(p, ctx);
      expect(res.baseRate).toBe(150);
      expect(res.source).toBe(SOURCE.MATCHED);
      expect(res.matchedName).toBe('Thomas Cox');
    });

    it('should favor manual overrides over exact matches or aliases', () => {
      const p = { id: 'p1', displayName: 'Thomas Cox' };
      const customCtx = {
        ...ctx,
        overrides: { p1: 200 },
      };
      const res = resolveParticipant(p, customCtx);
      expect(res.baseRate).toBe(200);
      expect(res.source).toBe(SOURCE.MANUAL);
      expect(res.matchedName).toBeNull();
    });

    it('should fall back to default rate if no match or alias exists', () => {
      const p = { id: 'p2', displayName: 'Unknown Employee' };
      const res = resolveParticipant(p, ctx);
      expect(res.baseRate).toBe(75);
      expect(res.source).toBe(SOURCE.DEFAULT);
      expect(res.matchedName).toBeNull();
    });
  });

  describe('resolveAll', () => {
    it('should resolve multiple participants and apply loaded-cost multiplier', () => {
      const participants = [
        { id: 'p1', displayName: 'Thomas Cox' },
        { id: 'p2', displayName: 'Unknown User' },
      ];
      const config = {
        rateTable,
        aliases,
        overrides: { p1: 100 }, // overrides Thomas Cox to $100 base
        defaultRate: 50,
        multiplier: 1.25, // 25% loaded-cost overhead
      };

      const resolved = resolveAll(participants, config);
      expect(resolved).toHaveLength(2);

      // p1 (Thomas Cox) has an override of 100 base rate. With 1.25 multiplier, rate is 125.
      expect(resolved[0]).toEqual({
        id: 'p1',
        displayName: 'Thomas Cox',
        baseRate: 100,
        rate: 125,
        source: SOURCE.MANUAL,
        matchedName: null,
      });

      // p2 (Unknown User) falls back to default 50. With 1.25 multiplier, rate is 62.5.
      expect(resolved[1]).toEqual({
        id: 'p2',
        displayName: 'Unknown User',
        baseRate: 50,
        rate: 62.5,
        source: SOURCE.DEFAULT,
        matchedName: null,
      });
    });
  });
});
