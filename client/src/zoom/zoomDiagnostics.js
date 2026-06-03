// Diagnostic probe for the Zoom Apps SDK (recon spike — see reviews/zoom-first-light.md).
//
// RealZoom (zoomAdapter.js) swallows SDK errors so the app can degrade
// gracefully — which makes it useless for diagnosis. This module does the
// OPPOSITE: it calls each SDK method, records the raw result OR error per call
// without ever throwing, and ships the bundle to the server's /api/log sink so
// a single in-Zoom run gives us ground-truth output (including the real
// participant data shape).
//
// This is recon-only. It does not configure the app for normal use and is wired
// to run exclusively inside Zoom behind a URL flag (see shouldRunDiagnostics).

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
 * Probe each SDK method in order. NEVER throws: a method that rejects, throws
 * synchronously, or is missing yields { method, ok:false, error }. Returns the
 * per-call entries (in call order) and emits the bundle via the injected `log`.
 *
 * @param {object} sdk   the Zoom Apps SDK (or any object exposing the methods)
 * @param {object} [opts]
 * @param {(bundle:object)=>any} [opts.log]      sink for the diagnostics bundle
 * @param {Array}  [opts.methods]                override probe list (tests)
 * @returns {Promise<Array<{method,ok,result?,error?}>>}
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
      entries.push({ method, ok: true, result });
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

/** POST a payload to the server log sink; swallow any failure. */
export async function postLog(payload) {
  try {
    await fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    /* server may be unreachable; non-fatal */
  }
}

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
