import { describe, it, expect } from 'vitest';
import { saveToListTarget } from './saveToList.js';

const config = {
  rateTable: [
    { id: 'r1', name: 'Thomas Cox', rate: 150 },
    { id: 'r2', name: 'Jane Smith', rate: 95 },
  ],
  aliases: [
    { id: 'a1', alias: 'Tom Cox', canonical: 'Thomas Cox' },
    { id: 'a2', alias: 'Ghost', canonical: 'Nobody Saved' }, // canonical has no rule
  ],
};

describe('saveToListTarget', () => {
  it('returns null for a direct name match (already saved)', () => {
    expect(saveToListTarget({ id: 'p1', displayName: 'Thomas Cox', rate: 150 }, config)).toBe(null);
  });

  it('returns null when a manual override sits over a direct match (the BLOCKER case)', () => {
    // rate differs from the saved 150 (an override) but the name is in the table → still saved.
    expect(saveToListTarget({ id: 'p1', displayName: 'Thomas Cox', rate: 999 }, config)).toBe(null);
  });

  it('returns null when an override sits over an ALIAS-backed match', () => {
    // 'Tom Cox' → 'Thomas Cox' (which has a rule) → already saved, regardless of override.
    expect(saveToListTarget({ id: 'p2', displayName: 'Tom Cox', rate: 999 }, config)).toBe(null);
  });

  it('is case-insensitive on the name (uses normalizeName)', () => {
    expect(saveToListTarget({ id: 'p3', displayName: 'thomas cox', rate: 150 }, config)).toBe(null);
  });

  it('returns { name, rate } for a default (not-in-list) attendee', () => {
    expect(saveToListTarget({ id: 'p4', displayName: 'Dana Rivera', rate: 75 }, config)).toEqual({
      name: 'Dana Rivera',
      rate: 75,
    });
  });

  it('returns { name, rate: overrideRate } for an override on a name not in the list', () => {
    expect(saveToListTarget({ id: 'p5', displayName: 'New Person', rate: 200 }, config)).toEqual({
      name: 'New Person',
      rate: 200,
    });
  });

  it('is savable when an alias points at a canonical that has no rule', () => {
    // 'Ghost' → 'Nobody Saved', but 'Nobody Saved' has no rateTable entry → not saved.
    expect(saveToListTarget({ id: 'p6', displayName: 'Ghost', rate: 50 }, config)).toEqual({
      name: 'Ghost',
      rate: 50,
    });
  });
});
