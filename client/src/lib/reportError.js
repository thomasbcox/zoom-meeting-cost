// Global client error visibility.
//
// Inside Zoom there is no easy console, so an uncaught error or unhandled
// promise rejection would otherwise be invisible (a blank screen). These
// handlers ship a structured payload to the server's /api/log sink so any
// in-Zoom failure self-reports. They never throw themselves.

import { postLog } from './postLog.js';

// Data minimization: a client-error report carries ONLY this fixed set of technical fields,
// and ONLY as scalars of the expected type — never an arbitrary caller-supplied bag, and never
// a nested object/array under an allowed key — so participant PII can't ride along into the
// logs. `url` is reduced to its pathname (the query string can carry tokens / context, like the
// server's request log) and the string fields are length-capped to bound the log line.
const STRING_FIELDS = ['source', 'message', 'stack', 'filename', 'componentStack'];
const NUMBER_FIELDS = ['lineno', 'colno'];
const MAX_TEXT = 4000;

function pathnameOnly(href) {
  try {
    return new URL(href).pathname;
  } catch {
    return undefined;
  }
}

/**
 * Build the minimal, allowlisted client-error payload. Pure; never throws. Copies only the
 * known technical fields from `detail`, each normalized to its expected scalar type — string
 * fields kept only if a string (length-capped), `lineno`/`colno` only if a finite number;
 * anything else (objects, arrays, functions) is DROPPED, not copied. Reduces the current url to
 * its pathname and adds the userAgent — nothing else from `detail` survives.
 */
export function buildClientErrorPayload(detail = {}) {
  const payload = { kind: 'client-error' };
  for (const key of STRING_FIELDS) {
    const v = detail?.[key];
    if (typeof v === 'string') payload[key] = v.slice(0, MAX_TEXT);
  }
  for (const key of NUMBER_FIELDS) {
    const v = detail?.[key];
    if (typeof v === 'number' && Number.isFinite(v)) payload[key] = v;
  }
  if (typeof location !== 'undefined') {
    const p = pathnameOnly(location.href);
    if (p !== undefined) payload.url = p;
  }
  if (typeof navigator !== 'undefined') payload.userAgent = navigator.userAgent;
  return payload;
}

/** Report a single client-side error to the server. Never throws. */
export function reportClientError(detail, { log = postLog } = {}) {
  try {
    return log(buildClientErrorPayload(detail));
  } catch {
    /* reporting must never break the app */
    return undefined;
  }
}

/**
 * Wire window-level error + unhandledrejection handlers to reportClientError.
 * No-op (and never throws) when there is no window (e.g. unit tests, SSR).
 * Returns an unsubscribe function.
 */
export function installGlobalErrorReporting(target = typeof window !== 'undefined' ? window : null) {
  if (!target || typeof target.addEventListener !== 'function') return () => {};

  const onError = (event) => {
    reportClientError({
      source: 'window.onerror',
      message: event?.message ?? String(event),
      stack: event?.error?.stack,
      filename: event?.filename,
      lineno: event?.lineno,
      colno: event?.colno,
    });
  };

  const onRejection = (event) => {
    const reason = event?.reason;
    reportClientError({
      source: 'unhandledrejection',
      message: reason?.message ?? String(reason),
      stack: reason?.stack,
    });
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);

  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
