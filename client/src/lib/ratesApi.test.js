import { describe, it, expect, vi } from 'vitest';
import { loadRates, saveRates } from './ratesApi.js';

const adapterWith = (ctx) => ({ getAppContext: async () => ctx });

function fakeFetch(impl) {
  return vi.fn(impl);
}

describe('loadRates', () => {
  it('sends the app context header and returns the config on 200', async () => {
    const cfg = { rateTable: [{ id: 'r1', name: 'A', rate: 1 }] };
    const fetchImpl = fakeFetch(async () => ({ ok: true, json: async () => cfg }));
    const out = await loadRates(adapterWith('ctx-1'), { fetchImpl });
    expect(out).toEqual(cfg);
    expect(fetchImpl).toHaveBeenCalledWith('/api/rates', {
      headers: { 'x-zoom-app-context': 'ctx-1' },
    });
  });

  it('returns null when there is no app context (mock / not in Zoom)', async () => {
    const fetchImpl = fakeFetch(async () => ({ ok: true, json: async () => ({}) }));
    expect(await loadRates(adapterWith(null), { fetchImpl })).toBe(null);
    expect(fetchImpl).not.toHaveBeenCalled(); // never even calls the server
  });

  it('returns null on a non-ok response (401/503) or a thrown fetch', async () => {
    expect(await loadRates(adapterWith('c'), { fetchImpl: fakeFetch(async () => ({ ok: false })) })).toBe(null);
    expect(
      await loadRates(adapterWith('c'), { fetchImpl: fakeFetch(async () => { throw new Error('net'); }) })
    ).toBe(null);
  });
});

describe('saveRates', () => {
  it('PUTs the config with the context header and returns true on ok', async () => {
    const fetchImpl = fakeFetch(async () => ({ ok: true }));
    const ok = await saveRates(adapterWith('ctx-9'), { rateTable: [] }, { fetchImpl });
    expect(ok).toBe(true);
    const [, opts] = fetchImpl.mock.calls[0];
    expect(opts.method).toBe('PUT');
    expect(opts.headers['x-zoom-app-context']).toBe('ctx-9');
    expect(JSON.parse(opts.body)).toEqual({ rateTable: [] });
  });

  it('returns false without a context, on non-ok, or on a thrown fetch', async () => {
    expect(await saveRates(adapterWith(null), {}, { fetchImpl: fakeFetch(async () => ({ ok: true })) })).toBe(false);
    expect(await saveRates(adapterWith('c'), {}, { fetchImpl: fakeFetch(async () => ({ ok: false })) })).toBe(false);
    expect(await saveRates(adapterWith('c'), {}, { fetchImpl: fakeFetch(async () => { throw new Error('net'); }) })).toBe(false);
  });
});
