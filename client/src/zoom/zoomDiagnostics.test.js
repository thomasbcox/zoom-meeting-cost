import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  runZoomDiagnostics,
  describeShape,
  postLog,
  shouldRunDiagnostics,
} from './zoomDiagnostics.js';

// A minimal probe list so tests don't depend on the real method set.
const METHODS = [
  { method: 'resolves', args: [] },
  { method: 'rejects', args: [] },
  { method: 'throws', args: [] },
  { method: 'missing', args: [] },
];

describe('runZoomDiagnostics', () => {
  it('captures a per-call entry for every method, in order', async () => {
    const sdk = {
      resolves: async () => ({ runningContext: 'inMeeting' }),
      rejects: async () => {
        throw new Error('not permitted');
      },
      throws: () => {
        throw new Error('boom');
      },
      // `missing` intentionally absent
    };
    const log = vi.fn();

    const entries = await runZoomDiagnostics(sdk, { log, methods: METHODS });

    expect(entries.map((e) => e.method)).toEqual([
      'resolves',
      'rejects',
      'throws',
      'missing',
    ]);
  });

  it('records successes as ok:true with the data SHAPE, never the raw result', async () => {
    const sdk = { resolves: async () => ({ runningContext: 'inMeeting' }) };
    const [entry] = await runZoomDiagnostics(sdk, {
      log: vi.fn(),
      methods: [{ method: 'resolves', args: [] }],
    });
    expect(entry).toEqual({
      method: 'resolves',
      ok: true,
      shape: { type: 'object', keys: ['runningContext'] },
    });
    expect(entry).not.toHaveProperty('result');
  });

  it('never transmits participant PII — only the shape (key names, lengths, counts)', async () => {
    const sdk = {
      getUserContext: async () => ({ screenName: 'Jane Q. Participant', role: 'host' }),
      getMeetingParticipants: async () => [
        { screenName: 'Jane Q. Participant', participantId: 'p1' },
        { screenName: 'Bob R. Attendee', participantId: 'p2' },
      ],
    };
    const log = vi.fn();
    const entries = await runZoomDiagnostics(sdk, {
      log,
      methods: [
        { method: 'getUserContext', args: [] },
        { method: 'getMeetingParticipants', args: [] },
      ],
    });

    // No raw results anywhere; only shape.
    expect(entries.every((e) => !('result' in e) && 'shape' in e)).toBe(true);
    expect(entries[0].shape).toEqual({ type: 'object', keys: ['screenName', 'role'] });
    expect(entries[1].shape).toEqual({
      type: 'array',
      length: 2,
      of: { type: 'object', keys: ['screenName', 'participantId'] },
    });

    // The serialized bundle (what reaches the server / console) carries the structure
    // but none of the names.
    const serialized = JSON.stringify(log.mock.calls[0][0]);
    expect(serialized).not.toContain('Jane Q. Participant');
    expect(serialized).not.toContain('Bob R. Attendee');
    expect(serialized).toContain('screenName'); // key names are safe recon
  });

  it('records rejections, sync throws, and missing methods as ok:false with an error', async () => {
    const sdk = {
      rejects: async () => {
        throw new Error('not permitted');
      },
      throws: () => {
        throw new Error('boom');
      },
    };
    const entries = await runZoomDiagnostics(sdk, { log: vi.fn(), methods: METHODS });
    const byMethod = Object.fromEntries(entries.map((e) => [e.method, e]));

    expect(byMethod.rejects).toMatchObject({ ok: false, error: 'not permitted' });
    expect(byMethod.throws).toMatchObject({ ok: false, error: 'boom' });
    expect(byMethod.missing).toMatchObject({ ok: false });
    expect(byMethod.missing.error).toMatch(/not available/i);
  });

  it('never throws even when every method fails', async () => {
    await expect(
      runZoomDiagnostics(
        {
          throws: () => {
            throw new Error('x');
          },
        },
        { log: vi.fn(), methods: [{ method: 'throws', args: [] }] }
      )
    ).resolves.toBeDefined();
  });

  it('never throws when the sdk itself is null', async () => {
    const entries = await runZoomDiagnostics(null, { log: vi.fn(), methods: METHODS });
    expect(entries.every((e) => e.ok === false)).toBe(true);
  });

  it('emits a greppable zoom-diagnostics bundle to the log sink', async () => {
    const log = vi.fn();
    await runZoomDiagnostics(
      { resolves: async () => 1 },
      { log, methods: [{ method: 'resolves', args: [] }] }
    );
    expect(log).toHaveBeenCalledTimes(1);
    const bundle = log.mock.calls[0][0];
    expect(bundle.kind).toBe('zoom-diagnostics');
    expect(Array.isArray(bundle.entries)).toBe(true);
    expect(bundle.entries).toHaveLength(1);
  });

  it('does not let a throwing log sink break the probe', async () => {
    const log = vi.fn(() => {
      throw new Error('log failed');
    });
    await expect(
      runZoomDiagnostics(
        { resolves: async () => 1 },
        { log, methods: [{ method: 'resolves', args: [] }] }
      )
    ).resolves.toHaveLength(1);
  });
});

