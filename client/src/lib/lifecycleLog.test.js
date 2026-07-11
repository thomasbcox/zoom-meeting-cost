import { describe, it, expect, vi, afterEach } from 'vitest';
import { logLifecycle, registerTeardownLog } from './lifecycleLog.js';
import { instanceId } from './instanceId.js';

// Injectable fake event target + sink so the register/fire/cleanup contract is
// testable without jsdom — mirrors the pattern in components/OverlayApp.test.js.
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

describe('instanceId', () => {
  it('is a stable, prefixed alphanumeric id', () => {
    expect(instanceId).toMatch(/^i_[a-z0-9]+$/);
    // Module const: same value on every read within a load.
    expect(instanceId).toBe(instanceId);
  });
});

describe('logLifecycle', () => {
  it('shapes the entry with kind, event, instanceId, and merged extras', () => {
    const sink = vi.fn();
    logLifecycle('boot', { mode: 'real', runningContext: 'inCamera' }, sink);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith({
      kind: 'lifecycle',
      event: 'boot',
      instanceId,
      mode: 'real',
      runningContext: 'inCamera',
    });
  });

  it('defaults extra to empty', () => {
    const sink = vi.fn();
    logLifecycle('panel-mounted', undefined, sink);
    expect(sink).toHaveBeenCalledWith({ kind: 'lifecycle', event: 'panel-mounted', instanceId });
  });

  it('never throws even if the sink throws', () => {
    const boom = () => {
      throw new Error('sink down');
    };
    expect(() => logLifecycle('overlay-message', { status: 'running' }, boom)).not.toThrow();
  });
});

describe('registerTeardownLog', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('logs the given event on pagehide and cleans up its listener', () => {
    const log = vi.fn();
    const target = fakeTarget();

    const cleanup = registerTeardownLog('panel-teardown', { target, log });
    expect(target.addEventListener).toHaveBeenCalledWith('pagehide', expect.any(Function));

    target.fire('pagehide');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('panel-teardown');

    cleanup();
    expect(target.removeEventListener).toHaveBeenCalledWith('pagehide', expect.any(Function));
  });

  it('is generic over the event name', () => {
    const log = vi.fn();
    const target = fakeTarget();
    registerTeardownLog('overlay-teardown', { target, log });
    target.fire('pagehide');
    expect(log).toHaveBeenCalledWith('overlay-teardown');
  });

  it('is a safe callable no-op when no event target is available', () => {
    const log = vi.fn();
    const cleanup = registerTeardownLog('panel-teardown', { target: null, log });
    expect(typeof cleanup).toBe('function');
    expect(() => cleanup()).not.toThrow();
    expect(log).not.toHaveBeenCalled();
  });

  it('never lets a throwing log sink escape the teardown handler', () => {
    const boom = () => {
      throw new Error('sink down');
    };
    const target = fakeTarget();
    registerTeardownLog('panel-teardown', { target, log: boom });
    expect(() => target.fire('pagehide')).not.toThrow();
  });

  it('default sink delivers the breadcrumb with keepalive (survives teardown)', () => {
    const fetchMock = vi.fn(() => Promise.resolve());
    vi.stubGlobal('fetch', fetchMock);
    const target = fakeTarget();

    // No injected log -> exercises the real keepalive-safe teardownLog default.
    registerTeardownLog('panel-teardown', { target });
    target.fire('pagehide');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/log');
    expect(init.keepalive).toBe(true);
    const body = JSON.parse(init.body);
    expect(body).toEqual({ kind: 'lifecycle', event: 'panel-teardown', instanceId });
  });
});
