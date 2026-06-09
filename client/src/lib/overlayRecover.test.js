import { describe, it, expect, vi } from 'vitest';
import { reduceOverlayRecovery, createMediaRecoveryHandler } from './overlayRecover.js';

// Pure reducer — table-tested, no jsdom. Event shapes mirror @zoom/appssdk's
// OnMyMediaChangeEvent: camera toggle = { media: { video: { state } } }; resolution
// change = { media: { video: { width, height } } }; audio = { media: { audio: { state } } }.

const cameraOff = { media: { video: { state: false } }, timestamp: 1 };
const cameraOn = { media: { video: { state: true } }, timestamp: 2 };
const resolution = { media: { video: { width: 1920, height: 1080 } }, timestamp: 3 };
const audioMute = { media: { audio: { state: false } }, timestamp: 4 };

describe('reduceOverlayRecovery', () => {
  it('arms a pending re-arm when the camera goes off while the overlay is on', () => {
    expect(reduceOverlayRecovery(cameraOff, { overlayOn: true, needsRearm: false })).toEqual({
      needsRearm: true,
      rearm: false,
    });
  });

  it('re-arms on the camera coming back on after a confirmed off (overlay on)', () => {
    expect(reduceOverlayRecovery(cameraOn, { overlayOn: true, needsRearm: true })).toEqual({
      needsRearm: false,
      rearm: true,
    });
  });

  it('drives a full off→on sequence to exactly one re-arm', () => {
    let state = { overlayOn: true, needsRearm: false };
    let r1 = reduceOverlayRecovery(cameraOff, state);
    state = { ...state, needsRearm: r1.needsRearm };
    expect(r1.rearm).toBe(false);

    let r2 = reduceOverlayRecovery(cameraOn, state);
    state = { ...state, needsRearm: r2.needsRearm };
    expect(r2.rearm).toBe(true);

    // A second camera-on without an intervening off must NOT re-arm again.
    let r3 = reduceOverlayRecovery(cameraOn, state);
    expect(r3.rearm).toBe(false);
    expect(r3.needsRearm).toBe(false);
  });

  it('does not re-arm on a camera-on with no prior off (e.g. initial state:true)', () => {
    expect(reduceOverlayRecovery(cameraOn, { overlayOn: true, needsRearm: false })).toEqual({
      needsRearm: false,
      rearm: false,
    });
  });

  it('does not arm when the camera goes off while the overlay is OFF', () => {
    expect(reduceOverlayRecovery(cameraOff, { overlayOn: false, needsRearm: false })).toEqual({
      needsRearm: false,
      rearm: false,
    });
  });

  it('does not re-arm a camera-on while the overlay is OFF, and clears the stale pending', () => {
    // A pending re-arm that survives into "overlay hidden" must be dropped on the next
    // camera-on, so re-showing the overlay can't fire a re-arm without a fresh off→on.
    expect(reduceOverlayRecovery(cameraOn, { overlayOn: false, needsRearm: true })).toEqual({
      needsRearm: false, // consumed/cleared, not preserved
      rearm: false,
    });
  });

  it('ignores resolution-only video events (no state) — no change, no re-arm', () => {
    const prev = { overlayOn: true, needsRearm: true };
    expect(reduceOverlayRecovery(resolution, prev)).toEqual({ needsRearm: true, rearm: false });
  });

  it('ignores audio events entirely', () => {
    const prev = { overlayOn: true, needsRearm: true };
    expect(reduceOverlayRecovery(audioMute, prev)).toEqual({ needsRearm: true, rearm: false });
  });

  it('is safe on a malformed / empty event', () => {
    const prev = { overlayOn: true, needsRearm: false };
    for (const evt of [null, undefined, {}, { media: null }, { media: {} }]) {
      expect(reduceOverlayRecovery(evt, prev)).toEqual({ needsRearm: false, rearm: false });
    }
  });
});

// AC5 — the panel recovery wiring, extracted so it is testable without jsdom. A fake
// "App" holds overlayOn/needsRearm as mutable vars (the refs) and counts the SDK calls.
function makeRecoveryHarness({ overlayOn = false } = {}) {
  const state = { overlayOn, needsRearm: false };
  const calls = { start: 0, post: 0, logs: [] };
  const handle = createMediaRecoveryHandler({
    getOverlayOn: () => state.overlayOn,
    getNeedsRearm: () => state.needsRearm,
    setNeedsRearm: (v) => {
      state.needsRearm = v;
    },
    startCameraOverlay: () => {
      calls.start += 1;
    },
    postOverlay: () => {
      calls.post += 1;
    },
    log: (e) => calls.logs.push(e),
  });
  // Mirror App's manual start/stop, which reset the pending re-arm flag.
  const show = () => {
    state.overlayOn = true;
    state.needsRearm = false;
  };
  const hide = () => {
    state.overlayOn = false;
    state.needsRearm = false;
  };
  return { state, calls, handle, show, hide };
}

describe('createMediaRecoveryHandler (AC5 panel recovery)', () => {
  it('re-arms once on an off→on while the overlay is on, posting a fresh snapshot', async () => {
    const h = makeRecoveryHarness({ overlayOn: true });

    await h.handle(cameraOff); // arms
    expect(h.calls.start).toBe(0); // off does not re-arm

    await h.handle(cameraOn); // confirmed off→on -> re-arm
    expect(h.calls.start).toBe(1);
    expect(h.calls.post).toBe(1);
    expect(h.calls.logs).toEqual(['overlay-rearm:begin', 'overlay-rearm:done']);

    // A second camera-on with no intervening off must NOT re-arm again.
    await h.handle(cameraOn);
    expect(h.calls.start).toBe(1);
    expect(h.calls.post).toBe(1);
  });

  it('does not re-arm on a camera-on with no prior off', async () => {
    const h = makeRecoveryHarness({ overlayOn: true });
    await h.handle(cameraOn);
    expect(h.calls.start).toBe(0);
  });

  it('does not re-arm for audio or resolution-only events', async () => {
    const h = makeRecoveryHarness({ overlayOn: true });
    await h.handle(cameraOff);
    await h.handle(audioMute);
    await h.handle(resolution);
    expect(h.calls.start).toBe(0); // still armed, but neither event is a camera-on
  });

  // Finding 1 regression: armed, then the presenter HIDES the overlay, re-shows it,
  // and a stray camera-on arrives — must NOT re-arm without a fresh off→on while on.
  it('does not re-arm across a hide→show after a stale arm', async () => {
    const h = makeRecoveryHarness({ overlayOn: true });
    await h.handle(cameraOff); // arms while on
    h.hide(); // presenter hides overlay (clears pending, overlay off)
    h.show(); // presenter shows overlay again (still no pending)
    await h.handle(cameraOn); // stray camera-on
    expect(h.calls.start).toBe(0);
  });

  it('swallows a failing re-arm (does not reject) and still clears the pending', async () => {
    const state = { overlayOn: true, needsRearm: true };
    const handle = createMediaRecoveryHandler({
      getOverlayOn: () => state.overlayOn,
      getNeedsRearm: () => state.needsRearm,
      setNeedsRearm: (v) => {
        state.needsRearm = v;
      },
      startCameraOverlay: () => Promise.reject(new Error('runRenderingContext failed')),
      postOverlay: vi.fn(),
      log: () => {},
    });
    await expect(handle(cameraOn)).resolves.toBeUndefined();
    expect(state.needsRearm).toBe(false); // consumed even though the re-arm failed
  });
});
