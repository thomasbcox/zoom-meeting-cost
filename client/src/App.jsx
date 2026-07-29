import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import PresenterControls from './components/PresenterControls.jsx';

import { usePresenterStore } from './state/usePresenterStore.js';
import { computeSimpleTotals } from './lib/cost.js';
import { buildOverlayState } from './lib/overlayState.js';
import { quantizeForDisplay } from './lib/displayCadence.js';
import { logLifecycle } from './lib/lifecycleLog.js';
import { createVideoRecovery, createPostRecovery, runStopOverlay } from './lib/overlayRecover.js';

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
  // Warning shown when a start is refused (camera off, or the SDK rejected). Null = hidden.
  const [overlayNotice, setOverlayNotice] = useState(null);
  // Last polled camera on/off state, for overlay auto-recovery. Seeded true when the
  // overlay starts (the presenter is on-camera then), so the first poll doesn't read a
  // phantom off→on transition.
  const lastVideoOnRef = useRef(true);
  // Single-flight guard shared by both recovery paths (camera-off poll + dead-link) and read
  // by a racing manual Hide, so at most one close→reopen runs at a time.
  const recoveringRef = useRef(false);
  // Dead-postMessage-link recovery state: consecutive failed sends + last rebuild time.
  const postStateRef = useRef({ consecutiveFailures: 0, lastRebuildAt: 0 });

  // Latest values for the interval/poster without re-arming effects.
  const liveRef = useRef({});
  liveRef.current = {
    totals,
    status: session.status,
    displayIntervalSeconds: config.displayIntervalSeconds,
  };

  const postOverlay = useCallback(() => {
    if (!adapter?.postMessage) return Promise.resolve(false);
    const { totals: t, status, displayIntervalSeconds } = liveRef.current;
    // Normalize to a Promise<boolean> — MockZoom returns a bare boolean, RealZoom a
    // Promise<boolean> — so the tick can observe a dead link uniformly.
    return Promise.resolve(
      adapter.postMessage(
        buildOverlayState({
          status,
          totalCost: totalRef.current,
          totals: t,
          elapsedSeconds: elapsedRef.current,
          updatedAt: Date.now(),
          displayIntervalSeconds,
        })
      )
    );
  }, [adapter]);

  // Dead-postMessage-link recovery: feed each tick's send outcome through the pure reducer and,
  // when a rebuild is due (N consecutive failures + cooldown elapsed), run the shared close→reopen.
  const runPostRecovery = useMemo(
    () =>
      createPostRecovery({
        getState: () => postStateRef.current,
        setState: (s) => {
          postStateRef.current = s;
        },
        now: Date.now,
        getOverlayOn: () => overlayOnRef.current,
        isRecovering: () => recoveringRef.current,
        setRecovering: (v) => {
          recoveringRef.current = v;
        },
        stop: () => adapter?.stopCameraOverlay?.(),
        start: () => adapter?.startCameraOverlay?.(),
        post: postOverlay,
        log: logLifecycle,
      }),
    [adapter, postOverlay]
  );

  const startOverlay = useCallback(async () => {
    // Thin wrapper over the extracted, testable orchestrator: it does the check→commit→mutate
    // work and never throws; we only translate its result into React state here.
    const result = await attemptStartOverlay({
      adapter,
      status: liveRef.current.status,
      startSession: sessionActions.start,
      seedBaseline: () => {
        // The presenter is on-camera now (the start succeeded), so seed the poll baseline on
        // — the auto-recover then won't read a phantom off→on against a stale value.
        lastVideoOnRef.current = true;
      },
      post: postOverlay, // push current numbers immediately
      log: logLifecycle,
    });
    if (result === 'started') {
      setOverlayOn(true);
      setOverlayNotice(null); // clear any earlier warning
    } else {
      // 'blocked-camera-off' or 'error' — show the same actionable, two-step warning and
      // leave the overlay off. No session was started and no baseline was seeded.
      setOverlayNotice(CAMERA_OFF_NOTICE);
    }
  }, [adapter, sessionActions, postOverlay]);

  const stopOverlay = useCallback(
    () =>
      runStopOverlay({
        setOff: () => {
          // Record the hidden intent FIRST (ref + state) so a rebuild racing in the background
          // re-checks getOverlayOn and bails before reopening. The close is best-effort: even if
          // the context is already gone (a dead link), the button still reaches "Show cost on video".
          overlayOnRef.current = false;
          setOverlayOn(false);
        },
        stop: () => adapter?.stopCameraOverlay?.(),
      }),
    [adapter]
  );

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
      // Observe each send: a run of failures means the camera instance is gone (e.g. a breakout
      // teardown with the camera still on) → rebuild the rendering context, rate-limited.
      if (overlayOnRef.current) postOverlay().then(runPostRecovery);
    }, 1000);
    return () => clearInterval(id);
  }, [session.status, postOverlay, runPostRecovery]);

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
      isRecovering: () => recoveringRef.current,
      setRecovering: (v) => {
        recoveringRef.current = v;
      },
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
          overlayNotice={overlayNotice}
          startOverlay={startOverlay}
          stopOverlay={stopOverlay}
          previewDisplay={previewDisplay}
        />
      </main>
    </div>
  );
}

// Message shown when the overlay can't start because the camera is off (or the SDK refused the
// start). It names BOTH steps on purpose — the overlay never auto-appears, so the presenter must
// turn the camera on AND click "Show cost on video" again.
export const CAMERA_OFF_NOTICE = 'Turn your camera on, then click "Show cost on video."';

// Orchestrates a camera-overlay start as check → commit → then mutate. Extracted from the React
// callback so it is unit-testable in the node/vitest setup (no jsdom). NEVER throws; returns
// 'started' | 'blocked-camera-off' | 'error'. The state-mutating deps (startSession,
// seedBaseline, post) run ONLY on the success path, so a refused start leaves the session,
// overlay, and auto-recover baseline untouched — there is no partial state to roll back.
export async function attemptStartOverlay({ adapter, status, startSession, seedBaseline, post, log }) {
  // Diagnostic checkpoint: if 'begin' logs but 'context-started' never does, the panel tried to
  // start the camera context but it was refused or threw.
  log('start-overlay:begin', { status });

  // Probe the camera FIRST. An unavailable or throwing getVideoState is UNKNOWN, not off — so we
  // proceed and a flaky probe never blocks a legitimate start. Only an explicit false blocks.
  let videoOn;
  try {
    videoOn = await adapter?.getVideoState?.();
  } catch {
    videoOn = undefined;
  }
  if (videoOn === false) {
    log('start-overlay:blocked-camera-off', { status });
    return 'blocked-camera-off';
  }

  // Commit boundary: the SDK call. Nothing above mutated app state, so a rejection here (camera
  // turned off during the race, or any other failure) needs no rollback.
  try {
    await adapter?.startCameraOverlay?.();
  } catch (err) {
    log('start-overlay:error', { status, error: err?.message ?? String(err) });
    return 'error';
  }

  // Success only past here — now the mutations are safe.
  log('start-overlay:context-started');
  if (status === 'idle') startSession(); // auto-start the session on first show (idle only)
  seedBaseline();
  post();
  log('start-overlay:posted');
  return 'started';
}