describe('describeShape (PII-safe structural summary)', () => {
  it('describes a string by LENGTH ONLY — never its value', () => {
    expect(describeShape('Jane Q. Participant')).toEqual({ type: 'string', length: 19 });
  });

  it('describes an object by key NAMES, not values', () => {
    expect(describeShape({ screenName: 'Jane', role: 'host' })).toEqual({
      type: 'object',
      keys: ['screenName', 'role'],
    });
  });

  it('describes an array by length and the shape of its first element', () => {
    expect(describeShape([{ screenName: 'Jane' }, { screenName: 'Bob' }])).toEqual({
      type: 'array',
      length: 2,
      of: { type: 'object', keys: ['screenName'] },
    });
    expect(describeShape([])).toEqual({ type: 'array', length: 0 });
  });

  it('keeps non-PII number / boolean values', () => {
    expect(describeShape(5)).toEqual({ type: 'number', value: 5 });
    expect(describeShape(true)).toEqual({ type: 'boolean', value: true });
  });

  it('handles null / undefined', () => {
    expect(describeShape(null)).toEqual({ type: 'null' });
    expect(describeShape(undefined)).toEqual({ type: 'undefined' });
  });

  it('emits only key names for nested objects — a deep string value is never reached', () => {
    // Objects never recurse into their values, so even a deeply-buried string is unreachable.
    const deep = { a: { b: { c: { secret: 'Jane Q. Participant' } } } };
    const out = describeShape(deep);
    expect(out).toEqual({ type: 'object', keys: ['a'] });
    expect(JSON.stringify(out)).not.toContain('Jane Q. Participant');
  });

  it('is depth-bounded on deeply nested arrays', () => {
    const deep = [[[['Jane Q. Participant']]]];
    const out = describeShape(deep);
    expect(JSON.stringify(out)).not.toContain('Jane Q. Participant');
    expect(JSON.stringify(out)).toContain('truncated');
  });

  it('never throws on odd input', () => {
    expect(() => describeShape(() => {})).not.toThrow();
    expect(() => describeShape(Symbol('x'))).not.toThrow();
  });
});

describe('postLog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the payload as JSON to /api/log', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await postLog({ kind: 'zoom-diagnostics', entries: [] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/log');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ kind: 'zoom-diagnostics', entries: [] });
  });

  it('swallows a fetch failure instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );
    await expect(postLog({ any: 'thing' })).resolves.toBeUndefined();
  });
});

describe('shouldRunDiagnostics', () => {
  it('is true only when VITE_USE_ZOOM=1 and ?diag=1 are both present', () => {
    expect(shouldRunDiagnostics({ VITE_USE_ZOOM: '1' }, '?diag=1')).toBe(true);
  });

  it('is false in default mock mode (no flags)', () => {
    expect(shouldRunDiagnostics({}, '')).toBe(false);
  });

  it('is false when only one of the two conditions is met', () => {
    expect(shouldRunDiagnostics({ VITE_USE_ZOOM: '1' }, '')).toBe(false);
    expect(shouldRunDiagnostics({}, '?diag=1')).toBe(false);
  });
});
