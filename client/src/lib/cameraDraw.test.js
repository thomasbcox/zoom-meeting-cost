import { describe, it, expect, vi } from 'vitest';
import { runCameraDraw } from './cameraDraw.js';

describe('runCameraDraw', () => {
  it('draws on mount and clears on cleanup for the real camera instance', () => {
    const adapter = { drawCameraOverlay: vi.fn(), clearCameraOverlay: vi.fn() };
    const cleanup = runCameraDraw(adapter, true);
    expect(adapter.drawCameraOverlay).toHaveBeenCalledTimes(1);
    expect(adapter.clearCameraOverlay).not.toHaveBeenCalled();
    cleanup();
    expect(adapter.clearCameraOverlay).toHaveBeenCalledTimes(1);
  });

  it('does not draw when shouldDraw is false (mock preview / panel)', () => {
    const adapter = { drawCameraOverlay: vi.fn(), clearCameraOverlay: vi.fn() };
    const cleanup = runCameraDraw(adapter, false);
    expect(adapter.drawCameraOverlay).not.toHaveBeenCalled();
    cleanup(); // no-op cleanup, must not clear or throw
    expect(adapter.clearCameraOverlay).not.toHaveBeenCalled();
  });

  it('tolerates an adapter missing the draw methods', () => {
    expect(() => runCameraDraw({}, true)()).not.toThrow();
    expect(() => runCameraDraw(null, true)()).not.toThrow();
  });
});
