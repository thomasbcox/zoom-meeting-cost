import { describe, it, expect, vi, afterEach } from 'vitest';
import { postLog } from './postLog.js';

// Transport contract for the /api/log sink. The keepalive option is what lets a
// teardown breadcrumb (pagehide) survive the webview unloading — an ordinary fetch
// is canceled at that moment. See registerTeardownLog / dev-docs/panel-close-teardown.md.

describe('postLog', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs the JSON payload to /api/log, keepalive off by default', async () => {
    const fetchMock = vi.fn(() => Promise.resolve());
    vi.stubGlobal('fetch', fetchMock);

    await postLog({ kind: 'lifecycle', event: 'boot' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/log');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.body).toBe(JSON.stringify({ kind: 'lifecycle', event: 'boot' }));
    expect(init.keepalive).toBe(false);
  });

  it('sets keepalive:true when requested (teardown-safe delivery)', async () => {
    const fetchMock = vi.fn(() => Promise.resolve());
    vi.stubGlobal('fetch', fetchMock);

    await postLog({ event: 'panel-teardown' }, { keepalive: true });

    expect(fetchMock.mock.calls[0][1].keepalive).toBe(true);
  });

  it('never throws when fetch rejects (logging must not break its caller)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline')))
    );
    await expect(postLog({ a: 1 })).resolves.toBeUndefined();
  });
});
