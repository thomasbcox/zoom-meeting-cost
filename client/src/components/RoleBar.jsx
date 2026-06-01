import { useState } from 'react';

// Prototype harness bar. In real Zoom, role/room/identity come from the SDK and
// participants come from Zoom events — none of this UI would be shown. It exists
// so you can open multiple browser tabs and act as presenter + viewers against
// the same room to see the WebSocket broadcast working.

export default function RoleBar({
  role,
  setRole,
  roomId,
  setRoomId,
  myName,
  setMyName,
  connStatus,
  adapter,
  participants,
}) {
  const [newName, setNewName] = useState('');
  const isMock = adapter?.isMock;

  const addParticipant = () => {
    if (adapter?.addParticipant) adapter.addParticipant(newName);
    setNewName('');
  };

  return (
    <div className="rolebar">
      <div className="rolebar-row">
        <span className="proto-tag">PROTOTYPE</span>

        <label className="rb-field">
          Role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="presenter">Presenter</option>
            <option value="viewer">Viewer</option>
          </select>
        </label>

        <label className="rb-field">
          Meeting / room id
          <input value={roomId} onChange={(e) => setRoomId(e.target.value)} />
        </label>

        <label className="rb-field">
          Your name
          <input value={myName} onChange={(e) => setMyName(e.target.value)} />
        </label>

        <span className={`conn conn-${connStatus}`} title="WebSocket status">
          {connStatus}
        </span>
      </div>

      {isMock && role === 'presenter' && (
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
