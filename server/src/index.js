import http from 'node:http';
import { WebSocketServer } from 'ws';

import { createApp } from './app.js';
import { joinRoom, leaveRoom, publishState, getState } from './rooms.js';
import { zoomConfigured } from './zoom/oauth.js';

// API_PORT takes precedence so dev launchers that inject a generic PORT (e.g.
// the Claude preview panel sets PORT to the web port) can't accidentally steer
// the API server onto the Vite port. In production (single Express server) we
// fall back to the conventional PORT.
const PORT = process.env.API_PORT || process.env.PORT || 8787;

const app = createApp();
const server = http.createServer(app);

// --- WebSocket: shared meeting-cost state -----------------------------------
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.roomId = null;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'join': {
        if (typeof msg.roomId !== 'string' || !msg.roomId) return;
        ws.roomId = msg.roomId;
        ws.role = msg.role === 'presenter' ? 'presenter' : 'viewer';
        joinRoom(ws.roomId, ws);
        // Send current snapshot immediately so a late joiner isn't blank.
        const current = getState(ws.roomId);
        if (current) ws.send(JSON.stringify({ type: 'state', state: current }));
        break;
      }
      case 'publish': {
        // Only meaningful from the presenter. We don't enforce identity in the
        // prototype, but the client only ever publishes from presenter mode.
        if (!ws.roomId || ws.roomId !== msg.roomId) return;
        if (msg.state && typeof msg.state === 'object') {
          publishState(ws.roomId, msg.state);
        }
        break;
      }
      default:
        break;
    }
  });

  ws.on('close', () => {
    if (ws.roomId) leaveRoom(ws.roomId, ws);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\n[meeting-cost] Port ${PORT} is already in use.\n` +
        `Another instance is probably still running. Free it with:\n` +
        `  lsof -nP -iTCP:${PORT} -sTCP:LISTEN   # find the PID\n` +
        `  pkill -f "src/index.js"               # or kill it\n` +
        `Or run on a different port:  PORT=8788 npm run dev\n`
    );
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`[meeting-cost] server on http://localhost:${PORT}`);
  console.log(`[meeting-cost] zoom oauth configured: ${zoomConfigured}`);
});
