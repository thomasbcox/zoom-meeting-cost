import { describe, it, expect } from 'vitest';
import { isHostRole } from './role.js';

describe('isHostRole', () => {
  it('accepts host and co-host across casings/spellings', () => {
    for (const r of ['host', 'Host', 'HOST', 'coHost', 'cohost', 'co-host', 'Co-Host', 'co_host']) {
      expect(isHostRole(r)).toBe(true);
    }
  });

  it('rejects non-privileged roles', () => {
    for (const r of ['attendee', 'participant', 'panelist', 'guest', '']) {
      expect(isHostRole(r)).toBe(false);
    }
  });

  it('treats missing/unknown as not host (Simple-locked, the safe default)', () => {
    expect(isHostRole(null)).toBe(false);
    expect(isHostRole(undefined)).toBe(false);
    expect(isHostRole(123)).toBe(false);
    expect(isHostRole('cohosting-lead')).toBe(false); // not an exact host/cohost token
  });
});
