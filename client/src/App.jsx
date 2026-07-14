import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import PresenterControls from './components/PresenterControls.jsx';

import { usePresenterStore } from './state/usePresenterStore.js';
import { computeSimpleTotals } from './lib/cost.js';
import { buildOverlayState } from './lib/overlayState.js';
import { quantizeForDisplay } from './lib/displayCadence.js';
import { logLifecycle } from './lib/lifecycleLog.js';
import { createVideoRecovery } from './lib/overlayRecover.js';

// The in-meeting SIDE PANEL: the presenter privately sets a manual attendee count and one
// hourly opportunity-cost rate, sees a live readout, and starts/stops the camera overlay.
// The overlay itself renders in the camera rendering context (see OverlayApp via Root) and
// receives state pushed over the adapter's message bridge — there is no viewer webview.

export default function App({ adapter }) {
  // --- Presenter session config (manual count + one rate + cadence) --------
  const { config, actions } = usePresenterStore();

  // --- Session + cost engine -----------------------------------------------
  const [session, setSession] = useState({ status: 'idle' });
  const elapsedRef = useRef(0);
  const totalRef = useRef(0);
  const lastTickRef = useRef(0);
  const [, forceTick] = useState(0);

  const sessionActions = useMemo(
    () => ({
      start() {
        elapsedRef.current = 0;
        totalRef.current = 0;
        lastTickRef.current = Date.now();
        setSession({ status: 'running' });
      },
      pause() {
        setSession({ status: 'paused' });
      },
      resume() {
        lastTickRef.current = Date.now();
        setSession({ status: 'running' });
      },
      end() {
        setSession({ status: 'ended' });
      },
    }),
    []
  );

  // The meter: manual attendee count × one hourly opportunity-cost rate.
  const totals = useMemo(
    () =>
      computeSimpleTotals({
        userCount: config.simpleUserCount,
        averageRate: config.simpleAverageRate,
      }),
    [config.simpleUserCount, config.simpleAverageRate]
  );

  // --- Camera overlay control ----------------------------------------------
  const [overlayOn, setOverlayOn] = useState(false);
  const overlayOnRef = useRef(false);
  overlayOnRef.current = overlayOn;
  // Last polled camera on/off state, for overlay auto-recovery. Seeded true when the
  // overlay starts (the presenter is on-camera then), so the first poll doesn't read a
  // phantom off→on transition.
  const lastVideoOnRef = useRef(true);

  // Latest values for the interval/poster without re-arming effects.
  const liveRef = useRef({});
  liveRef.current = {
    totals,
    status: session.status,
    displayIntervalSeconds: config.displayIntervalSeconds,
  };

  const postOverlay = useCallback(() => {
    if (!adapter?.postMessage) return;
    const { totals: t, status, displayIntervalSeconds } = liveRef.current;
    adapter.postMessage(
      buildOverlayState({
        status,
        totalCost: totalRef.current,
        totals: t,
        elapsedSeconds: elapsedRef.current,
        updatedAt: Date.now(),
        displayIntervalSeconds,
      })
    );
  }, [adapter]);

  const startOverlay = useCallback(async () => {
    // Diagnostic checkpoints: if 'begin' logs but 'context-started' does not, the panel
    // spawned the camera context but it never came back (or threw). See lifecycleLog.
    logLifecycle('start-overlay:begin', { status: liveRef.current.status });
    // Auto-start the session when the presenter shows the overlay while idle — the natural
    // next step after configuring is the session controls. (session-restart-controls.)
    if (liveRef.current.status === 'idle') sessionActions.start();
    // Manual (re)start: the presenter is on-camera now, so seed the poll baseline on
    // so the auto-recover doesn't read a phantom off→on against a stale value.
    lastVideoOnRef.current = true;
    await adapter?.startCameraOverlay?.();
    logLifecycle('start-overlay:context-started');
    setOverlayOn(true);
    postOverlay(); // push current numbers immediately
    logLifecycle('start-overlay:posted');
  }, [adapter, sessionActions, postOverlay]);

  const stopOverlay = useCallback(async () => {
    await adapter?.stopCameraOverlay?.();
    setOverlayOn(false);
  }, [adapter]);

  // Tick: advance elapsed + accumulated cost while running, and stream the
  // overlay state once a second when the overlay is on.
  useEffect(() => {
    if (session.status !== 'running') return;
    lastTickRef.current = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      const cps = liveRef.current.totals?.costPerSecond || 0;
      totalRef.current += cps * dt;
      elapsedRef.current += dt;
      forceTick((n) => n + 1);
      if (overlayOnRef.current) postOverlay();
    }, 1000);
    return () => clearInterval(id);
  }, [session.status, postOverlay]);

  // Push a fresh snapshot whenever the overlay turns on, the session status
  // changes, or the display cadence changes (so a paused/ended overlay shows the
  // frozen number, not stale data — and a cadence change reaches the camera
  // overlay immediately, even when no 1 s tick is running to carry it).
  useEffect(() => {
    if (overlayOn) postOverlay();
  }, [overlayOn, session.status, config.displayIntervalSeconds, postOverlay]);

  // Auto-recover the camera overlay across a camera off/on. Turning the camera off
  // tears down Zoom's camera rendering context (destroying the overlay webview);
  // turning it back on does NOT re-run our context, so the meter stays gone. We can't
  // hear the camera return from onMyMediaChange (it doesn't fire in the panel — see
  // overlay-rearm-reopen.md), so the panel POLLS getVideoState() and, on a detected
  // off→on edge while the overlay is on, CLOSES then REOPENS the rendering context
  // (what the presenter otherwise does by a manual Hide→Show). The poll runs only while
  // the overlay is on; the decision + close/reopen are unit-tested in overlayRecover.
  useEffect(() => {
    if (!overlayOn || !adapter?.getVideoState) return undefined;
    const recover = createVideoRecovery({
      getOverlayOn: () => overlayOnRef.current,
      getLastVideoOn: () => lastVideoOnRef.current,
      setLastVideoOn: (v) => {
        lastVideoOnRef.current = v;
      },
      getVideoState: () => adapter.getVideoState(),
      stopCameraOverlay: () => adapter.stopCameraOverlay?.(),
      startCameraOverlay: () => adapter.startCameraOverlay?.(),
      postOverlay,
      log: logLifecycle,
    });
    const id = setInterval(recover, 1500);
    return () => clearInterval(id);
  }, [overlayOn, adapter, postOverlay]);

  // --- Viewer's-eye preview (aggregate, quantized to the chosen cadence) ----
  // Exactly what participants see on the camera overlay: total, $/min, stepped
  // clock, head-count — quantized so it holds steady between N-second steps.
  const previewDisplay = useMemo(() => {
    const base = buildOverlayState({
      status: session.status,
      totalCost: totalRef.current,
      totals,
      elapsedSeconds: elapsedRef.current,
      displayIntervalSeconds: config.displayIntervalSeconds,
    });
    const q = quantizeForDisplay({
      totalCost: base.totalCost,
      elapsedSeconds: base.elapsedSeconds,
      costPerSecond: base.costPerSecond,
      stepSeconds: config.displayIntervalSeconds,
    });
    return { ...base, ...q };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.status, totals, config.displayIntervalSeconds, elapsedRef.current, totalRef.current]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Meeting Cost</h1>
        <p className="muted small">
          Private to you. Start the overlay to show the live cost on your video.
        </p>
      </header>

      {/* Single top-down column: the presenter configures, sees the one live
          preview, and drives the overlay — all in PresenterControls. */}
      <main className="layout solo">
        <PresenterControls
          config={config}
          actions={actions}
          session={session}
          sessionActions={sessionActions}
          overlayOn={overlayOn}
          startOverlay={startOverlay}
          stopOverlay={stopOverlay}
          previewDisplay={previewDisplay}
        />
      </main>
    </div>
  );
}
