import { useEffect, useRef, useState } from 'react';
import CostOverlay from './CostOverlay.jsx';
import { extrapolateOverlay } from '../lib/overlayState.js';
import { runCameraDraw } from '../lib/cameraDraw.js';
import { logLifecycle } from '../lib/lifecycleLog.js';

// Sentinel for "no snapshot received yet", so the very first message always logs.
const NO_STATUS = Symbol('no-status');

// Trace THIS camera-overlay instance's teardown so its disappearance leaves a
// timestamped log instead of silence. Zoom closes the camera rendering context on
// some media/lifecycle changes, destroying this webview with no other signal — the
// `pagehide` on the way out is our last chance to record it. Only the REAL camera
// mount registers (shouldLog === transparentBody): the panel never mounts OverlayApp
// and the mock preview mounts it with transparentBody=false. Returns a cleanup that
// removes the listener; the log call can never break teardown. Extracted as a plain
// function so it is unit-testable without jsdom (mirrors runCameraDraw).
export function registerOverlayTeardownLog(
  shouldLog,
  { target = typeof window !== 'undefined' ? window : null, log = logLifecycle } = {}
) {
  if (!shouldLog || typeof target?.addEventListener !== 'function') return () => {};
  const onPageHide = () => {
    try {
      log('overlay-teardown');
    } catch {
      /* logging must never break teardown */
    }
  };
  target.addEventListener('pagehide', onPageHide);
  return () => target.removeEventListener('pagehide', onPageHide);
}

// Runs in the camera rendering context (and, in mock dev, inside the simulated
// camera frame). It subscribes to overlay state pushed from the side panel via
// the adapter's message bridge and extrapolates between updates so the meter
// ticks smoothly. All hooks live here so CostOverlay stays pure/testable.

export default function OverlayApp({ adapter, transparentBody = true }) {
  const [state, setState] = useState(null);
  const [, force] = useState(0);

  // Confirm the overlay (inCamera) instance mounted.
  useEffect(() => {
    logLifecycle('overlay-mounted', { transparentBody });
  }, [transparentBody]);

  // Trace this instance's teardown (real camera mount only) so a silent overlay
  // disappearance — Zoom closing the rendering context — shows up in the log.
  useEffect(() => registerOverlayTeardownLog(transparentBody), [transparentBody]);

  // Log the first received snapshot and thereafter only on a status change (e.g.
  // running→paused) — not every tick. Shape/status only, never the aggregate values.
  const lastStatusRef = useRef(NO_STATUS);
  useEffect(() => {
    const unsub = adapter?.onMessage?.((payload) => {
      const status = payload?.status ?? null;
      if (lastStatusRef.current !== status) {
        lastStatusRef.current = status;
        logLifecycle('overlay-message', {
          type: payload === null ? 'null' : typeof payload,
          keys: payload && typeof payload === 'object' ? Object.keys(payload) : null,
          status,
        });
      }
      setState(payload);
    });
    return () => unsub && unsub();
  }, [adapter]);

  // Re-render a few times a second to advance the extrapolated total.
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  // In the real camera context the page must be transparent so only the card
  // composites over the video. (No-op for the mock preview, which is framed.)
  useEffect(() => {
    if (!transparentBody) return;
    const root = document.documentElement;
    root.classList.add('overlay-mode');
    return () => root.classList.remove('overlay-mode');
  }, [transparentBody]);

  // Composite the camera layers from THIS (camera) instance on mount: the base
  // video (drawParticipant) + this overlay webview (drawWebView). drawWebView
  // composites whichever instance calls it, so it must run here, not in the
  // panel. transparentBody marks the real camera mount; the mock preview skips.
  useEffect(() => runCameraDraw(adapter, transparentBody), [adapter, transparentBody]);

  if (!state) return <CostOverlay display={null} />;
  const ex = extrapolateOverlay(state);
  return <CostOverlay display={{ ...state, ...ex }} />;
}
