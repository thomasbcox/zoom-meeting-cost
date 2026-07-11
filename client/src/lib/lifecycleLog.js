// Structured lifecycle/observability logging for the camera-overlay data path.
//
// Emits `{ kind: 'lifecycle', event, instanceId, ...extra }` to the /api/log sink so
// a live run produces a labelled, greppable trace of which app instance booted in
// which running context, whether the inMeeting sender survives runRenderingContext,
// and whether the inCamera instance receives messages. Sits beside the existing
// `zoom-overlay` SDK-call instrumentation.
//
// PRIVACY: callers pass only non-sensitive fields (instance id, running-context
// strings, event names, payload shape/keys). Never participant names, rates, or the
// private config. Like postLog, this must never throw.

import { postLog } from './postLog.js';
import { instanceId } from './instanceId.js';

/**
 * @param {string} event   short event name, e.g. 'boot' | 'panel-mounted' |
 *                          'start-overlay:context-started' | 'overlay-message'
 * @param {Object} [extra] additional non-sensitive fields to merge into the entry
 * @param {Function} [sink] log sink (injectable for tests); defaults to postLog
 */
export function logLifecycle(event, extra = {}, sink = postLog) {
  try {
    sink({ kind: 'lifecycle', event, instanceId, ...extra });
  } catch {
    /* logging must never break the thing it observes */
  }
}

// A teardown-safe lifecycle log: routes through postLog with keepalive so the entry
// survives the webview being destroyed (pagehide cancels an ordinary fetch). Only the
// event name crosses — no PII — like every lifecycle log.
function teardownLog(event) {
  logLifecycle(event, {}, (payload) => postLog(payload, { keepalive: true }));
}

/**
 * Register a `pagehide` listener that emits a single lifecycle breadcrumb when the
 * instance is torn down, then returns a cleanup that removes it. Zoom can destroy a
 * webview (the camera rendering context, or the side panel on close) with no other
 * signal, so `pagehide` is the last chance to record it — and the default sink uses
 * keepalive so that final beacon actually reaches the server.
 *
 * Extracted as a plain, injectable function (fake target + sink) so the register/
 * fire/cleanup contract is unit-testable without jsdom — mirrors registerOverlayTeardownLog
 * / runCameraDraw. Logging must never break teardown, so a throwing sink is swallowed.
 *
 * @param {string} event  breadcrumb name, e.g. 'panel-teardown' | 'overlay-teardown'
 * @param {Object} [opts]
 * @param {EventTarget|null} [opts.target] defaults to window when present, else null (no-op)
 * @param {(event: string) => void} [opts.log] logger called with the event name; defaults
 *                                             to the keepalive-safe teardownLog
 * @returns {() => void} cleanup (safe no-op when there is no usable target)
 */
export function registerTeardownLog(
  event,
  { target = typeof window !== 'undefined' ? window : null, log = teardownLog } = {}
) {
  if (typeof target?.addEventListener !== 'function') return () => {};
  const onPageHide = () => {
    try {
      log(event);
    } catch {
      /* logging must never break teardown */
    }
  };
  target.addEventListener('pagehide', onPageHide);
  return () => target.removeEventListener('pagehide', onPageHide);
}
