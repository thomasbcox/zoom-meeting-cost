import { createApp } from './app.js';
import { resolvePort } from './port.js';
import { zoomConfigured } from './zoom/oauth.js';

// API_PORT takes precedence so dev launchers that inject a generic PORT (e.g.
// the Claude preview panel sets PORT to the web port) can't accidentally steer
// the API server onto the Vite port. In production (single Express server, e.g.
// Railway) we fall back to the platform-provided PORT.
const PORT = resolvePort(process.env);

const app = createApp();
const server = app.listen(PORT, () => {
  console.log(`[meeting-cost] server on http://localhost:${PORT}`);
  console.log(`[meeting-cost] zoom oauth configured: ${zoomConfigured}`);
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
