import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { createOAuthRouter, zoomConfigured } from './zoom/oauth.js';
import { createDeauthRouter } from './zoom/deauth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// When this server process booted — reported by /api/version so a stale/long-running
// deploy is visible. (env + commit come from Railway's runtime vars; see build-env-stamp.)
const STARTED_AT = new Date().toISOString();

// Zoom REQUIRES these OWASP secure headers on HTML responses. Without them the
// Zoom client refuses to render the app — a blank white screen, with a
// "Missing OWASP Secure Headers" error in the Zoom client console. We set them
// on EVERY response so nothing the client fetches is ever missing them.
//
// The CSP must permit the app's own bundle ('self'), inline styles (React style
// props / Vite), the API ('self' — same-origin /api), images/fonts, and embedding
// inside the Zoom client.
//
// connect-src is 'self' only. The client's entire cross-origin network surface is a
// single same-origin call, fetch('/api/log') (client/src/lib/postLog.js) — no other
// fetch, sendBeacon, EventSource, or WebSocket anywhere in the client. The bundled
// @zoom/appssdk talks to the Zoom host via postMessage, which connect-src does NOT
// govern, so no Zoom host belongs here. The old Zoom wildcards were retired with the
// shared-state WebSocket (`wss:`) they once served; this matches Zoom's own
// recommended app CSP (connect-src 'self').
//
// object-src / frame-src / worker-src are 'none': the app embeds no plugins, no
// iframes, and spawns no web workers — pinning them to 'none' is stricter than the
// default-src 'self' fallback and closes those injection vectors outright.
// upgrade-insecure-requests is defense-in-depth (every subresource is already 'self').
//
// frame-ancestors keeps the Zoom wildcards ON PURPOSE. Zoom documents no exact
// embedding origins, its recommended CSP omits frame-ancestors entirely, and the
// embedding parent differs across desktop / web-PWA / mobile clients — so narrowing
// to guessed origins risks a blank screen in some surface. The Zoom-owned wildcards
// are already tighter than Zoom's own guidance; leave them.
// Ref: https://developers.zoom.us/docs/zoom-apps/security/owasp/
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self' https://*.zoom.us https://*.zoom.com",
  "upgrade-insecure-requests",
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
  // Injected into the deauthorization router (secretToken / now). Empty in production,
  // where the router reads env + Date.now itself.
  deauth = {},
} = {}) {
  const app = express();

  // OWASP secure headers first, so every response (HTML, assets, 404s) carries
  // them — this is what unblocks rendering inside the Zoom client.
  app.use(securityHeaders);

  // Request logging runs BEFORE body parsing (it needs only method + path), so it also covers the
  // deauthorization webhook mounted below — which sits ahead of the global JSON parser.
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

  // --- Zoom deauthorization webhook (mandatory for a published app) ---------
  // Mounted BEFORE the global JSON parser on purpose: its route-local chain (rate limiter →
  // raw-body capture → signature verify) must be the OUTERMOST gate, so malformed/oversized
  // floods are counted and capped rather than rejected by a parser that runs first. It handles
  // only POST /auth/deauthorize and terminates every request, so nothing here falls through to
  // the JSON parser or the OAuth router below.
  app.use('/auth', createDeauthRouter(deauth));

  // Bounded JSON body for everything else — cap it so a POST (e.g. /api/log) can't be huge.
  app.use(express.json({ limit: '100kb' }));

  // --- Health / debug -------------------------------------------------------
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, zoomConfigured });
  });

  // Build/version stamp — which environment + git commit this server is running, so you
  // can tell dev from prod from a browser without opening Zoom (see build-env-stamp.md).
  // Public + non-sensitive (no identity gate): env name, deployed commit, boot time.
  // Railway injects RAILWAY_ENVIRONMENT_NAME + RAILWAY_GIT_COMMIT_SHA at runtime; a local
  // run (neither set) reports 'local'/'unknown'.
  app.get('/api/version', (_req, res) => {
    res.json({
      env: process.env.RAILWAY_ENVIRONMENT_NAME || 'local',
      commit: process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown',
      startedAt: STARTED_AT,
    });
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
