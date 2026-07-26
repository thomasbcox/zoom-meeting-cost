import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';

// Global rate limiter (CodeQL js/missing-rate-limiting, app.js static catch-all). The ceiling is
// injectable via createApp({ rateLimitOptions }) exactly like the deauth router's own limiter, so
// tests can drive it with a tiny bucket instead of firing hundreds of requests.

function startApp(opts = {}) {
  const app = createApp(opts);
  const server = app.listen(0);
  return new Promise((resolve) => server.once('listening', () => resolve(server)));
}

// Fire n GETs at one path, in series (deterministic bucket accounting), returning the statuses.
async function fireSeries(port, path, n) {
  const statuses = [];
  for (let i = 0; i < n; i++) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    statuses.push(res.status);
  }
  return statuses;
}

test('the file-serving surface is rate-limited: the (limit+1)th request gets 429', async () => {
  const server = await startApp({ rateLimitOptions: { windowMs: 60_000, limit: 3 } });
  const { port } = server.address();

  let statuses;
  try {
    // Hit the static catch-all ('/'), the exact route CodeQL flagged. Every non-skipped request
    // counts, whatever its final status, so the 4th trips the ceiling.
    statuses = await fireSeries(port, '/', 4);
  } finally {
    server.close();
  }

  assert.ok(
    statuses.slice(0, 3).every((s) => s !== 429),
    `first 3 requests must pass the limiter, got ${statuses}`
  );
  assert.equal(statuses[3], 429, `4th request must be rate-limited, got ${statuses}`);
});

test('/api/health is exempt so the platform health probe is never throttled', async () => {
  const server = await startApp({ rateLimitOptions: { windowMs: 60_000, limit: 2 } });
  const { port } = server.address();

  let statuses;
  try {
    // Far more health checks than the ceiling — none may be limited.
    statuses = await fireSeries(port, '/api/health', 6);
  } finally {
    server.close();
  }

  assert.ok(
    statuses.every((s) => s === 200),
    `every health check must return 200, got ${statuses}`
  );
});

test('a default-ceiling app serves an ordinary burst without limiting', async () => {
  const server = await startApp();
  const { port } = server.address();

  let statuses;
  try {
    statuses = await fireSeries(port, '/api/version', 8);
  } finally {
    server.close();
  }

  assert.ok(
    statuses.every((s) => s !== 429),
    `no request should be limited under the default ceiling, got ${statuses}`
  );
});
