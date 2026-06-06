// Detecting that we're running embedded inside the Zoom client, and deciding
// which adapter the boot path may use.
//
// Why this exists: getZoomAdapter() used to fall back to MockZoom whenever
// VITE_USE_ZOOM !== '1' OR the @zoom/appssdk import failed — silently, with only
// a console.warn no one sees inside Zoom. A misconfigured (mock) build loaded in
// Zoom then showed the full presenter UI and "worked" for the presenter while
// rendering nothing to attendees. Inside Zoom we must NEVER silently use the
// mock; we surface a blocking error instead.

// Zoom's embedded webview advertises itself in the user-agent string. Match the
// known tokens. Kept as a pure function of the UA string so it's trivially
// testable and usable before any SDK import.
const ZOOM_UA_TOKENS = /ZoomApps|ZoomWebKit/i;

/**
 * True when the user-agent looks like the Zoom client's embedded webview.
 * @param {string} [userAgent] defaults to navigator.userAgent when available.
 */
export function isZoomLikeEnvironment(
  userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : undefined
) {
  return typeof userAgent === 'string' && ZOOM_UA_TOKENS.test(userAgent);
}

/**
 * Pure decision for which adapter the boot path may use. Performs NO import;
 * the caller imports the SDK (only when wantReal) and passes the outcome back.
 *
 * @param {object} p
 * @param {boolean} p.wantReal  VITE_USE_ZOOM === '1'
 * @param {boolean} p.inZoom    isZoomLikeEnvironment()
 * @param {boolean} [p.importOk] whether the SDK import succeeded (only meaningful
 *                               when wantReal; ignored otherwise)
 * @returns {{action:'real'} | {action:'mock'} | {action:'blocked', reason:'mock-build'|'import-fail'}}
 */
export function decideAdapter({ wantReal, inZoom, importOk }) {
  if (!wantReal) {
    // A mock build (VITE_USE_ZOOM unset) is fine for local dev, but inside Zoom
    // it is exactly the silent-mock failure we must refuse.
    return inZoom ? { action: 'blocked', reason: 'mock-build' } : { action: 'mock' };
  }
  // wantReal: the caller attempted the SDK import.
  if (importOk) return { action: 'real' };
  // Import failed. Outside Zoom this is a dev machine without @zoom/appssdk —
  // degrade to mock as before. Inside Zoom, refuse and surface a blocking error.
  return inZoom ? { action: 'blocked', reason: 'import-fail' } : { action: 'mock' };
}
