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
// Optional headers (e.g. X-Real-IP) are sent on every request.
async function fireSeries(port, path, n, headers = {}) {
  const statuses = [];
  for (let i = 0; i < n; i++) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
    statuses.push(res.status);
  }
  return statuses;
}

test('the file-serving surface is rate-limited: the (limit+1)th request gets 429', async () => {
  const server = await startApp({ rateLimitOptions: { windowMs: 60_000, limit: 3 } });
  const { port } = server.address();

  let statuses;
  try {
    // Hit the static catch-all ('/'), the exact route CodeQL flagged, with NO X-Real-IP so the
    // key falls back to the socket address (the local/direct-hit path). Every non-skipped request
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

// The branch-owned part of the limiter is clientIpKey: behind Railway's proxy every request
// arrives on the same socket, so the bucket MUST be keyed on the forwarded X-Real-IP, not the
// socket address — otherwise all users collapse into one shared bucket. These two tests exercise
// that policy directly (the counting mechanics above only prove the dependency runs).
test('the limiter keys on X-Real-IP: one client is throttled while another keeps its own bucket', async () => {
  const server = await startApp({ rateLimitOptions: { windowMs: 60_000, limit: 2 } });
  const { port } = server.address();

  let a, b;
  try {
    // All requests share one socket (127.0.0.1); only the X-Real-IP header distinguishes clients.
    a = await fireSeries(port, '/', 3, { 'X-Real-IP': '203.0.113.7' }); // exhaust client A's bucket
    b = await fireSeries(port, '/', 1, { 'X-Real-IP': '198.51.100.42' }); // a different client
  } finally {
    server.close();
  }

  assert.ok(a.slice(0, 2).every((s) => s !== 429), `A's first 2 must pass, got ${a}`);
  assert.equal(a[2], 429, `A's 3rd request (same X-Real-IP) must be throttled, got ${a}`);
  assert.notEqual(
    b[0],
    429,
    `a different X-Real-IP must keep its own bucket (no cross-client starvation), got ${b}`
  );
});

test('IPv6 clients are keyed by /56 block: same-block addresses share a bucket', async () => {
  const server = await startApp({ rateLimitOptions: { windowMs: 60_000, limit: 2 } });
  const { port } = server.address();

  let statuses;
  try {
    // 2001:db8::1 and 2001:db8::2 normalise to the same /56 (ipKeyGenerator), so a client cannot
    // slip the limit by rotating addresses inside its own subnet.
    const first = await fireSeries(port, '/', 2, { 'X-Real-IP': '2001:db8::1' });
    const sameBlock = await fireSeries(port, '/', 1, { 'X-Real-IP': '2001:db8::2' });
    statuses = [...first, ...sameBlock];
  } finally {
    server.close();
  }

  assert.ok(statuses.slice(0, 2).every((s) => s !== 429), `first two (same /56) must pass, got ${statuses}`);
  assert.equal(statuses[2], 429, `a same-/56 address must share the bucket and be throttled, got ${statuses}`);
});
