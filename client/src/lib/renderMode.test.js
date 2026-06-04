import { describe, it, expect } from 'vitest';
import { renderModeFor } from './renderMode.js';

describe('renderModeFor', () => {
  it('routes the camera rendering context to the overlay', () => {
    expect(renderModeFor('inCamera')).toBe('overlay');
  });

  it('routes the side panel to the config panel', () => {
    expect(renderModeFor('inMeeting')).toBe('panel');
  });

  it('defaults unknown / missing contexts to the panel', () => {
    expect(renderModeFor('inMainClient')).toBe('panel');
    expect(renderModeFor(undefined)).toBe('panel');
    expect(renderModeFor(null)).toBe('panel');
  });
});
