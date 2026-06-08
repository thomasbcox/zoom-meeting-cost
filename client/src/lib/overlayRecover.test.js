import { describe, it, expect } from 'vitest';
import { reduceOverlayRecovery } from './overlayRecover.js';

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

  it('does not re-arm a camera-on while the overlay is OFF, even if armed', () => {
    expect(reduceOverlayRecovery(cameraOn, { overlayOn: false, needsRearm: true })).toEqual({
      needsRearm: true, // preserved; nothing consumed it
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
