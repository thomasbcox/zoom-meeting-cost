import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';

// Regression guard for the OAuth-code log leak: the request logger must log the
// path only, never req.url. The Zoom OAuth redirect arrives as
// /auth/callback?code=<single-use authorization code>, and logging req.url would
// write that code into the server logs.

function startApp() {
  const app = createApp();
  const server = app.listen(0);
  return new Promise((resolve) => {
    server.once('listening', () => resolve(server));
  });
}

test('request logger does not log OAuth code (path only, no query string)', async () => {
  const server = await startApp();
  const { port } = server.address();

  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));

  try {
    await fetch(`http://127.0.0.1:${port}/auth/callback?code=SECRET123`);
  } finally {
    console.log = original;
    server.close();
  }

  const logged = lines.join('\n');
  assert.ok(
    logged.includes('/auth/callback'),
    'expected the request path to be logged'
  );
  assert.ok(
    !logged.includes('SECRET123'),
    'authorization code must never be logged'
  );
  assert.ok(!logged.includes('code='), 'query string must not be logged');
});

test('request logger skips routine traffic (health, assets) but logs navigations', async () => {
  const server = await startApp();
  const { port } = server.address();

  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));

  try {
    await fetch(`http://127.0.0.1:${port}/api/health`);
    await fetch(`http://127.0.0.1:${port}/assets/index-abc.js`);
    await fetch(`http://127.0.0.1:${port}/favicon.ico`);
    await fetch(`http://127.0.0.1:${port}/`);
  } finally {
    console.log = original;
    server.close();
  }

  const reqLines = lines.filter((l) => l.startsWith('[server] '));
  assert.ok(
    !reqLines.some((l) => l.includes('/api/health')),
    'health check must not be logged'
  );
  assert.ok(
    !reqLines.some((l) => l.includes('/assets/')),
    'static assets must not be logged'
  );
  assert.ok(
    !reqLines.some((l) => l.includes('/favicon.ico')),
    'favicon must not be logged'
  );
  assert.ok(
    reqLines.some((l) => l.includes('GET /')),
    'navigations (/) should still be logged'
  );
});
