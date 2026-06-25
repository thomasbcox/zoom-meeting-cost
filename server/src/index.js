// Load a local .env (dev) before anything reads process.env. Must be first.
import './loadEnv.js';

import { createApp } from './app.js';
import { resolvePort } from './port.js';
import { zoomConfigured, zoomCredentialFingerprint } from './zoom/oauth.js';

// API_PORT takes precedence so dev launchers that inject a generic PORT (e.g.
// the Claude preview panel sets PORT to the web port) can't accidentally steer
// the API server onto the Vite port. In production (single Express server, e.g.
// Railway) we fall back to the platform-provided PORT.
const PORT = resolvePort(process.env);

const app = createApp();
const server = app.listen(PORT, () => {
  console.log(`[meeting-cost] server on http://localhost:${PORT}`);
  console.log(`[meeting-cost] zoom oauth configured: ${zoomConfigured}`);
  console.log(`[meeting-cost] zoom creds ${zoomCredentialFingerprint()}`);
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

// Graceful shutdown. On a redeploy/stop, the platform (e.g. Railway) sends SIGTERM. Without
// a handler, Node is killed by the signal and exits non-zero (143) — npm then logs
// `signal SIGTERM` and the platform reports a false "crash". Instead, stop accepting new
// connections, let in-flight requests finish, and exit 0. A force-exit fallback guarantees we
// still exit cleanly if close() hangs, well before the platform's force-kill window.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[meeting-cost] received ${signal}, shutting down`);
  const force = setTimeout(() => process.exit(0), 10_000);
  force.unref(); // don't keep the event loop alive just for the timer
  server.close(() => {
    clearTimeout(force);
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
