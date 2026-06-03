import { describe, it, expect } from 'vitest';
import { normalizeName } from './normalize.js';

describe('normalizeName', () => {
  it('should return an empty string for null or undefined', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
  });

  it('should convert strings to lowercase', () => {
    expect(normalizeName('THOMAS')).toBe('thomas');
    expect(normalizeName('Thomas Cox')).toBe('thomas cox');
  });

  it('should collapse multiple internal spaces and trim edges', () => {
    expect(normalizeName('  thomas   cox  ')).toBe('thomas cox');
    expect(normalizeName('\tthomas\n\ncox ')).toBe('thomas cox');
  });

  it('should strip common punctuation', () => {
    expect(normalizeName('Thomas Cox.')).toBe('thomas cox');
    expect(normalizeName('Tom "CFO" Cox!')).toBe('tom cfo cox');
    expect(normalizeName('Smith, Jane (CFO)?')).toBe('smith jane cfo');
  });

  it('should decompose and strip combining accent marks (diacritics)', () => {
    expect(normalizeName('René')).toBe('rene');
    expect(normalizeName('Müller')).toBe('muller');
    expect(normalizeName('François')).toBe('francois');
    expect(normalizeName('Åse')).toBe('ase');
    expect(normalizeName('José-María')).toBe('jose-maria'); // hyphen remains, accents stripped
  });
});
