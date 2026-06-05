import { describe, it, expect } from 'vitest';
import { seedPresenterName, DEFAULT_PRESENTER_NAME } from './presenterName.js';

describe('seedPresenterName', () => {
  it('uses a present displayName', () => {
    expect(seedPresenterName({ displayName: 'Dana Rivera' })).toBe('Dana Rivera');
  });

  it('trims surrounding whitespace', () => {
    expect(seedPresenterName({ displayName: '  Jane Smith  ' })).toBe('Jane Smith');
  });

  it('falls back to the default when self is missing', () => {
    expect(seedPresenterName(undefined)).toBe(DEFAULT_PRESENTER_NAME);
    expect(seedPresenterName(null)).toBe(DEFAULT_PRESENTER_NAME);
  });

  it('falls back when displayName is empty or whitespace', () => {
    expect(seedPresenterName({ displayName: '' })).toBe(DEFAULT_PRESENTER_NAME);
    expect(seedPresenterName({ displayName: '   ' })).toBe(DEFAULT_PRESENTER_NAME);
  });

  it('falls back when displayName is not a string', () => {
    expect(seedPresenterName({ displayName: 42 })).toBe(DEFAULT_PRESENTER_NAME);
  });

  it('default is the neutral "Presenter"', () => {
    expect(DEFAULT_PRESENTER_NAME).toBe('Presenter');
  });
});
