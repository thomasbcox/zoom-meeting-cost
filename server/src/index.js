import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';

import { joinRoom, leaveRoom, publishState, getState, roomStats } from './rooms.js';
import { createOAuthRouter, zoomConfigured } from './zoom/oauth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// API_PORT takes precedence so dev launchers that inject a generic PORT (e.g.
// the Claude preview panel sets PORT to the web port) can't accidentally steer
// the API server onto the Vite port. In production (single Express server) we
// fall back to the conventional PORT.
const PORT = process.env.API_PORT || process.env.PORT || 8787;

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[server] ${req.method} ${req.url}`);
  next();
});

// --- Health / debug ---------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, zoomConfigured, rooms: roomStats() });
});

app.post('/api/log', (req, res) => {
  console.error('[client-log]', JSON.stringify(req.body, null, 2));
  res.sendStatus(204);
});

// --- Zoom OAuth (scaffold; inert until configured) --------------------------
app.use('/auth', createOAuthRouter());

// --- Serve the built client in production -----------------------------------
const clientDist = path.resolve(__dirname, '../../client/dist');
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use(express.static(clientDist, { etag: false }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path.startsWith('/ws')) {
    return next();
  }
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

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
