import { describe, it, expect } from 'vitest';
import {
  reduceVideoPoll,
  reducePostResult,
  createOverlayController,
  createVideoRecovery,
  createPostRecovery,
} from './overlayRecover.js';

// Pure reducer — table-tested, no jsdom. `recover` fires only on a polled off→on edge while the
// overlay is on; `lastVideoOn` always advances to the new sample.
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

  it('never recovers while the overlay is off, but still tracks state', () => {
    expect(reduceVideoPoll(true, { overlayOn: false, lastVideoOn: false })).toEqual({
      lastVideoOn: true,
      recover: false,
    });
  });
});

// Pure decision for dead-link recovery — table-tested. Owns the whole transition: success resets
// the count; a failure reaching the threshold (with cooldown elapsed) rebuilds and stamps
// lastRebuildAt while KEEPING the count, so persistent failures retry at the cooldown cadence.
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

// The serialized controller: every start/close runs one at a time, so the LAST intent wins with no
// races. Stubs record SDK call order; ops are immediate-async so queuing several before awaiting
// exercises the serialization deterministically.
describe('createOverlayController (serialized last-intent-wins)', () => {
  function makeCtl() {
    const order = [];
    const ctl = createOverlayController({
      startCtx: async () => order.push('start'),
      stopCtx: async () => order.push('stop'),
      post: () => order.push('post'),
    });
    return { ctl, order };
  }

  it('show opens once (idempotent), hide closes, isOn tracks intent', async () => {
    const { ctl, order } = makeCtl();
    expect(ctl.isOn()).toBe(false);
    await ctl.show();
    expect(ctl.isOn()).toBe(true);
    await ctl.show(); // already open — no redundant start
    expect(order).toEqual(['start']);
    await ctl.hide();
    expect(ctl.isOn()).toBe(false);
    expect(order).toEqual(['start', 'stop']);
  });

  it('rebuild closes then reopens and posts while shown', async () => {
    const { ctl, order } = makeCtl();
    await ctl.show();
    await ctl.rebuild();
    expect(order).toEqual(['start', 'stop', 'start', 'post']);
  });

  it('rebuild is a no-op while hidden', async () => {
    const { ctl, order } = makeCtl();
    await ctl.rebuild();
    expect(order).toEqual([]);
  });

  it('serializes rebuild→hide→show so the LAST intent (show) wins — overlay ends up', async () => {
    const { ctl, order } = makeCtl();
    await ctl.show();
    const ops = [ctl.rebuild(), ctl.hide(), ctl.show()]; // queued back-to-back
    await Promise.all(ops);
    expect(ctl.isOn()).toBe(true);
    // The stale rebuild reopened; the trailing hide/show were no-ops (desired already on) — the
    // context was never left closed. No compensating close clobbered the final Show.
    expect(order).toEqual(['start', 'stop', 'start', 'post']);
  });

  it('serializes rebuild→show→hide so the LAST intent (hide) wins — overlay ends down', async () => {
    const { ctl, order } = makeCtl();
    await ctl.show();
    const ops = [ctl.rebuild(), ctl.show(), ctl.hide()];
    await Promise.all(ops);
    expect(ctl.isOn()).toBe(false);
    // rebuild saw desired=false at run time and no-oped; the reconcile closed the context.
    expect(order).toEqual(['start', 'stop']);
  });

  it('a rejecting startCtx surfaces to show() and never wedges the queue', async () => {
    let firstStart = true;
    const order = [];
    const ctl = createOverlayController({
      startCtx: async () => {
        order.push('start');
        if (firstStart) {
          firstStart = false;
          throw new Error('Video is not sending.');
        }
      },
      stopCtx: async () => order.push('stop'),
    });
    await expect(ctl.show()).rejects.toThrow('Video is not sending.');
    // The chain survived: a subsequent hide still runs.
    await ctl.hide();
    expect(order).toContain('start');
  });

  it('hide() with a rejecting stopCtx still resolves to hidden; a later show() starts cleanly (AC3)', async () => {
    const order = [];
    let stopFails = true;
    const ctl = createOverlayController({
      startCtx: async () => order.push('start'),
      stopCtx: async () => {
        order.push('stop');
        if (stopFails) throw new Error('context already gone');
      },
      post: () => order.push('post'),
    });
    await ctl.show();
    // A rejecting close is swallowed — no unhandled rejection — and the intent still reaches hidden.
    await expect(ctl.hide()).resolves.toBeUndefined();
    expect(ctl.isOn()).toBe(false);
    stopFails = false;
    await ctl.show(); // the failed close did not wedge the belief; a fresh show starts cleanly
    expect(ctl.isOn()).toBe(true);
    expect(order).toEqual(['start', 'stop', 'start']);
  });

  it('rebuild() continues past a rejecting stopCtx to reopen and post (AC3)', async () => {
    const order = [];
    const ctl = createOverlayController({
      startCtx: async () => order.push('start'),
      stopCtx: async () => {
        order.push('stop');
        throw new Error('context already gone'); // dead link — the close always rejects
      },
      post: () => order.push('post'),
    });
    await ctl.show();
    await expect(ctl.rebuild()).resolves.toBeUndefined();
    // The best-effort close rejected, but the rebuild still reopened and posted.
    expect(order).toEqual(['start', 'stop', 'start', 'post']);
  });
});

