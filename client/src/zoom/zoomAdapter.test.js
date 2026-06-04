import { describe, it, expect } from 'vitest';
import { ZOOM_CAPABILITIES, MockZoom, RealZoom } from './zoomAdapter.js';

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
      'connect',
      'onConnect',
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

// Fake @zoom/appssdk: records connect() calls, lets the test fire onConnect, and
// captures (or rejects) postMessage payloads. Only the methods RealZoom touches.
function makeFakeSdk({ postMessageRejects = false } = {}) {
  let connectHandler = null;
  return {
    posted: [],
    connectCalls: 0,
    async config() {},
    async getRunningContext() {
      return { runningContext: 'inMeeting' };
    },
    async getUserContext() {
      return { id: 'u1', displayName: 'Real User' };
    },
    async getMeetingParticipants() {
      return { participants: [] };
    },
    connect() {
      this.connectCalls += 1;
      return Promise.resolve({});
    },
    onConnect(cb) {
      connectHandler = cb;
    },
    // Mirror the real OnConnectEvent shape: { timestamp, action }.
    fireConnect(action = 'success') {
      if (connectHandler) connectHandler({ timestamp: 0, action });
    },
    postMessage(payload) {
      if (postMessageRejects) return Promise.reject(new Error('10041'));
      this.posted.push(payload);
      return Promise.resolve({});
    },
  };
}

describe('RealZoom postMessage bridge', () => {
  it('calls sdk.connect() during init', async () => {
    const sdk = makeFakeSdk();
    const a = new RealZoom(sdk);
    await a.init();
    expect(sdk.connectCalls).toBe(1);
  });

  it('holds messages until onConnect, then replays the latest', async () => {
    const sdk = makeFakeSdk();
    const a = new RealZoom(sdk);
    await a.init();

    // Before the instances connect, nothing is sent through the SDK.
    a.postMessage({ totalCost: 1 });
    a.postMessage({ totalCost: 2 });
    expect(sdk.posted).toEqual([]);

    // On connect, only the latest held snapshot is flushed.
    sdk.fireConnect();
    expect(sdk.posted).toEqual([{ totalCost: 2 }]);

    // After connect, messages pass straight through.
    a.postMessage({ totalCost: 3 });
    expect(sdk.posted).toEqual([{ totalCost: 2 }, { totalCost: 3 }]);
  });

  it('ignores a failed onConnect: stays disconnected and keeps the pending payload', async () => {
    const sdk = makeFakeSdk();
    const a = new RealZoom(sdk);
    await a.init();

    a.postMessage({ totalCost: 7 });

    // A failure event must NOT mark the bridge live or flush the held snapshot.
    sdk.fireConnect('failure');
    expect(sdk.posted).toEqual([]);

    // A later success flushes the still-pending latest snapshot.
    sdk.fireConnect('success');
    expect(sdk.posted).toEqual([{ totalCost: 7 }]);
  });

  it('does not throw or reject when sdk.postMessage rejects', async () => {
    const sdk = makeFakeSdk({ postMessageRejects: true });
    const a = new RealZoom(sdk);
    await a.init();
    sdk.fireConnect();

    // Must not raise synchronously...
    expect(() => a.postMessage({ totalCost: 9 })).not.toThrow();
    // ...and must not surface as an unhandled rejection on the microtask queue.
    await Promise.resolve();
    await Promise.resolve();
  });
});
