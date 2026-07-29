import { describe, it, expect, vi } from 'vitest';
import {
  reduceVideoPoll,
  createVideoRecovery,
  reducePostResult,
  rebuildOverlay,
  createPostRecovery,
  runStopOverlay,
} from './overlayRecover.js';

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

// Pure decision for dead-postMessage-link recovery — table-tested, no jsdom. Owns the whole
// transition: success resets the count; a failure reaching the threshold (with cooldown
// elapsed) rebuilds and stamps lastRebuildAt while KEEPING the count, so persistent failures
// retry at the cooldown cadence rather than every tick.
describe('reducePostResult', () => {
  const opts = { threshold: 3, cooldownMs: 6000 };

  it('a success resets the failure count and never rebuilds', () => {
    expect(reducePostResult(true, { consecutiveFailures: 5, lastRebuildAt: 100 }, 10_000, opts)).toEqual(
      { consecutiveFailures: 0, lastRebuildAt: 100, rebuild: false }
    );
  });

  it('a failure below the threshold increments, no rebuild', () => {
    expect(reducePostResult(false, { consecutiveFailures: 1, lastRebuildAt: 0 }, 10_000, opts)).toEqual(
      { consecutiveFailures: 2, lastRebuildAt: 0, rebuild: false }
    );
  });

  it('reaching the threshold with cooldown elapsed rebuilds and stamps lastRebuildAt', () => {
    expect(reducePostResult(false, { consecutiveFailures: 2, lastRebuildAt: 0 }, 10_000, opts)).toEqual(
      { consecutiveFailures: 3, lastRebuildAt: 10_000, rebuild: true }
    );
  });

  it('does not rebuild again during the cooldown, even above the threshold', () => {
    expect(reducePostResult(false, { consecutiveFailures: 3, lastRebuildAt: 10_000 }, 12_000, opts)).toEqual(
      { consecutiveFailures: 4, lastRebuildAt: 10_000, rebuild: false }
    );
  });

  it('retries once the cooldown has elapsed (persistent failures retry at cadence)', () => {
    expect(reducePostResult(false, { consecutiveFailures: 4, lastRebuildAt: 10_000 }, 16_000, opts)).toEqual(
      { consecutiveFailures: 5, lastRebuildAt: 16_000, rebuild: true }
    );
  });
});

describe('rebuildOverlay (shared close→reopen)', () => {
  it('closes THEN reopens THEN posts, logging begin/done', async () => {
    const order = [];
    const ok = await rebuildOverlay({
      getOverlayOn: () => true,
      stop: () => order.push('stop'),
      start: () => order.push('start'),
      post: () => order.push('post'),
      log: (e) => order.push(e),
    });
    expect(ok).toBe(true);
    expect(order).toEqual(['overlay-rearm:begin', 'stop', 'start', 'post', 'overlay-rearm:done']);
  });

  it('is a no-op while another rebuild is in flight (single-flight)', async () => {
    let started = false;
    const ok = await rebuildOverlay({ isRecovering: () => true, start: () => { started = true; } });
    expect(ok).toBe(false);
    expect(started).toBe(false);
  });

  it('bails immediately when the overlay is already meant to be off', async () => {
    let started = false;
    const ok = await rebuildOverlay({ getOverlayOn: () => false, start: () => { started = true; } });
    expect(ok).toBe(false);
    expect(started).toBe(false);
  });

  it('a Hide that lands during the close aborts before reopening', async () => {
    let overlayOn = true;
    const order = [];
    const ok = await rebuildOverlay({
      getOverlayOn: () => overlayOn,
      stop: () => { order.push('stop'); overlayOn = false; }, // manual Hide lands mid-close
      start: () => order.push('start'),
      post: () => order.push('post'),
    });
    expect(ok).toBe(false);
    expect(order).toEqual(['stop']); // did NOT reopen or post
  });

  it('compensating-closes when a Hide lands during the reopen (Hide always wins)', async () => {
    let overlayOn = true;
    const order = [];
    const ok = await rebuildOverlay({
      getOverlayOn: () => overlayOn,
      stop: () => order.push('stop'),
      start: () => { order.push('start'); overlayOn = false; }, // Hide lands mid-reopen
      post: () => order.push('post'),
    });
    expect(ok).toBe(false);
    expect(order).toEqual(['stop', 'start', 'stop']); // reopened, then compensating-closed; no post
  });

  it('compensating-closes when the generation advances during the reopen (new run supersedes)', async () => {
    let gen = 5;
    const order = [];
    const ok = await rebuildOverlay({
      getOverlayOn: () => true, // intent still "on" (a fresh Show), but a different run
      getGeneration: () => gen,
      stop: () => order.push('stop'),
      start: () => { order.push('start'); gen = 6; }, // a new overlay run started mid-reopen
      post: () => order.push('post'),
    });
    expect(ok).toBe(false);
    expect(order).toEqual(['stop', 'start', 'stop']);
  });

  it('reopens even if the close rejects (close is best-effort)', async () => {
    const order = [];
    const ok = await rebuildOverlay({
      getOverlayOn: () => true,
      stop: () => Promise.reject(new Error('context already gone')),
      start: () => order.push('start'),
      post: () => order.push('post'),
    });
    expect(ok).toBe(true);
    expect(order).toEqual(['start', 'post']);
  });

  it('clears the single-flight flag even if the reopen throws', async () => {
    let recovering = false;
    await expect(
      rebuildOverlay({
        getOverlayOn: () => true,
        isRecovering: () => recovering,
        setRecovering: (v) => { recovering = v; },
        stop: () => {},
        start: () => { throw new Error('reopen failed'); },
      })
    ).rejects.toThrow('reopen failed');
    expect(recovering).toBe(false);
  });
});

