// In-memory store of shared meeting-cost state, keyed by room id (Zoom meeting
// UUID in production, or a mock meeting id in the prototype).
//
// The room only ever holds the *resolved, sanitized* shared state that the
// presenter chooses to broadcast. The presenter's private rate table, aliases,
// and overrides never reach this module.

/**
 * @typedef {Object} Room
 * @property {Set<import('ws').WebSocket>} clients
 * @property {object|null} state  Last published shared state
 */

/** @type {Map<string, Room>} */
const rooms = new Map();

function getRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = { clients: new Set(), state: null };
    rooms.set(roomId, room);
  }
  return room;
}

export function joinRoom(roomId, client) {
  const room = getRoom(roomId);
  room.clients.add(client);
  return room;
}

export function leaveRoom(roomId, client) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.clients.delete(client);
  // Garbage-collect empty rooms so memory doesn't grow without bound.
  if (room.clients.size === 0) rooms.delete(roomId);
}

/**
 * Store the latest published state for a room and broadcast it to every
 * connected client (including the publisher, which simply ignores its echo).
 */
export function publishState(roomId, state) {
  const room = getRoom(roomId);
  room.state = state;
  broadcast(room, { type: 'state', state });
}

export function getState(roomId) {
  return rooms.get(roomId)?.state ?? null;
}

function broadcast(room, message) {
  const payload = JSON.stringify(message);
  for (const client of room.clients) {
    if (client.readyState === 1 /* OPEN */) {
      try {
        client.send(payload);
      } catch {
        // Ignore individual send failures; the close handler cleans up.
      }
    }
  }
}

export function roomStats() {
  return [...rooms.entries()].map(([id, r]) => ({
    roomId: id,
    clients: r.clients.size,
    hasState: !!r.state,
    status: r.state?.status ?? null,
  }));
}
