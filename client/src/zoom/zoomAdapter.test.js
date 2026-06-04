import { describe, it, expect } from 'vitest';
import { ZOOM_CAPABILITIES, MockZoom } from './zoomAdapter.js';

// Instantiate MockZoom directly so the test is deterministic and independent of
// VITE_USE_ZOOM / the singleton factory (which selects RealZoom under .env.local).

describe('ZOOM_CAPABILITIES', () => {
  it('requests the camera-overlay and message-bridge capabilities', () => {
    for (const cap of [
      'getRunningContext',
      'runRenderingContext',
      'drawWebView',
      'clearWebView',
      'closeRenderingContext',
      'postMessage',
      'onMessage',
    ]) {
      expect(ZOOM_CAPABILITIES).toContain(cap);
    }
  });
});

describe('MockZoom camera overlay', () => {
  it('records the camera rendering sequence on start and close on stop', async () => {
    const a = new MockZoom();

    await a.startCameraOverlay();
    expect(a.calls).toEqual([
      { method: 'runRenderingContext', view: 'camera' },
      { method: 'drawWebView' },
    ]);

    await a.stopCameraOverlay();
    expect(a.calls.at(-1)).toEqual({ method: 'closeRenderingContext' });
  });

  it('loops postMessage back to onMessage subscribers', async () => {
    const a = new MockZoom();
    const received = [];
    const unsub = a.onMessage((p) => received.push(p));

    a.postMessage({ totalCost: 1 });
    a.postMessage({ totalCost: 2 });
    expect(received).toEqual([{ totalCost: 1 }, { totalCost: 2 }]);

    unsub();
    a.postMessage({ totalCost: 3 });
    expect(received).toHaveLength(2); // no delivery after unsubscribe
  });

  it('replays the latest message to a late subscriber', async () => {
    const a = new MockZoom();
    a.postMessage({ totalCost: 42 });
    const received = [];
    a.onMessage((p) => received.push(p));
    expect(received).toEqual([{ totalCost: 42 }]);
  });
});
