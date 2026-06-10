import { describe, it, expect, vi } from 'vitest';
import { reduceVideoPoll, createVideoRecovery } from './overlayRecover.js';

// Pure reducer — table-tested, no jsdom. `recover` fires only on a polled off→on edge
// while the overlay is on; `lastVideoOn` always advances to the new sample.
describe('reduceVideoPoll', () => {
  it('recovers on an off→on edge while the overlay is on', () => {
    expect(reduceVideoPoll(true, { overlayOn: true, lastVideoOn: false })).toEqual({
      lastVideoOn: true,
      recover: true,
    });
  });

  it('does not recover on on→on (camera was never off)', () => {
    expect(reduceVideoPoll(true, { overlayOn: true, lastVideoOn: true })).toEqual({
      lastVideoOn: true,
      recover: false,
    });
  });

  it('does not recover on the off edge itself (on→off)', () => {
    expect(reduceVideoPoll(false, { overlayOn: true, lastVideoOn: true })).toEqual({
      lastVideoOn: false,
      recover: false,
    });
  });

  it('does not recover on off→off', () => {
    expect(reduceVideoPoll(false, { overlayOn: true, lastVideoOn: false })).toEqual({
      lastVideoOn: false,
      recover: false,
    });
  });

  it('never recovers while the overlay is off, but still tracks state', () => {
    expect(reduceVideoPoll(true, { overlayOn: false, lastVideoOn: false })).toEqual({
      lastVideoOn: true,
      recover: false,
    });
  });
});

// createVideoRecovery — poll handler. A fake App holds overlayOn/lastVideoOn as mutable
// vars (the refs) and a settable camera state; the adapter records SDK call order.
function makeHarness({ overlayOn = true, lastVideoOn = true, videoOn = true } = {}) {
  const state = { overlayOn, lastVideoOn, videoOn };
  const order = [];
  const calls = { stop: 0, start: 0, post: 0, logs: [] };
  const recover = createVideoRecovery({
    getOverlayOn: () => state.overlayOn,
    getLastVideoOn: () => state.lastVideoOn,
    setLastVideoOn: (v) => {
      state.lastVideoOn = v;
    },
    getVideoState: () => state.videoOn,
    stopCameraOverlay: () => {
      calls.stop += 1;
      order.push('stop');
    },
    startCameraOverlay: () => {
      calls.start += 1;
      order.push('start');
    },
    postOverlay: () => {
      calls.post += 1;
      order.push('post');
    },
    log: (e) => calls.logs.push(e),
  });
  return { state, order, calls, recover };
}

describe('createVideoRecovery (poll → close+reopen)', () => {
  it('on a full off→on poll sequence, closes THEN reopens THEN posts (once)', async () => {
    const h = makeHarness({ lastVideoOn: true, videoOn: true });

    // Poll 1: camera off — no recovery, baseline drops to off.
    h.state.videoOn = false;
    await h.recover();
    expect(h.calls.start).toBe(0);
    expect(h.state.lastVideoOn).toBe(false);

    // Poll 2: camera back on — recover with close before reopen before post.
    h.state.videoOn = true;
    await h.recover();
    expect(h.order).toEqual(['stop', 'start', 'post']);
    expect(h.calls.logs).toEqual(['overlay-rearm:begin', 'overlay-rearm:done']);

    // Poll 3: still on — no second recovery.
    await h.recover();
    expect(h.calls.start).toBe(1);
    expect(h.calls.stop).toBe(1);
  });

  it('does not recover while the overlay is off, even across an off→on edge', async () => {
    const h = makeHarness({ overlayOn: false, lastVideoOn: false, videoOn: true });
    await h.recover();
    expect(h.calls.start).toBe(0);
    expect(h.state.lastVideoOn).toBe(true); // still tracks state
  });

  it('reopens even if the close step rejects (close is best-effort)', async () => {
    const order = [];
    const recover = createVideoRecovery({
      getOverlayOn: () => true,
      getLastVideoOn: () => false, // primed: previous poll saw camera off
      setLastVideoOn: () => {},
      getVideoState: () => true, // now on → rising edge
      stopCameraOverlay: () => {
        order.push('stop');
        return Promise.reject(new Error('context already gone'));
      },
      startCameraOverlay: () => {
        order.push('start');
      },
      postOverlay: () => order.push('post'),
    });
    await expect(recover()).resolves.toBeUndefined();
    expect(order).toEqual(['stop', 'start', 'post']);
  });

  it('swallows a throwing getVideoState (no recover, no reject)', async () => {
    let started = false;
    const recover = createVideoRecovery({
      getOverlayOn: () => true,
      getLastVideoOn: () => false,
      setLastVideoOn: () => {
        throw new Error('should not be reached after getVideoState throws');
      },
      getVideoState: () => Promise.reject(new Error('40316 not authorized')),
      stopCameraOverlay: () => {},
      startCameraOverlay: () => {
        started = true;
      },
      postOverlay: () => {},
    });
    await expect(recover()).resolves.toBeUndefined();
    expect(started).toBe(false);
  });
});
