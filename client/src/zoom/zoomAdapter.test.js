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
function makeFakeSdk({
  postMessageRejects = false,
  participantsReject = false,
  participants = [],
  renderRejects = false,
  connectRejects = false,
} = {}) {
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
      if (participantsReject) throw new Error('not host/co-host');
      return { participants };
    },
    async runRenderingContext() {
      if (renderRejects) throw new Error('runRenderingContext failed');
      return {};
    },
    async drawWebView() {
      if (renderRejects) throw new Error('drawWebView failed');
      return {};
    },
    async closeRenderingContext() {
      return {};
    },
    connect() {
      this.connectCalls += 1;
      if (connectRejects) return Promise.reject(new Error('10039'));
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

// Flush a few microtask ticks so fire-and-forget log promises (connect /
// postMessage .then/.catch) settle before we assert on the captured entries.
async function flush() {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

describe('RealZoom /api/log instrumentation', () => {
  function withLog(opts) {
    const logs = [];
    const sdk = makeFakeSdk(opts);
    const a = new RealZoom(sdk, { log: (p) => logs.push(p) });
    return { a, sdk, logs };
  }

  it('logs runRenderingContext and drawWebView success on startCameraOverlay', async () => {
    const { a, logs } = withLog();
    await a.init();
    await a.startCameraOverlay();
    const overlay = logs.filter((l) => l.kind === 'zoom-overlay');
    expect(overlay).toContainEqual({ kind: 'zoom-overlay', method: 'runRenderingContext', ok: true });
    expect(overlay).toContainEqual({ kind: 'zoom-overlay', method: 'drawWebView', ok: true });
  });

  it('logs a failure entry and still re-throws when an overlay call rejects', async () => {
    const { a, logs } = withLog({ renderRejects: true });
    await a.init();
    await expect(a.startCameraOverlay()).rejects.toThrow('runRenderingContext failed');
    expect(logs).toContainEqual({
      kind: 'zoom-overlay',
      method: 'runRenderingContext',
      ok: false,
      error: 'runRenderingContext failed',
    });
    // drawWebView never ran (the first call threw) — behavior unchanged.
    expect(logs.some((l) => l.method === 'drawWebView')).toBe(false);
  });

  it('logs connect success during init', async () => {
    const { a, logs } = withLog();
    await a.init();
    await flush();
    expect(logs).toContainEqual({ kind: 'zoom-overlay', method: 'connect', ok: true });
  });

  it('logs connect failure during init without throwing', async () => {
    const { a, logs } = withLog({ connectRejects: true });
    await a.init(); // must not reject
    await flush();
    expect(logs).toContainEqual({
      kind: 'zoom-overlay',
      method: 'connect',
      ok: false,
      error: '10039',
    });
  });

  it('logs only the FIRST postMessage send', async () => {
    const { a, sdk, logs } = withLog();
    await a.init();
    sdk.fireConnect(); // bridge live
    a.postMessage({ totalCost: 1 });
    a.postMessage({ totalCost: 2 });
    await flush();
    const posts = logs.filter((l) => l.method === 'postMessage');
    expect(posts).toEqual([{ kind: 'zoom-overlay', method: 'postMessage', ok: true }]);
  });

  it('logs a postMessage failure entry (ok=false) without throwing', async () => {
    const { a, sdk, logs } = withLog({ postMessageRejects: true });
    await a.init();
    sdk.fireConnect();
    expect(() => a.postMessage({ totalCost: 9 })).not.toThrow();
    await flush();
    expect(logs).toContainEqual({
      kind: 'zoom-overlay',
      method: 'postMessage',
      ok: false,
      error: '10041',
    });
  });
});

describe('participant-list availability', () => {
  it('MockZoom always reports available', () => {
    expect(new MockZoom().participantsAvailable()).toBe(true);
  });

  it('RealZoom is available after a successful participant fetch', async () => {
    const sdk = makeFakeSdk({
      participants: [{ participantUUID: 'x1', screenName: 'Alice' }],
    });
    const a = new RealZoom(sdk);
    await a.init();
    expect(a.participantsAvailable()).toBe(true);
    expect(a.getParticipants()).toHaveLength(1);
  });

  it('RealZoom is unavailable (not a $0 meeting) when the fetch fails', async () => {
    const sdk = makeFakeSdk({ participantsReject: true });
    const a = new RealZoom(sdk);
    await a.init();
    expect(a.participantsAvailable()).toBe(false);
    expect(a.getParticipants()).toEqual([]);
  });
});
