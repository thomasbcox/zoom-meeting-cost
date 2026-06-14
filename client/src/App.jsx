import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import RoleBar from './components/RoleBar.jsx';
import SharedCostScreen from './components/SharedCostScreen.jsx';
import OverlayApp from './components/OverlayApp.jsx';
import PresenterControls from './components/PresenterControls.jsx';

import { usePresenterStore } from './state/usePresenterStore.js';
import { resolveAll } from './lib/matching.js';
import { selectActiveTotals } from './lib/cost.js';
import { buildOverlayState } from './lib/overlayState.js';
import { quantizeForDisplay } from './lib/displayCadence.js';
import { seedPresenterName } from './lib/presenterName.js';
import { logLifecycle } from './lib/lifecycleLog.js';
import { createVideoRecovery } from './lib/overlayRecover.js';

// The in-meeting SIDE PANEL: the presenter privately configures rates, sees a
// live readout, and starts/stops the camera overlay. The overlay itself renders
// in the camera rendering context (see OverlayApp via Root) and receives state
// pushed over the adapter's message bridge — there is no viewer webview and no
// shared-state broadcast for the display.

export default function App({ adapter, self, initialParticipants = [] }) {
  // Seed from the real Zoom identity (self.displayName) when available; the
  // presenter can still edit it. Falls back to 'Presenter' outside Zoom.
  const [myName, setMyName] = useState(() => seedPresenterName(self));

  // --- Participants (seeded by Root.init, kept live via adapter events) -----
  const [participants, setParticipants] = useState(initialParticipants);
  // Whether the adapter could actually read the participant list. False means a
  // failed getMeetingParticipants() (needs host/co-host + scope) — show a notice
  // instead of a misleading $0 meeting.
  const [participantsAvailable, setParticipantsAvailable] = useState(
    () => adapter?.participantsAvailable?.() ?? true
  );
  useEffect(() => {
    if (!adapter) return;
    setParticipantsAvailable(adapter.participantsAvailable?.() ?? true);
    const unsub = adapter.onParticipantsChange((list) => {
      setParticipants(list);
      setParticipantsAvailable(adapter.participantsAvailable?.() ?? true);
    });
    return () => unsub && unsub();
  }, [adapter]);

  // --- Presenter private config --------------------------------------------
  const { config, overrides, actions } = usePresenterStore(adapter);

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

  // Resolve participants -> rates with the presenter's private config.
  const resolved = useMemo(
    () => resolveAll(participants, { ...config, overrides }),
    [participants, config, overrides]
  );
  const totals = useMemo(
    () =>
      selectActiveTotals({
        costModel: config.costModel,
        resolved,
        simpleAverageRate: config.simpleAverageRate,
        simpleMultiplier: config.simpleMultiplier,
        simpleUserCount: config.simpleUserCount,
        liveCount: participants.length,
      }),
    [
      config.costModel,
      config.simpleAverageRate,
      config.simpleMultiplier,
      config.simpleUserCount,
      resolved,
      participants.length,
    ]
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

  // Diagnostic: confirm this (inMeeting panel) instance actually mounted as the sender.
  useEffect(() => {
    logLifecycle('panel-mounted');
  }, []);

  const startOverlay = useCallback(async () => {
    // Diagnostic checkpoints: if 'begin' logs but 'context-started' does not, the panel
    // instance did not survive runRenderingContext (the sender died); if both log but no
    // postMessage follows, the bug is downstream of the send call.
    logLifecycle('start-overlay:begin', { status: liveRef.current.status });
    // Showing the overlay implicitly starts a session ONLY from idle (the original,
    // primary start path). From `ended` it deliberately does NOT restart — it shows
    // the frozen final total on the camera feed; the explicit "Start new session" /
    // "Resume" controls own restarting. So the overlay button is visibility; lifecycle
    // is the session controls. (session-restart-controls, 2026-06-09.)
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

  // Push a fresh snapshot whenever the overlay turns on or the session status
  // changes (so a paused/ended overlay shows the frozen number, not stale data).
  useEffect(() => {
    if (overlayOn) postOverlay();
  }, [overlayOn, session.status, postOverlay]);

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

  // --- Viewer's-eye preview (aggregate only, quantized to the chosen cadence) -
  // Exactly what participants see on the camera overlay: total, $/min, stepped
  // clock, head-count — NO names or per-person rates (reuses buildOverlayState's
  // sanitized payload). Re-derived each render (the 1 s tick) but quantization
  // holds it steady between N-second steps. updatedAt is irrelevant here (no
  // extrapolation — the preview shows the already-quantized snapshot).
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

  // --- Presenter's own live readout (private; full detail) ------------------
  const readoutState = useMemo(
    () => ({
      status: session.status,
      presenterName: myName,
      elapsedSeconds: elapsedRef.current,
      totalCost: totalRef.current,
      totals,
      participants: resolved.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        rate: p.rate,
        source: p.source,
      })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [myName, session.status, totals, resolved, elapsedRef.current, totalRef.current]
  );

  return (
    <div className="app">
      <RoleBar
        myName={myName}
        setMyName={setMyName}
        adapter={adapter}
        participants={participants}
      />

      <header className="app-header">
        <h1>Meeting Cost</h1>
        <p className="muted small">
          Private to you. Start the overlay to show the live cost on your video.
        </p>
      </header>

      <main className="layout presenter">
        <div className="screen-col">
          {!participantsAvailable ? (
            <div className="cost-screen empty" role="status">
              <p>
                <strong>Participants unavailable.</strong>
              </p>
              <p className="muted">
                Meeting Cost needs host or co-host access to read the participant
                list, so it can&rsquo;t calculate a cost right now. Ask the host to
                make you a co-host, then reopen this panel.
              </p>
            </div>
          ) : session.status === 'idle' ? (
            <div className="cost-screen empty">
              <p className="muted">
                Configure rates, then <strong>Show cost on video</strong> to put the
                live meter on your camera feed for everyone to see.
              </p>
            </div>
          ) : (
            <SharedCostScreen state={readoutState} />
          )}

          {adapter?.isMock && (
            <div className="sim-camera" aria-label="Simulated camera preview">
              <span className="sim-camera-tag">Camera preview (simulated)</span>
              {/* Only mount the meter while the overlay is on, so the frame
                  empties on "Hide from video" — mirroring closeRenderingContext
                  removing it from the real camera feed. */}
              {overlayOn && <OverlayApp adapter={adapter} transparentBody={false} />}
            </div>
          )}
        </div>

        <aside className="controls-col">
          <PresenterControls
            config={config}
            overrides={overrides}
            actions={actions}
            session={session}
            sessionActions={sessionActions}
            overlayOn={overlayOn}
            startOverlay={startOverlay}
            stopOverlay={stopOverlay}
            resolved={resolved}
            previewDisplay={previewDisplay}
          />
        </aside>
      </main>
    </div>
  );
}
