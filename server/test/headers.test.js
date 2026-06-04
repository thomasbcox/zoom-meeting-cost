import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createApp, CSP } from '../src/app.js';

// Regression guard for the Zoom OWASP secure-header requirement. If any of these
// headers stops being sent, the Zoom client renders a blank white screen — so we
// fail the build instead. Asserts header PRESENCE on GET / regardless of whether
// a client build exists (the headers run as the first middleware, before static
// and the SPA fallback), so this passes even when client/dist is absent.

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

test('CSP allows the app bundle, websocket/api, and Zoom embedding', async () => {
  const server = await startApp();
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp.includes("default-src 'self'"), "default-src 'self'");
    assert.ok(csp.includes("script-src 'self'"), "script-src 'self'");
    assert.ok(csp.includes('connect-src'), 'connect-src (websocket/api)');
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
