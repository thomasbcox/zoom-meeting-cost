import { describe, it, expect } from 'vitest';
import { ZOOM_CAPABILITIES, MockZoom, RealZoom } from './zoomAdapter.js';
import { renderModeFor } from '../lib/renderMode.js';

// Instantiate MockZoom directly so the test is deterministic and independent of
// VITE_USE_ZOOM / the singleton factory (which selects RealZoom under .env.local).

describe('ZOOM_CAPABILITIES', () => {
  it('requests the camera-overlay and message-bridge capabilities', () => {
    for (const cap of [
      'getRunningContext',
      'runRenderingContext',
      'drawWebView',
      'drawParticipant',
      'onMyMediaChange',
      'clearWebView',
      'closeRenderingContext',
      'postMessage',
      'onMessage',
    ]) {
      expect(ZOOM_CAPABILITIES).toContain(cap);
    }
    // connect/onConnect are the meeting<->main-client mirroring feature; the
    // camera overlay uses direct postMessage/onMessage, so they are NOT requested.
    expect(ZOOM_CAPABILITIES).not.toContain('connect');
    expect(ZOOM_CAPABILITIES).not.toContain('onConnect');
  });
});

describe('MockZoom camera overlay', () => {
  it('records spawn on start, the draw pair on drawCameraOverlay, and close on stop', async () => {
    const a = new MockZoom();

    // Panel only spawns the camera rendering context — no draw.
    await a.startCameraOverlay();
    expect(a.calls).toEqual([{ method: 'runRenderingContext', view: 'camera' }]);

    // The camera instance composites the base video + overlay webview.
    await a.drawCameraOverlay();
    expect(a.calls).toEqual([
      { method: 'runRenderingContext', view: 'camera' },
      { method: 'drawParticipant' },
      { method: 'drawWebView', webviewId: 'camera' },
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

describe('RealZoom camera-overlay draw placement', () => {
  it('startCameraOverlay only spawns the rendering context — no draw from the panel', async () => {
    const sdk = makeFakeSdk();
    const a = new RealZoom(sdk);
    await a.init();
    await a.startCameraOverlay();
    expect(sdk.drawn).toEqual([]);
  });

  it('drawCameraOverlay draws participant (z1) then webview (z2) sized from renderTarget', async () => {
    const sdk = makeFakeSdk({ renderTarget: { width: 640, height: 360 } });
    const a = new RealZoom(sdk);
    await a.init();
    await a.drawCameraOverlay();
    expect(sdk.drawn).toEqual([
      { method: 'drawParticipant', participantUUID: 'self-uuid', x: 0, y: 0, width: 640, height: 360, zIndex: 1 },
      { method: 'drawWebView', webviewId: 'camera', x: 0, y: 0, width: 640, height: 360, zIndex: 2 },
    ]);
  });

  it('falls back to 1280x720 when config reports no renderTarget', async () => {
    const sdk = makeFakeSdk({ renderTarget: undefined });
    const a = new RealZoom(sdk);
    await a.init();
    await a.drawCameraOverlay();
    expect(sdk.drawn[1]).toMatchObject({ method: 'drawWebView', width: 1280, height: 720 });
  });

  it('skips drawParticipant (logs ok=false) when no self participantUUID resolves', async () => {
    const logs = [];
    // No UUID from getUserContext and no name match in the participant list.
    // (null, not undefined: a destructuring default would coerce undefined back.)
    const sdk = makeFakeSdk({ selfParticipantUUID: null, participants: [] });
    const a = new RealZoom(sdk, { log: (p) => logs.push(p) });
    await a.init();
    await a.drawCameraOverlay();
    expect(sdk.drawn.some((d) => d.method === 'drawParticipant')).toBe(false);
    expect(logs).toContainEqual({
      kind: 'zoom-overlay',
      method: 'drawParticipant',
      ok: false,
      error: 'no self participantUUID',
    });
    // The overlay webview still composites.
    expect(sdk.drawn.some((d) => d.method === 'drawWebView')).toBe(true);
  });

  it('resolves self participantUUID by name match when getUserContext omits it', async () => {
    const sdk = makeFakeSdk({
      selfParticipantUUID: null,
      participants: [{ participantUUID: 'matched-uuid', screenName: 'Real User' }],
    });
    const a = new RealZoom(sdk);
    await a.init();
    await a.drawCameraOverlay();
    expect(sdk.drawn[0]).toMatchObject({ method: 'drawParticipant', participantUUID: 'matched-uuid' });
  });

  it('logs a drawParticipant failure (ok:false) but still draws the webview and does NOT reject', async () => {
    // drawParticipant is Host/Co-Host only; its failure must not suppress the meter.
    const logs = [];
    const sdk = makeFakeSdk({ participantDrawRejects: true });
    const a = new RealZoom(sdk, { log: (p) => logs.push(p) });
    await a.init();
    await expect(a.drawCameraOverlay()).resolves.toBeUndefined();
    expect(logs).toContainEqual({
      kind: 'zoom-overlay',
      method: 'drawParticipant',
      ok: false,
      error: 'drawParticipant failed',
    });
    // The meter webview still composited.
    expect(sdk.drawn).toEqual([
      { method: 'drawWebView', webviewId: 'camera', x: 0, y: 0, width: 1280, height: 720, zIndex: 2 },
    ]);
  });

  it('still re-throws when drawWebView itself fails (the meter is not optional)', async () => {
    const sdk = makeFakeSdk({ drawRejects: true }); // both draws reject
    const a = new RealZoom(sdk);
    await a.init();
    await expect(a.drawCameraOverlay()).rejects.toThrow('drawWebView failed');
  });
});

describe('RealZoom running-context normalization (real SDK { context } shape)', () => {
  it('normalizes getRunningContext() { context } into a canonical context.runningContext', async () => {
    const camera = new RealZoom(makeFakeSdk({ contextValue: 'inCamera' }));
    const cam = await camera.init();
    expect(cam.context.runningContext).toBe('inCamera');

    const panel = new RealZoom(makeFakeSdk({ contextValue: 'inMeeting' }));
    const pan = await panel.init();
    expect(pan.context.runningContext).toBe('inMeeting');
  });

  it('routes a real inCamera instance to overlay mode (and inMeeting to panel)', async () => {
    // The boundary Root crosses: renderModeFor(init().context.runningContext).
    const cam = await new RealZoom(makeFakeSdk({ contextValue: 'inCamera' })).init();
    expect(renderModeFor(cam.context.runningContext)).toBe('overlay');

    const pan = await new RealZoom(makeFakeSdk({ contextValue: 'inMeeting' })).init();
    expect(renderModeFor(pan.context.runningContext)).toBe('panel');
  });

  it('falls back to the config-style { runningContext } name if a client ever returns it', async () => {
    const sdk = makeFakeSdk();
    sdk.getRunningContext = async () => ({ runningContext: 'inCamera' });
    const out = await new RealZoom(sdk).init();
    expect(out.context.runningContext).toBe('inCamera');
  });
});

// Fake @zoom/appssdk: captures (or rejects) postMessage payloads. Only the methods
// RealZoom touches. No connect/onConnect — the camera overlay uses direct postMessage.
function makeFakeSdk({
  postMessageRejects = false,
  participantsReject = false,
  participants = [],
  renderRejects = false,
  drawRejects = false,
  participantDrawRejects = false,
  renderTarget = { width: 1280, height: 720 },
  selfParticipantUUID = 'self-uuid',
  contextValue = 'inMeeting',
} = {}) {
  return {
    posted: [],
    drawn: [],
    async config() {
      return { media: { renderTarget } };
    },
    // Real SDK shape: getRunningContext() resolves to RunningContextResponse = { context }.
    async getRunningContext() {
      return { context: contextValue };
    },
    async getUserContext() {
      return { id: 'u1', displayName: 'Real User', screenName: 'Real User', participantUUID: selfParticipantUUID };
    },
    async getMeetingParticipants() {
      if (participantsReject) throw new Error('not host/co-host');
      return { participants };
    },
    async runRenderingContext() {
      if (renderRejects) throw new Error('runRenderingContext failed');
      return {};
    },
    async drawParticipant(opts) {
      if (drawRejects || participantDrawRejects) throw new Error('drawParticipant failed');
      this.drawn.push({ method: 'drawParticipant', ...opts });
      return {};
    },
    async drawWebView(opts) {
      if (renderRejects || drawRejects) throw new Error('drawWebView failed');
      this.drawn.push({ method: 'drawWebView', ...opts });
      return {};
    },
    async clearWebView() {
      return {};
    },
    async clearParticipant() {
      return {};
    },
    async closeRenderingContext() {
      return {};
    },
    postMessage(payload) {
      if (postMessageRejects) return Promise.reject(new Error('10041'));
      this.posted.push(payload);
      return Promise.resolve({});
    },
  };
}

describe('RealZoom postMessage bridge (direct, no connect)', () => {
  it('does not call sdk.connect() during init (no connect in the camera path)', async () => {
    const sdk = makeFakeSdk();
    expect('connect' in sdk).toBe(false);
    const a = new RealZoom(sdk);
    await a.init(); // must not throw despite no connect/onConnect on the SDK
  });

  it('sends each postMessage directly and in order, with nothing held', async () => {
    const sdk = makeFakeSdk();
    const a = new RealZoom(sdk);
    await a.init();

    a.postMessage({ totalCost: 1 });
    a.postMessage({ totalCost: 2 });
    a.postMessage({ totalCost: 3 });
    expect(sdk.posted).toEqual([{ totalCost: 1 }, { totalCost: 2 }, { totalCost: 3 }]);
  });

  it('does not throw or reject when sdk.postMessage rejects', async () => {
    const sdk = makeFakeSdk({ postMessageRejects: true });
    const a = new RealZoom(sdk);
    await a.init();

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

  it('logs runRenderingContext success on startCameraOverlay (panel does not draw)', async () => {
    const { a, sdk, logs } = withLog();
    await a.init();
    await a.startCameraOverlay();
    const overlay = logs.filter((l) => l.kind === 'zoom-overlay');
    expect(overlay).toContainEqual({ kind: 'zoom-overlay', method: 'runRenderingContext', ok: true });
    // The panel must NOT composite — no draw happens here.
    expect(overlay.some((l) => l.method === 'drawWebView')).toBe(false);
    expect(sdk.drawn).toEqual([]);
  });

  it('logs a failure entry and still re-throws when runRenderingContext rejects', async () => {
    const { a, logs } = withLog({ renderRejects: true });
    await a.init();
    await expect(a.startCameraOverlay()).rejects.toThrow('runRenderingContext failed');
    expect(logs).toContainEqual({
      kind: 'zoom-overlay',
      method: 'runRenderingContext',
      ok: false,
      error: 'runRenderingContext failed',
    });
  });

  it('logs drawParticipant and drawWebView success on drawCameraOverlay', async () => {
    const { a, logs } = withLog();
    await a.init();
    await a.drawCameraOverlay();
    const overlay = logs.filter((l) => l.kind === 'zoom-overlay');
    expect(overlay).toContainEqual({ kind: 'zoom-overlay', method: 'drawParticipant', ok: true });
    expect(overlay).toContainEqual({ kind: 'zoom-overlay', method: 'drawWebView', ok: true });
  });

  it('logs EVERY postMessage send (not just the first)', async () => {
    const { a, logs } = withLog();
    await a.init();
    a.postMessage({ totalCost: 1 });
    a.postMessage({ totalCost: 2 });
    await flush();
    const posts = logs.filter((l) => l.method === 'postMessage');
    expect(posts).toEqual([
      { kind: 'zoom-overlay', method: 'postMessage', ok: true },
      { kind: 'zoom-overlay', method: 'postMessage', ok: true },
    ]);
  });

  it('logs a postMessage failure entry (ok=false) without throwing', async () => {
    const { a, logs } = withLog({ postMessageRejects: true });
    await a.init();
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
