import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  reportClientError,
  buildClientErrorPayload,
  installGlobalErrorReporting,
} from './reportError.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('reportClientError', () => {
  it('logs an allowlisted client-error payload (does not pass arbitrary detail through)', () => {
    const log = vi.fn();
    reportClientError(
      { source: 'src', message: 'boom', email: 'jane@example.com', participants: [{ screenName: 'Jane' }] },
      { log }
    );
    expect(log).toHaveBeenCalledTimes(1);
    const payload = log.mock.calls[0][0];
    expect(payload.kind).toBe('client-error');
    expect(payload.source).toBe('src');
    expect(payload.message).toBe('boom');
    // PII / arbitrary fields are dropped, not merged.
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('participants');
  });

  it('never throws even if the log sink throws', () => {
    const log = () => {
      throw new Error('sink down');
    };
    expect(() => reportClientError({ message: 'x' }, { log })).not.toThrow();
  });
});

describe('buildClientErrorPayload (data minimization)', () => {
  it('keeps only the allowlisted technical fields', () => {
    const payload = buildClientErrorPayload({
      source: 'window.onerror',
      message: 'boom',
      stack: 'at foo',
      filename: 'app.js',
      lineno: 12,
      colno: 3,
      componentStack: 'in <App>',
    });
    expect(payload).toMatchObject({
      kind: 'client-error',
      source: 'window.onerror',
      message: 'boom',
      stack: 'at foo',
      filename: 'app.js',
      lineno: 12,
      colno: 3,
      componentStack: 'in <App>',
    });
  });

  it('drops any field outside the allowlist (e.g. injected PII)', () => {
    const payload = buildClientErrorPayload({
      message: 'boom',
      email: 'jane@example.com',
      participants: [{ screenName: 'Jane Q. Participant' }],
      uid: 'secret-uid',
    });
    expect(JSON.stringify(payload)).not.toContain('jane@example.com');
    expect(JSON.stringify(payload)).not.toContain('Jane Q. Participant');
    expect(payload).not.toHaveProperty('uid');
  });

  it('drops non-scalar values under allowed keys (no nested payload can ride through)', () => {
    const payload = buildClientErrorPayload({
      message: { participants: [{ screenName: 'Jane Q. Participant' }] }, // object under an allowed key
      stack: ['frame-a', 'frame-b'], // array under an allowed key
      lineno: { evil: 1 },
    });
    expect(payload).not.toHaveProperty('message'); // dropped, not copied verbatim
    expect(payload).not.toHaveProperty('stack');
    expect(payload).not.toHaveProperty('lineno');
    expect(JSON.stringify(payload)).not.toContain('Jane Q. Participant');
  });

  it('keeps lineno/colno only when finite numbers', () => {
    expect(buildClientErrorPayload({ lineno: 12, colno: 3 })).toMatchObject({ lineno: 12, colno: 3 });
    const dropped = buildClientErrorPayload({ lineno: NaN, colno: '3' });
    expect(dropped).not.toHaveProperty('lineno'); // NaN is not finite
    expect(dropped).not.toHaveProperty('colno'); // string is not a number
  });

  it('reduces url to its pathname (strips the query string)', () => {
    vi.stubGlobal('location', { href: 'https://app.example.com/panel?token=secret-token' });
    const payload = buildClientErrorPayload({ message: 'x' });
    expect(payload.url).toBe('/panel');
    expect(JSON.stringify(payload)).not.toContain('secret-token');
  });

  it('length-caps free-text fields', () => {
    const payload = buildClientErrorPayload({ message: 'a'.repeat(10000) });
    expect(payload.message.length).toBe(4000);
  });

  it('never throws on empty / missing detail', () => {
    expect(() => buildClientErrorPayload()).not.toThrow();
    expect(buildClientErrorPayload().kind).toBe('client-error');
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
