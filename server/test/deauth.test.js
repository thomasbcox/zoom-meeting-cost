import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { createApp } from '../src/app.js';

// The Zoom deauthorization webhook (reviews/deauth-endpoint.md).
//
// There is deliberately NO compliance callback to test: Zoom's Data Compliance API is
// deprecated ("no longer required to call this endpoint"), so the endpoint's whole contract is
// verify → no-op purge → 200. See the approach review in the story file.
//
// All credential values here are SYNTHETIC, low-entropy, obviously-fake fixtures — never a
// real Zoom secret (see the repo's secret-scan guardrails).

const SECRET = 'fake-webhook-token-for-tests';

// Fixed clock, so the ±300 s replay window is deterministic.
const NOW_MS = 1_760_000_000_000;
const NOW_S = Math.floor(NOW_MS / 1000);

function sign(rawBody, timestamp, secret = SECRET) {
  return (
    'v0=' +
    createHmac('sha256', secret)
      .update('v0:')
      .update(String(timestamp))
      .update(':')
      .update(rawBody)
      .digest('hex')
  );
}

function startApp(deauth = {}) {
  const app = createApp({
    deauth: {
      secretToken: SECRET,
      now: () => NOW_MS,
      // Effectively unlimited for the functional tests (each fires only a handful of requests to
      // a fresh app); the dedicated rate-limit test below overrides this with a small ceiling.
      rateLimitOptions: { windowMs: 60_000, limit: 1000 },
      ...deauth,
    },
  });
  const server = app.listen(0);
  return new Promise((resolve) => server.once('listening', () => resolve(server)));
}

// Post an event, signing it correctly unless the caller overrides.
async function postEvent(port, body, opts = {}) {
  const { timestamp = String(NOW_S), signature, secret = SECRET, omitSig = false } = opts;
  const raw = JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json' };
  if (!omitSig) headers['x-zm-signature'] = signature ?? sign(raw, timestamp, secret);
  if (timestamp !== null) headers['x-zm-request-timestamp'] = String(timestamp);
  return fetch(`http://127.0.0.1:${port}/auth/deauthorize`, {
    method: 'POST',
    headers,
    body: raw,
  });
}

const DEAUTH_EVENT = {
  event: 'app_deauthorized',
  payload: {
    account_id: 'acct_1',
    user_id: 'user_1',
    client_id: 'fake-client-id',
    deauthorization_time: '2026-07-15T00:00:00Z',
  },
};

// --- AC1: signature gate is total and non-throwing --------------------------

test('AC1: a correctly-signed event is accepted (not 401/500)', async () => {
  const server = await startApp();
  try {
    const res = await postEvent(server.address().port, DEAUTH_EVENT);
    assert.equal(res.status, 200);
  } finally {
    server.close();
  }
});

