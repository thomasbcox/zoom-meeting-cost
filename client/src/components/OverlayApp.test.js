import { describe, it, expect, vi } from 'vitest';
import { registerOverlayTeardownLog } from './OverlayApp.jsx';

// Plain-function tests for the teardown logger (node env, no jsdom) — mirroring the
// cameraDraw approach of extracting the mount/unmount contract from the component so
// it is unit-testable by injecting a fake event target + log sink.

function fakeTarget() {
  const listeners = {};
  return {
    addEventListener: vi.fn((type, cb) => {
      (listeners[type] ||= []).push(cb);
    }),
    removeEventListener: vi.fn((type, cb) => {
      listeners[type] = (listeners[type] || []).filter((c) => c !== cb);
    }),
    fire(type, evt) {
      (listeners[type] || []).forEach((c) => c(evt));
    },
  };
}

describe('registerOverlayTeardownLog', () => {
  it('logs overlay-teardown on pagehide for the real camera mount (shouldLog=true)', () => {
    const log = vi.fn();
    const target = fakeTarget();

    const cleanup = registerOverlayTeardownLog(true, { target, log });
    expect(target.addEventListener).toHaveBeenCalledWith('pagehide', expect.any(Function));

    target.fire('pagehide');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('overlay-teardown');

    cleanup();
    expect(target.removeEventListener).toHaveBeenCalledWith('pagehide', expect.any(Function));
  });

  it('registers nothing for the mock preview / panel mount (shouldLog=false)', () => {
    const log = vi.fn();
    const target = fakeTarget();

    const cleanup = registerOverlayTeardownLog(false, { target, log });
    expect(target.addEventListener).not.toHaveBeenCalled();

    target.fire('pagehide');
    expect(log).not.toHaveBeenCalled();
    expect(typeof cleanup).toBe('function'); // safe no-op cleanup
    expect(() => cleanup()).not.toThrow();
  });

  it('is a safe no-op when no event target is available', () => {
    const log = vi.fn();
    const cleanup = registerOverlayTeardownLog(true, { target: null, log });
    expect(typeof cleanup).toBe('function');
    expect(() => cleanup()).not.toThrow();
    expect(log).not.toHaveBeenCalled();
  });

  it('never lets a throwing log sink escape the teardown handler (AC3)', () => {
    const boom = () => {
      throw new Error('sink down');
    };
    const target = fakeTarget();
    registerOverlayTeardownLog(true, { target, log: boom });
    expect(() => target.fire('pagehide')).not.toThrow();
  });
});
