import { describe, it, expect } from 'vitest';
import { buildInfo, envKind, shortCommit, normalizeEnv } from './buildInfo.js';

// Under vitest the __APP_*__ define constants may be absent; buildInfo's typeof guards
// then resolve to the fallbacks ('local'/'dev'). Either way the SHAPE is what we assert.

describe('buildInfo', () => {
  it('exposes env, commit, and builtAt', () => {
    expect(typeof buildInfo.env).toBe('string');
    expect(typeof buildInfo.commit).toBe('string');
    expect('builtAt' in buildInfo).toBe(true);
  });

  it('shortCommit truncates to at most 7 chars', () => {
    expect(shortCommit.length).toBeLessThanOrEqual(7);
    expect(buildInfo.commit.startsWith(shortCommit)).toBe(true);
  });

  it('envKind is one of the fixed vocabulary', () => {
    expect(['prod', 'dev', 'other']).toContain(envKind);
  });
});

describe('normalizeEnv', () => {
  it('maps Railway + shorthand names to a fixed set', () => {
    expect(normalizeEnv('production')).toBe('prod');
    expect(normalizeEnv('prod')).toBe('prod');
    expect(normalizeEnv('development')).toBe('dev');
    expect(normalizeEnv('dev')).toBe('dev');
    expect(normalizeEnv('PRODUCTION')).toBe('prod'); // case-insensitive
  });

  it('maps anything else (incl. null/empty) to other', () => {
    expect(normalizeEnv('local')).toBe('other');
    expect(normalizeEnv('staging')).toBe('other');
    expect(normalizeEnv('')).toBe('other');
    expect(normalizeEnv(null)).toBe('other');
    expect(normalizeEnv(undefined)).toBe('other');
  });
});
