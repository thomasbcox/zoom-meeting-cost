import { describe, it, expect } from 'vitest';
import { isZoomLikeEnvironment, decideAdapter } from './zoomEnv.js';

describe('isZoomLikeEnvironment', () => {
  it('is true for Zoom embedded-webview user agents', () => {
    expect(isZoomLikeEnvironment('Mozilla/5.0 ZoomApps/1.2.3')).toBe(true);
    expect(isZoomLikeEnvironment('Mozilla/5.0 (Macintosh) ZoomWebKit/5')).toBe(true);
    expect(isZoomLikeEnvironment('something zoomapps lowercase')).toBe(true);
  });

  it('is false for ordinary browsers and missing UA', () => {
    expect(isZoomLikeEnvironment('Mozilla/5.0 (Macintosh) Chrome/120 Safari/537')).toBe(false);
    expect(isZoomLikeEnvironment(undefined)).toBe(false);
    expect(isZoomLikeEnvironment('')).toBe(false);
  });
});

describe('decideAdapter', () => {
  it('blocks a mock build loaded inside Zoom (mock-build)', () => {
    expect(decideAdapter({ wantReal: false, inZoom: true })).toEqual({
      action: 'blocked',
      reason: 'mock-build',
    });
  });

  it('uses the mock in ordinary dev (not Zoom, not wanted)', () => {
    expect(decideAdapter({ wantReal: false, inZoom: false })).toEqual({ action: 'mock' });
  });

  it('uses the real adapter when wanted and the SDK imported', () => {
    expect(decideAdapter({ wantReal: true, inZoom: true, importOk: true })).toEqual({
      action: 'real',
    });
    expect(decideAdapter({ wantReal: true, inZoom: false, importOk: true })).toEqual({
      action: 'real',
    });
  });

  it('blocks when the SDK import fails inside Zoom (import-fail)', () => {
    expect(decideAdapter({ wantReal: true, inZoom: true, importOk: false })).toEqual({
      action: 'blocked',
      reason: 'import-fail',
    });
  });

  it('degrades to mock when the SDK import fails outside Zoom (unchanged dev behavior)', () => {
    expect(decideAdapter({ wantReal: true, inZoom: false, importOk: false })).toEqual({
      action: 'mock',
    });
  });
});