test('AC1: a wrong signature is 401', async () => {
  const server = await startApp();
  try {
    const res = await postEvent(server.address().port, DEAUTH_EVENT, {
      secret: 'some-other-token',
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('AC1: a missing signature header is 401', async () => {
  const server = await startApp();
  try {
    const res = await postEvent(server.address().port, DEAUTH_EVENT, { omitSig: true });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('AC1: a tampered body is 401 (signature no longer matches)', async () => {
  const server = await startApp();
  try {
    const raw = JSON.stringify(DEAUTH_EVENT);
    const res = await fetch(`http://127.0.0.1:${server.address().port}/auth/deauthorize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-zm-signature': sign(raw, String(NOW_S)),
        'x-zm-request-timestamp': String(NOW_S),
      },
      // Signed the original, send something else.
      body: JSON.stringify({ ...DEAUTH_EVENT, payload: { user_id: 'attacker' } }),
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

// The BLOCKER from the design review: a malformed signature must never reach
// timingSafeEqual with a mismatched length (which throws → 500).
test('AC1: malformed signatures are 401, never 500', async () => {
  const server = await startApp();
  const malformed = [
    'v0=tooshort',
    'v0=' + 'z'.repeat(64), // right length, not hex
    'v0=' + 'A'.repeat(64), // uppercase hex — not the shape Zoom sends
    'deadbeef', // no v0= prefix
    'v0=',
    '',
  ];
  try {
    for (const signature of malformed) {
      const res = await postEvent(server.address().port, DEAUTH_EVENT, { signature });
      assert.equal(res.status, 401, `expected 401 for signature ${JSON.stringify(signature)}`);
    }
  } finally {
    server.close();
  }
});

test('AC1: a stale timestamp (older than the window) is 401', async () => {
  const server = await startApp();
  try {
    const res = await postEvent(server.address().port, DEAUTH_EVENT, {
      timestamp: String(NOW_S - 301),
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

// Also from the BLOCKER: future-dated signed requests must not pass.
test('AC1: a future-dated timestamp is 401', async () => {
  const server = await startApp();
  try {
    const res = await postEvent(server.address().port, DEAUTH_EVENT, {
      timestamp: String(NOW_S + 301),
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('AC1: a timestamp just inside the window is accepted', async () => {
  const server = await startApp();
  try {
    const res = await postEvent(server.address().port, DEAUTH_EVENT, {
      timestamp: String(NOW_S - 299),
    });
    assert.equal(res.status, 200);
  } finally {
    server.close();
  }
});

test('AC1: a non-integer timestamp is 401, never 500', async () => {
  const server = await startApp();
  try {
    for (const timestamp of ['not-a-number', '12.5', '1e3', '']) {
      const res = await postEvent(server.address().port, DEAUTH_EVENT, { timestamp });
      assert.equal(res.status, 401, `expected 401 for timestamp ${JSON.stringify(timestamp)}`);
    }
  } finally {
    server.close();
  }
});

// --- AC2: url_validation handshake ------------------------------------------

test('AC2: url_validation returns the plainToken + its HMAC', async () => {
  const server = await startApp();
  try {
    const plainToken = 'abc123plain';
    const res = await postEvent(server.address().port, {
      event: 'endpoint.url_validation',
      payload: { plainToken },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.plainToken, plainToken);
    assert.equal(
      body.encryptedToken,
      createHmac('sha256', SECRET).update(plainToken).digest('hex'),
      'encryptedToken must be HMAC-SHA256(secretToken, plainToken)'
    );
  } finally {
    server.close();
  }
});

// --- AC3: deauthorization is simply acknowledged (no compliance callback) ----

test('AC3: app_deauthorized is acknowledged 200 (the purge is a no-op)', async () => {
  const server = await startApp();
  try {
    const res = await postEvent(server.address().port, DEAUTH_EVENT);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'OK');
  } finally {
    server.close();
  }
});

test('AC3: an unknown but signature-valid event is acknowledged too', async () => {
  const server = await startApp();
  try {
    const res = await postEvent(server.address().port, { event: 'meeting.started', payload: {} });
    assert.equal(res.status, 200);
  } finally {
    server.close();
  }
});

// --- AC5: inert when unconfigured -------------------------------------------

test('AC5: with no secret token the endpoint is 503', async () => {
  const server = await startApp({ secretToken: undefined });
  try {
    const res = await postEvent(server.address().port, DEAUTH_EVENT);
    assert.equal(res.status, 503);
  } finally {
    server.close();
  }
});

test('AC5: /api/health is unaffected when the webhook is unconfigured', async () => {
  const server = await startApp({ secretToken: undefined });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
  } finally {
    server.close();
  }
});

// --- AC10: rate limiting (DoS guard) ----------------------------------------

test('AC10: requests past the ceiling get 429', async () => {
  const server = await startApp({ rateLimitOptions: { windowMs: 60_000, limit: 2 } });
  try {
    const p = server.address().port;
    assert.equal((await postEvent(p, DEAUTH_EVENT)).status, 200);
    assert.equal((await postEvent(p, DEAUTH_EVENT)).status, 200);
    assert.equal((await postEvent(p, DEAUTH_EVENT)).status, 429, '3rd request over limit=2 is 429');
  } finally {
    server.close();
  }
});

test('AC10: the limiter caps even signature-rejected floods (pre-auth)', async () => {
  const server = await startApp({ rateLimitOptions: { windowMs: 60_000, limit: 2 } });
  try {
    const p = server.address().port;
    // Unsigned garbage still counts against the ceiling — the guard is before verification.
    assert.equal((await postEvent(p, DEAUTH_EVENT, { omitSig: true })).status, 401);
    assert.equal((await postEvent(p, DEAUTH_EVENT, { omitSig: true })).status, 401);
    assert.equal((await postEvent(p, DEAUTH_EVENT, { omitSig: true })).status, 429);
  } finally {
    server.close();
  }
});

// --- AC6: no secret leakage -------------------------------------------------

test('AC6: no secret token or signature value is logged', async () => {
  const server = await startApp();
  const lines = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try {
    await postEvent(server.address().port, DEAUTH_EVENT);
    const all = lines.join('\n');
    assert.ok(!all.includes(SECRET), 'the webhook secret token must never be logged');
    assert.ok(!/v0=[0-9a-f]{64}/.test(all), 'the signature must never be logged');
  } finally {
    console.log = origLog;
    console.error = origErr;
    server.close();
  }
});
