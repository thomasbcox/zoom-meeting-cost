import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createApp, CSP } from '../src/app.js';

// Regression guard for the Zoom OWASP secure-header requirement. If any of these
// headers stops being sent, the Zoom client renders a blank white screen — so we
// fail the build instead.
//
// ORDER-INDEPENDENT BY CONSTRUCTION (no client build needed): `securityHeaders` is the
// first global middleware, so every response carries the headers. The presence check uses
// GET / (truthy even on the finalhandler 404 when client/dist is absent), and the CSP-CONTENT
// check uses GET /api/health — a route that always returns 200 and never reaches the SPA
// fallback, so res.sendFile can't error and finalhandler can't overwrite the CSP with
// `default-src 'none'`. The exported CSP constant is also asserted directly.

function startApp() {
  const app = createApp();
  const server = app.listen(0);
  return new Promise((resolve) => {
    server.once('listening', () => resolve(server));
  });
}

test('GET / carries the four required OWASP secure headers', async () => {
  const server = await startApp();
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.ok(
      res.headers.get('strict-transport-security'),
      'Strict-Transport-Security missing'
    );
    assert.equal(
      res.headers.get('x-content-type-options'),
      'nosniff',
      'X-Content-Type-Options must be nosniff'
    );
    assert.ok(res.headers.get('referrer-policy'), 'Referrer-Policy missing');
    assert.ok(
      res.headers.get('content-security-policy'),
      'Content-Security-Policy missing'
    );
  } finally {
    server.close();
  }
});

test('CSP allows the app bundle and Zoom embedding, with connect-src pinned', async () => {
  const server = await startApp();
  const { port } = server.address();
  try {
    // /api/health always returns 200 and never reaches the SPA fallback, so the CSP from
    // securityHeaders is delivered intact regardless of whether client/dist was built.
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp.includes("default-src 'self'"), "default-src 'self'");
    assert.ok(csp.includes("script-src 'self'"), "script-src 'self'");
    // connect-src is 'self' ONLY — the Zoom wildcards were retired. Nothing cross-origin
    // remains (the one call, /api/log, is same-origin; the SDK uses postMessage, which
    // connect-src does not govern). Assert the directive is exactly 'self', with no Zoom
    // host, no dead wss:, and no bare any-host https:.
    assert.ok(/connect-src 'self'(;|$)/.test(csp), "connect-src must be exactly 'self'");
    assert.ok(!/connect-src[^;]*zoom\./.test(csp), 'connect-src must not list Zoom hosts');
    assert.ok(!/connect-src[^;]*\bwss:/.test(csp), 'connect-src must not allow wss: (dead)');
    assert.ok(
      !/connect-src[^;]*\shttps:(?![/])/.test(csp),
      'connect-src must not allow a bare https: (any host)'
    );
    // Hardening denies added alongside the connect-src pin (the app has no plugins,
    // iframes, or workers), plus upgrade-insecure-requests as defense-in-depth.
    assert.ok(csp.includes("object-src 'none'"), "object-src 'none'");
    assert.ok(csp.includes("frame-src 'none'"), "frame-src 'none'");
    assert.ok(csp.includes("worker-src 'none'"), "worker-src 'none'");
    assert.ok(csp.includes('upgrade-insecure-requests'), 'upgrade-insecure-requests');
    // frame-ancestors keeps its Zoom wildcards ON PURPOSE (Zoom documents no exact
    // embedding origins; tighter risks a blank screen). zoom.us now appears here only.
    assert.ok(csp.includes('frame-ancestors'), 'frame-ancestors (Zoom embed)');
    assert.ok(csp.includes('zoom.us'), 'Zoom domain in frame-ancestors');
  } finally {
    server.close();
  }
});

test('exported CSP string is non-empty and directive-joined', () => {
  assert.ok(CSP.length > 0);
  assert.ok(CSP.includes(';'), 'CSP should be a directive list');
});
