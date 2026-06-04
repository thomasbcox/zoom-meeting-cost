import { describe, it, expect, vi, afterEach } from 'vitest';
import { reportClientError, installGlobalErrorReporting } from './reportError.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('reportClientError', () => {
  it('logs a client-error payload that merges the detail', () => {
    const log = vi.fn();
    reportClientError({ source: 'src', message: 'boom' }, { log });
    expect(log).toHaveBeenCalledTimes(1);
    const payload = log.mock.calls[0][0];
    expect(payload.kind).toBe('client-error');
    expect(payload.source).toBe('src');
    expect(payload.message).toBe('boom');
  });

  it('never throws even if the log sink throws', () => {
    const log = () => {
      throw new Error('sink down');
    };
    expect(() => reportClientError({ message: 'x' }, { log })).not.toThrow();
  });
});

describe('installGlobalErrorReporting', () => {
  function fakeTarget() {
    const handlers = {};
    return {
      handlers,
      addEventListener: (type, h) => {
        handlers[type] = h;
      },
      removeEventListener: (type) => {
        delete handlers[type];
      },
    };
  }

  it('is a no-op that returns a function when there is no target', () => {
    const off = installGlobalErrorReporting(null);
    expect(typeof off).toBe('function');
    expect(() => off()).not.toThrow();
  });

  it('registers and (on unsubscribe) removes both handlers', () => {
    const target = fakeTarget();
    const off = installGlobalErrorReporting(target);
    expect(typeof target.handlers.error).toBe('function');
    expect(typeof target.handlers.unhandledrejection).toBe('function');
    off();
    expect(target.handlers.error).toBeUndefined();
    expect(target.handlers.unhandledrejection).toBeUndefined();
  });

  it('POSTs to /api/log when an error event fires', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const target = fakeTarget();
    installGlobalErrorReporting(target);

    target.handlers.error({ message: 'kaboom', error: { stack: 'st' } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/log');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.kind).toBe('client-error');
    expect(body.message).toBe('kaboom');
  });
});
