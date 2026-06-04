import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import RoleBar from './components/RoleBar.jsx';
import SharedCostScreen from './components/SharedCostScreen.jsx';
import OverlayApp from './components/OverlayApp.jsx';
import PresenterControls from './components/PresenterControls.jsx';

import { usePresenterStore } from './state/usePresenterStore.js';
import { resolveAll } from './lib/matching.js';
import { computeTotals } from './lib/cost.js';
import { buildOverlayState } from './lib/overlayState.js';

// The in-meeting SIDE PANEL: the presenter privately configures rates, sees a
// live readout, and starts/stops the camera overlay. The overlay itself renders
// in the camera rendering context (see OverlayApp via Root) and receives state
// pushed over the adapter's message bridge — there is no viewer webview and no
// shared-state broadcast for the display.

export default function App({ adapter, initialParticipants = [] }) {
  const [myName, setMyName] = useState('Thomas Cox');

  // --- Participants (seeded by Root.init, kept live via adapter events) -----
  const [participants, setParticipants] = useState(initialParticipants);
  useEffect(() => {
    if (!adapter) return;
    const unsub = adapter.onParticipantsChange((list) => setParticipants(list));
    return () => unsub && unsub();
  }, [adapter]);

  // --- Presenter private config --------------------------------------------
  const { config, overrides, actions } = usePresenterStore();

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
  const totals = useMemo(() => computeTotals(resolved), [resolved]);

  // --- Camera overlay control ----------------------------------------------
  const [overlayOn, setOverlayOn] = useState(false);
  const overlayOnRef = useRef(false);
  overlayOnRef.current = overlayOn;

  // Latest values for the interval/poster without re-arming effects.
  const liveRef = useRef({});
  liveRef.current = { totals, status: session.status };

  const postOverlay = useCallback(() => {
    if (!adapter?.postMessage) return;
    const { totals: t, status } = liveRef.current;
    adapter.postMessage(
      buildOverlayState({
        status,
        totalCost: totalRef.current,
        totals: t,
        elapsedSeconds: elapsedRef.current,
        updatedAt: Date.now(),
      })
    );
  }, [adapter]);

  const startOverlay = useCallback(async () => {
    if (liveRef.current.status === 'idle') sessionActions.start();
    await adapter?.startCameraOverlay?.();
    setOverlayOn(true);
    postOverlay(); // push current numbers immediately
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
          {session.status === 'idle' ? (
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
          />
        </aside>
      </main>
    </div>
  );
}