// Recovery drivers: they decide WHEN to rebuild; the controller owns HOW. Stub the controller's
// rebuild with a spy so the drivers are testable without SDK calls.
describe('createVideoRecovery (poll → rebuild on off→on edge)', () => {
  function makeHarness({ overlayOn = true, lastVideoOn = true, videoOn = true } = {}) {
    const state = { overlayOn, lastVideoOn, videoOn };
    const calls = { rebuild: 0 };
    const recover = createVideoRecovery({
      getLastVideoOn: () => state.lastVideoOn,
      setLastVideoOn: (v) => {
        state.lastVideoOn = v;
      },
      getVideoState: () => state.videoOn,
      isOn: () => state.overlayOn,
      rebuild: () => {
        calls.rebuild += 1;
      },
    });
    return { state, calls, recover };
  }

  it('rebuilds once on a full off→on poll sequence', async () => {
    const h = makeHarness({ lastVideoOn: true, videoOn: true });
    h.state.videoOn = false;
    await h.recover(); // off — no rebuild, baseline drops
    expect(h.calls.rebuild).toBe(0);
    expect(h.state.lastVideoOn).toBe(false);
    h.state.videoOn = true;
    await h.recover(); // back on — rebuild
    expect(h.calls.rebuild).toBe(1);
    await h.recover(); // still on — no second rebuild
    expect(h.calls.rebuild).toBe(1);
  });

  it('does not rebuild while the overlay is off, but still tracks camera state', async () => {
    const h = makeHarness({ overlayOn: false, lastVideoOn: false, videoOn: true });
    await h.recover();
    expect(h.calls.rebuild).toBe(0);
    expect(h.state.lastVideoOn).toBe(true);
  });

  it('swallows a throwing getVideoState (no rebuild, no reject)', async () => {
    const calls = { rebuild: 0 };
    const recover = createVideoRecovery({
      getLastVideoOn: () => false,
      setLastVideoOn: () => {
        throw new Error('should not be reached after getVideoState throws');
      },
      getVideoState: () => Promise.reject(new Error('40316 not authorized')),
      isOn: () => true,
      rebuild: () => {
        calls.rebuild += 1;
      },
    });
    await expect(recover()).resolves.toBeUndefined();
    expect(calls.rebuild).toBe(0);
  });
});

describe('createPostRecovery (dead link → rebuild)', () => {
  function harness({ threshold = 3, cooldownMs = 6000 } = {}) {
    const state = { consecutiveFailures: 0, lastRebuildAt: 0 };
    let clock = 100_000;
    const calls = { rebuild: 0 };
    const run = createPostRecovery({
      getState: () => state,
      setState: (s) => {
        state.consecutiveFailures = s.consecutiveFailures;
        state.lastRebuildAt = s.lastRebuildAt;
      },
      now: () => clock,
      rebuild: () => {
        calls.rebuild += 1;
      },
      threshold,
      cooldownMs,
    });
    return { state, calls, run, tick: (ms) => { clock += ms; } };
  }

  it('rebuilds once after N consecutive failures, then a success resets the count', async () => {
    const h = harness();
    await h.run(false);
    await h.run(false);
    expect(h.calls.rebuild).toBe(0);
    await h.run(false);
    expect(h.calls.rebuild).toBe(1);
    await h.run(true);
    expect(h.state.consecutiveFailures).toBe(0);
  });

  it('does not rebuild every tick while the link stays dead (cooldown paces it)', async () => {
    const h = harness();
    await h.run(false);
    await h.run(false);
    await h.run(false); // rebuild #1
    expect(h.calls.rebuild).toBe(1);
    await h.run(false); // within cooldown → no rebuild
    expect(h.calls.rebuild).toBe(1);
    h.tick(6000); // cooldown elapses
    await h.run(false); // rebuild #2
    expect(h.calls.rebuild).toBe(2);
  });
});