describe('createPostRecovery (dead link → rebuild)', () => {
  function harness({ threshold = 3, cooldownMs = 6000 } = {}) {
    const state = { consecutiveFailures: 0, lastRebuildAt: 0 };
    let clock = 100_000;
    const order = [];
    const run = createPostRecovery({
      getState: () => state,
      setState: (s) => {
        state.consecutiveFailures = s.consecutiveFailures;
        state.lastRebuildAt = s.lastRebuildAt;
      },
      now: () => clock,
      getOverlayOn: () => true,
      isRecovering: () => false,
      setRecovering: () => {},
      stop: () => order.push('stop'),
      start: () => order.push('start'),
      post: () => order.push('post'),
      threshold,
      cooldownMs,
    });
    return { state, order, run, tick: (ms) => { clock += ms; } };
  }

  it('rebuilds once after N consecutive failures, then a success resets the count', async () => {
    const h = harness();
    await h.run(false);
    await h.run(false);
    expect(h.order).toEqual([]); // below threshold — no rebuild yet
    await h.run(false);
    expect(h.order).toEqual(['stop', 'start', 'post']);
    await h.run(true);
    expect(h.state.consecutiveFailures).toBe(0);
  });

  it('does not rebuild every tick while the link stays dead (cooldown paces it)', async () => {
    const h = harness();
    await h.run(false);
    await h.run(false);
    await h.run(false); // rebuild #1
    expect(h.order.filter((o) => o === 'start')).toHaveLength(1);
    await h.run(false); // within cooldown → no rebuild
    expect(h.order.filter((o) => o === 'start')).toHaveLength(1);
    h.tick(6000); // cooldown elapses
    await h.run(false); // rebuild #2
    expect(h.order.filter((o) => o === 'start')).toHaveLength(2);
  });
});

describe('runStopOverlay (manual Hide, best-effort close)', () => {
  it('records the off intent and resolves even when the close rejects', async () => {
    let off = false;
    await expect(
      runStopOverlay({
        setOff: () => { off = true; },
        stop: () => Promise.reject(new Error('context already gone')),
      })
    ).resolves.toBeUndefined();
    expect(off).toBe(true);
  });

  it('records intent BEFORE awaiting the close', async () => {
    const order = [];
    await runStopOverlay({ setOff: () => order.push('off'), stop: () => order.push('stop') });
    expect(order).toEqual(['off', 'stop']);
  });
});
