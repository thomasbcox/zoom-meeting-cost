import { useState } from 'react';

import BuildBadge from './BuildBadge.jsx';

// Prototype harness bar. In real Zoom, identity comes from the SDK and
// participants come from Zoom events — none of this UI would be shown. It exists
// so you can simulate participants joining/leaving (mock only) and rename
// yourself while exercising the overlay locally.

export default function RoleBar({ myName, setMyName, adapter, participants }) {
  const [newName, setNewName] = useState('');
  const isMock = adapter?.isMock;

  const addParticipant = () => {
    if (adapter?.addParticipant) adapter.addParticipant(newName);
    setNewName('');
  };

  return (
    <div className="rolebar">
      <div className="rolebar-row">
        {/* Runtime mode indicator: tells the truth about whether the camera
            overlay is real (attendee-facing) or simulated. Driven by the adapter
            actually in use, not a build flag. */}
        <span className={`mode-badge ${isMock ? 'mock' : 'real'}`}>
          {isMock ? 'Mock prototype mode' : 'Real Zoom mode'}
        </span>
        {isMock && <span className="proto-tag">PROTOTYPE</span>}

        {/* Which build is running (env + short commit) — reflects the actual loaded
            bundle, so it can reveal a stale cached webview vs the live server. */}
        <BuildBadge />

        {/* Presenter name is the Zoom identity (self.displayName) in real Zoom — no editable
            field there. The input is a mock-only harness convenience for trying a different
            presenter name locally; myName is still seeded from self.displayName. */}
        {isMock && (
          <label className="rb-field">
            Your name
            <input value={myName} onChange={(e) => setMyName(e.target.value)} />
          </label>
        )}
      </div>

      {isMock && (
        <div className="rolebar-row sim">
          <span className="muted small">Simulate Zoom join/leave:</span>
          <input
            placeholder="New participant name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addParticipant()}
          />
          <button className="btn tiny" onClick={addParticipant}>
            + Join
          </button>
          <span className="sim-chips">
            {participants.map((p) => (
              <button
                key={p.id}
                className="chip"
                title="Remove (simulate leave)"
                onClick={() => adapter.removeParticipant(p.id)}
              >
                {p.displayName} ✕
              </button>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
