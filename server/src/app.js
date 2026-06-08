import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { createOAuthRouter, zoomConfigured } from './zoom/oauth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Zoom REQUIRES these OWASP secure headers on HTML responses. Without them the
// Zoom client refuses to render the app — a blank white screen, with a
// "Missing OWASP Secure Headers" error in the Zoom client console. We set them
// on EVERY response so nothing the client fetches is ever missing them.
//
// The CSP must permit the app's own bundle ('self'), inline styles (React style
// props / Vite), the WebSocket + API (wss:/https:), images/fonts, and embedding
// inside the Zoom client.
// Ref: https://developers.zoom.us/docs/zoom-apps/security/owasp/
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' wss: https:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self' https://*.zoom.us https://*.zoom.com",
].join('; ');

// Routine, high-volume paths that would otherwise flood the request log: the
// periodic Railway health check, the client log sink itself, the favicon, and all
// static assets. Everything else (navigations, /auth, other /api) still logs.
export function isRoutineRequest(reqPath) {
  return (
    reqPath === '/api/health' ||
    reqPath === '/api/log' ||
    reqPath === '/favicon.ico' ||
    reqPath.startsWith('/assets/')
  );
}

export function securityHeaders(_req, res, next) {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', CSP);
  // Cache-busting so Zoom never serves a stale bundle during active dev.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
}

/**
 * Build the Express app (no listening — that lives in index.js).
 * Exported so tests can exercise routes/headers without starting a server.
 */
export function createApp({
  clientDist = path.resolve(__dirname, '../../client/dist'),
} = {}) {
  const app = express();

  // OWASP secure headers first, so every response (HTML, assets, 404s) carries
  // them — this is what unblocks rendering inside the Zoom client.
  app.use(securityHeaders);

  app.use(express.json());

  app.use((req, _res, next) => {
    // Log the path only — never req.url. The Zoom OAuth redirect arrives as
    // /auth/callback?code=<single-use authorization code>, and req.url would
    // leak that code (and any other query params) into the logs.
    // Skip routine, high-volume traffic (the periodic health check, the client
    // log sink itself, the favicon, and static assets) so the log stays signal.
    if (!isRoutineRequest(req.path)) {
      console.log(`[server] ${req.method} ${req.path}`);
    }
    next();
  });

  // --- Health / debug -------------------------------------------------------
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, zoomConfigured });
  });

  app.post('/api/log', (req, res) => {
    // Route by kind: genuine client errors (reportClientError / ErrorBoundary use
    // kind 'client-error') go to stderr so they stand out; benign diagnostics
    // (lifecycle / zoom-overlay / zoom-diagnostics) go to stdout. Compact, single
    // line — pretty-printing turned each event into a screenful in Railway.
    const isError = req.body?.kind === 'client-error';
    const line = `[client-log] ${JSON.stringify(req.body)}`;
    if (isError) console.error(line);
    else console.log(line);
    res.sendStatus(204);
  });

  // --- Zoom OAuth (scaffold; inert until configured) ------------------------
  app.use('/auth', createOAuthRouter());

  // --- Serve the built client ----------------------------------------------
  app.use(express.static(clientDist, { etag: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
      return next();
    }
    res.sendFile(path.join(clientDist, 'index.html'), (err) => {
      if (err) next();
    });
  });

  return app;
}
