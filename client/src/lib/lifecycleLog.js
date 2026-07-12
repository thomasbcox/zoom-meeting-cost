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

// NOTE: the `pagehide` teardown breadcrumbs were retired 2026-07-12 — a live run proved
// Zoom hard-kills the webview without dispatching `pagehide`, so they never fired. See
// reviews/retire-teardown-breadcrumb.md.
