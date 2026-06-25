// Diagnostic probe for the Zoom Apps SDK (recon spike — see reviews/zoom-first-light.md).
//
// RealZoom (zoomAdapter.js) swallows SDK errors so the app can degrade
// gracefully — which makes it useless for diagnosis. This module does the
// OPPOSITE: it calls each SDK method, records the result's data SHAPE (key names,
// lengths, counts — never the raw values) OR the error per call without ever
// throwing, and ships the bundle to the server's /api/log sink so a single in-Zoom
// run reveals the real participant/user-context data shape with no PII.
//
// This is recon-only. It does not configure the app for normal use and is wired
// to run exclusively inside Zoom behind a URL flag (see shouldRunDiagnostics).

import { postLog } from '../lib/postLog.js';

// Methods probed, in order. `config` must run first (it gates everything else),
// using the same capabilities RealZoom requests.
export const PROBE_METHODS = [
  {
    method: 'config',
    args: [
      {
        capabilities: [
          'getRunningContext',
          'getMeetingContext',
          'getMeetingParticipants',
          'getUserContext',
          'onParticipantChange',
        ],
      },
    ],
  },
  { method: 'getRunningContext', args: [] },
  { method: 'getMeetingContext', args: [] },
  { method: 'getUserContext', args: [] },
  { method: 'getMeetingParticipants', args: [] },
];

function errToString(err) {
  if (err instanceof Error) return err.message || String(err);
  if (err && typeof err === 'object') {
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * PII-safe STRUCTURAL summary of an SDK result. The whole point of the probe is to learn the
 * *shape* of Zoom's responses (e.g. getMeetingParticipants → an array of
 * `{ screenName, participantId, role }`), NOT their contents. The invariant that makes a
 * participant name / email structurally impossible to leak: a string is described by its
 * LENGTH ONLY — its value is never emitted. Objects expose key NAMES (not values), arrays
 * expose length + the shape of their first element, and numbers/booleans (non-PII) keep their
 * value. Depth-bounded and never throws.
 */
export function describeShape(value, depth = 0) {
  if (value === null) return { type: 'null' };
  if (value === undefined) return { type: 'undefined' };
  const t = typeof value;
  if (t === 'string') return { type: 'string', length: value.length };
  if (t === 'number' || t === 'boolean') return { type: t, value };
  if (t !== 'object') return { type: t }; // function / symbol / bigint — no value
  if (depth >= 3) return { type: Array.isArray(value) ? 'array' : 'object', truncated: true };
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      ...(value.length ? { of: describeShape(value[0], depth + 1) } : {}),
    };
  }
  return { type: 'object', keys: Object.keys(value) };
}

/**
 * Probe each SDK method in order. NEVER throws: a method that rejects, throws
 * synchronously, or is missing yields { method, ok:false, error }. Returns the
 * per-call entries (in call order) and emits the bundle via the injected `log`.
 *
 * PRIVACY: a successful call records only the data *shape* of the result
 * (`describeShape` — key names, lengths, counts), NEVER the raw result. So a real run
 * reveals the participant/user-context structure without ever transmitting names or
 * other values to the server or the browser console.
 *
 * @param {object} sdk   the Zoom Apps SDK (or any object exposing the methods)
 * @param {object} [opts]
 * @param {(bundle:object)=>any} [opts.log]      sink for the diagnostics bundle
 * @param {Array}  [opts.methods]                override probe list (tests)
 * @returns {Promise<Array<{method,ok,shape?,error?}>>}
 */
export async function runZoomDiagnostics(sdk, { log = defaultLog, methods = PROBE_METHODS } = {}) {
  const entries = [];
  for (const { method, args = [] } of methods) {
    if (!sdk || typeof sdk[method] !== 'function') {
      entries.push({ method, ok: false, error: 'method not available on SDK' });
      continue;
    }
    try {
      const result = await sdk[method](...args);
      entries.push({ method, ok: true, shape: describeShape(result) });
    } catch (err) {
      entries.push({ method, ok: false, error: errToString(err) });
    }
  }

  const bundle = { kind: 'zoom-diagnostics', entries };
  try {
    await log(bundle);
  } catch {
    /* logging must never break diagnostics */
  }
  return entries;
}

// postLog now lives in lib/postLog.js (shared with the client error reporter).
// Re-exported here so existing imports — including tests — keep working.
export { postLog };

async function defaultLog(bundle) {
  // eslint-disable-next-line no-console
  console.log('[zoom-diagnostics]', bundle);
  await postLog(bundle);
}

/**
 * True only inside Zoom (VITE_USE_ZOOM=1) AND with the ?diag=1 URL flag, so the
 * probe never runs in ordinary mock dev. Args are injectable for testing.
 */
export function shouldRunDiagnostics(env = import.meta.env, search = window.location.search) {
  const wantReal = env?.VITE_USE_ZOOM === '1';
  const params = new URLSearchParams(search || '');
  return wantReal && params.get('diag') === '1';
}

/**
 * App-startup entry point. No-op (returns null) unless shouldRunDiagnostics().
 * Otherwise loads the real SDK and runs the probe, reporting an import failure
 * through the same sink so even "the SDK wouldn't load" is visible server-side.
 */
export async function maybeRunZoomDiagnostics() {
  if (!shouldRunDiagnostics()) return null;
  let sdk;
  try {
    const mod = await import('@zoom/appssdk');
    sdk = mod.default ?? mod;
  } catch (err) {
    await defaultLog({
      kind: 'zoom-diagnostics',
      entries: [{ method: 'import', ok: false, error: errToString(err) }],
    });
    return null;
  }
  return runZoomDiagnostics(sdk);
}
