// Global client error visibility.
//
// Inside Zoom there is no easy console, so an uncaught error or unhandled
// promise rejection would otherwise be invisible (a blank screen). These
// handlers ship a structured payload to the server's /api/log sink so any
// in-Zoom failure self-reports. They never throw themselves.

import { postLog } from './postLog.js';

/** Report a single client-side error to the server. Never throws. */
export function reportClientError(detail, { log = postLog } = {}) {
  try {
    return log({
      kind: 'client-error',
      ...detail,
      // Best-effort context; guarded so this works outside a browser too.
      url: typeof location !== 'undefined' ? location.href : undefined,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    });
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
