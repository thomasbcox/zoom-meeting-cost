import { useEffect, useMemo, useRef, useState } from 'react';

import RoleBar from './components/RoleBar.jsx';
import SharedCostScreen from './components/SharedCostScreen.jsx';
import ViewerScreen from './components/ViewerScreen.jsx';
import PresenterControls from './components/PresenterControls.jsx';

import { usePresenterStore } from './state/usePresenterStore.js';
import { getZoomAdapter } from './zoom/zoomAdapter.js';
import { createSyncClient } from './sync/syncClient.js';
import { resolveAll } from './lib/matching.js';
import { computeTotals } from './lib/cost.js';
import { buildSharedState } from './lib/sharedState.js';

export default function App() {
  // --- Identity / role (prototype harness; from Zoom SDK in production) -----
  const [role, setRole] = useState('presenter');
  const [roomId, setRoomId] = useState('demo-meeting');
  const [myName, setMyName] = useState('Thomas Cox');

  // --- Zoom adapter + participants -----------------------------------------
  const [adapter, setAdapter] = useState(null);
  const [participants, setParticipants] = useState([]);

  useEffect(() => {
    let unsub = () => {};
    let cancelled = false;
    getZoomAdapter().then((a) => {
      if (cancelled) return;
      setAdapter(a);
      a.init().then(({ participants }) => {
        if (!cancelled) setParticipants(participants);
      });
      unsub = a.onParticipantsChange((list) => setParticipants(list));
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // --- Presenter private config --------------------------------------------
  const { config, overrides, actions } = usePresenterStore();
  const [prefs, setPrefs] = useState({ aggregateOnly: false, hideRates: false });

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

  // Keep the latest values available to the interval without re-arming it.
  const liveRef = useRef({});
  liveRef.current = { totals };

  // Tick: advance elapsed + accumulated cost while running (presenter only).
  useEffect(() => {
    if (role !== 'presenter' || session.status !== 'running') return;
    lastTickRef.current = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      const cps = liveRef.current.totals?.costPerSecond || 0;
      totalRef.current += cps * dt;
      elapsedRef.current += dt;
      forceTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [role, session.status]);

  // --- Build shared state (presenter is the source of truth) ---------------
  const presenterFullState = useMemo(() => {
    return {
      version: 1,
      roomId,
      presenterName: myName,
      status: session.status === 'idle' ? 'idle' : session.status,
      elapsedSeconds: elapsedRef.current,
      totalCost: totalRef.current,
      totals,
      prefs: { aggregateOnly: false, hideRates: false }, // presenter always sees full detail
      participants: resolved.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        rate: p.rate,
        source: p.source,
      })),
      updatedAt: Date.now(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, myName, session.status, totals, resolved, /* tick */ elapsedRef.current, totalRef.current]);

  const broadcastState = useMemo(() => {
    return buildSharedState({
      roomId,
      presenterName: myName,
      status: session.status === 'idle' ? 'idle' : session.status,
      elapsedSeconds: elapsedRef.current,
      totalCost: totalRef.current,
      resolved,
      totals,
      prefs,
      updatedAt: Date.now(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, myName, session.status, resolved, totals, prefs, elapsedRef.current, totalRef.current]);

  // --- Sync client ----------------------------------------------------------
  const [connStatus, setConnStatus] = useState('connecting');
  const [receivedState, setReceivedState] = useState(null);
  const syncRef = useRef(null);

  useEffect(() => {
    const client = createSyncClient({
      roomId,
      role,
      onState: (s) => setReceivedState(s),
      onStatus: setConnStatus,
    });
    syncRef.current = client;
    return () => client.close();
  }, [roomId, role]);

  // Presenter publishes whenever the broadcast state changes.
  useEffect(() => {
    if (role !== 'presenter') return;
    if (session.status === 'idle') return; // nothing to share until started
    syncRef.current?.publish(broadcastState);
  }, [role, session.status, broadcastState]);

  // --- Render ---------------------------------------------------------------
  const isPresenter = role === 'presenter';

  return (
    <div className="app">
      <RoleBar
        role={role}
        setRole={setRole}
        roomId={roomId}
        setRoomId={setRoomId}
        myName={myName}
        setMyName={setMyName}
        connStatus={connStatus}
        adapter={adapter}
        participants={participants}
      />

      <header className="app-header">
        <h1>Meeting Cost</h1>
        <p className="muted small">
          Live estimated cost of this meeting, shared with everyone.
        </p>
      </header>

      <main className={isPresenter ? 'layout presenter' : 'layout viewer'}>
        <div className="screen-col">
          {isPresenter ? (
            session.status === 'idle' ? (
              <div className="cost-screen empty">
                <p className="muted">
                  Start a shared session to begin counting. Viewers in room{' '}
                  <code>{roomId}</code> will see the live cost.
                </p>
              </div>
            ) : (
              <SharedCostScreen state={presenterFullState} />
            )
          ) : (
            <ViewerScreen state={receivedState} />
          )}
        </div>

        {isPresenter && (
          <aside className="controls-col">
            <PresenterControls
              config={config}
              overrides={overrides}
              actions={actions}
              session={session}
              sessionActions={sessionActions}
              prefs={prefs}
              setPrefs={setPrefs}
              resolved={resolved}
            />
          </aside>
        )}
      </main>
    </div>
  );
}
