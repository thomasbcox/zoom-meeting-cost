import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { createApp } from '../src/app.js';

// The Zoom deauthorization / data-compliance webhook (reviews/deauth-endpoint.md).
//
// All credential values here are SYNTHETIC, low-entropy, obviously-fake fixtures — never a
// real Zoom secret (see the repo's secret-scan guardrails).

const SECRET = 'fake-webhook-token-for-tests';
const CLIENT_ID = 'fake-client-id';
const CLIENT_SECRET = 'fake-client-secret';

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

// A stub fetch that records calls, so no global is mutated.
function stubFetch(impl) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    if (typeof impl === 'function') return impl(url, opts);
    return { ok: true, status: 200 };
  };
  fn.calls = calls;
  return fn;
}

function startApp(deauth = {}) {
  const app = createApp({
    deauth: {
      secretToken: SECRET,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      now: () => NOW_MS,
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
    client_id: CLIENT_ID,
    user_data_retention: 'false',
    deauthorization_time: '2026-07-15T00:00:00Z',
  },
};

// --- AC1: signature gate is total and non-throwing --------------------------

test('AC1: a correctly-signed event is accepted (not 401/500)', async () => {
  const fetchImpl = stubFetch();
  const server = await startApp({ fetchImpl });
  try {
    const res = await postEvent(server.address().port, DEAUTH_EVENT);
    assert.equal(res.status, 200);
  } finally {
    server.close();
  }
});

test('AC1: a wrong signature is 401 and does NOT call the compliance callback', async () => {
  const fetchImpl = stubFetch();
  const server = await startApp({ fetchImpl });
  try {
    const res = await postEvent(server.address().port, DEAUTH_EVENT, {
      secret: 'some-other-token',
    });
    assert.equal(res.status, 401);
    assert.equal(fetchImpl.calls.length, 0, 'must not call Zoom on a bad signature');
  } finally {
    server.close();
  }
});

test('AC1: a missing signature header is 401', async () => {
  const server = await startApp({ fetchImpl: stubFetch() });
  try {
    const res = await postEvent(server.address().port, DEAUTH_EVENT, { omitSig: true });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('AC1: a tampered body is 401 (signature no longer matches)', async () => {
  const fetchImpl = stubFetch();
  const server = await startApp({ fetchImpl });
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
    assert.equal(fetchImpl.calls.length, 0);
  } finally {
    server.close();
  }
});

// The BLOCKER from the design review: a malformed signature must never reach
// timingSafeEqual with a mismatched length (which throws → 500).
test('AC1: malformed signatures are 401, never 500', async () => {
  const server = await startApp({ fetchImpl: stubFetch() });
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
  const server = await startApp({ fetchImpl: stubFetch() });
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
  const server = await startApp({ fetchImpl: stubFetch() });
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
  const server = await startApp({ fetchImpl: stubFetch() });
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
  const server = await startApp({ fetchImpl: stubFetch() });
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
  const server = await startApp({ fetchImpl: stubFetch() });
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

// --- AC3: deauthorization → bounded compliance callback ---------------------

test('AC3: app_deauthorized posts the compliance confirmation and returns 200', async () => {
  const fetchImpl = stubFetch();
  const server = await startApp({ fetchImpl });
  try {
    const res = await postEvent(server.address().port, DEAUTH_EVENT);
    assert.equal(res.status, 200);
    assert.equal(fetchImpl.calls.length, 1, 'exactly one compliance callback');

    const { url, opts } = fetchImpl.calls[0];
    assert.equal(url, 'https://api.zoom.us/oauth/data/compliance');
    assert.equal(opts.method, 'POST');
    assert.equal(
      opts.headers.Authorization,
      `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`
    );
    const sent = JSON.parse(opts.body);
    assert.equal(sent.compliance_completed, true);
    assert.equal(sent.client_id, CLIENT_ID);
    assert.equal(sent.user_id, 'user_1');
    assert.equal(sent.account_id, 'acct_1');
    assert.deepEqual(sent.deauthorization_event_received, DEAUTH_EVENT.payload);
    // Bounded by a deadline so we answer inside Zoom's ~3 s webhook window.
    assert.ok(opts.signal, 'compliance callback must carry an AbortSignal timeout');
  } finally {
    server.close();
  }
});

test('AC3: a non-2xx from Zoom is 500 (so Zoom retries)', async () => {
  const fetchImpl = stubFetch(async () => ({ ok: false, status: 429 }));
  const server = await startApp({ fetchImpl });
  const errs = [];
  const origErr = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  try {
    const res = await postEvent(server.address().port, DEAUTH_EVENT);
    assert.equal(res.status, 500);
  } finally {
    console.error = origErr;
    server.close();
  }
});

test('AC3: a network/timeout failure is 500 (so Zoom retries)', async () => {
  const fetchImpl = stubFetch(async () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  });
  const server = await startApp({ fetchImpl });
  const errs = [];
  const origErr = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  try {
    const res = await postEvent(server.address().port, DEAUTH_EVENT);
    assert.equal(res.status, 500);
    assert.ok(
      errs.join('\n').includes('AbortError'),
      'the timeout should be logged by name for diagnosis'
    );
  } finally {
    console.error = origErr;
    server.close();
  }
});

test('AC3: an unknown but signature-valid event is acknowledged without a callback', async () => {
  const fetchImpl = stubFetch();
  const server = await startApp({ fetchImpl });
  try {
    const res = await postEvent(server.address().port, { event: 'meeting.started', payload: {} });
    assert.equal(res.status, 200);
    assert.equal(fetchImpl.calls.length, 0);
  } finally {
    server.close();
  }
});

// --- AC5: inert when unconfigured (per credential) --------------------------

test('AC5: with no secret token the endpoint is 503 and calls nothing', async () => {
  const fetchImpl = stubFetch();
  const server = await startApp({ secretToken: undefined, fetchImpl });
  try {
    const res = await postEvent(server.address().port, DEAUTH_EVENT);
    assert.equal(res.status, 503);
    assert.equal(fetchImpl.calls.length, 0);
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

test('AC5: without OAuth creds, url_validation still works but deauth 503s before calling', async () => {
  const fetchImpl = stubFetch();
  const server = await startApp({ clientId: undefined, clientSecret: undefined, fetchImpl });
  try {
    const ok = await postEvent(server.address().port, {
      event: 'endpoint.url_validation',
      payload: { plainToken: 'p1' },
    });
    assert.equal(ok.status, 200, 'url_validation needs only the secret token');

    const res = await postEvent(server.address().port, DEAUTH_EVENT);
    assert.equal(res.status, 503);
    assert.equal(fetchImpl.calls.length, 0, 'never send Basic undefined:undefined');
  } finally {
    server.close();
  }
});

// --- AC6: no secret leakage -------------------------------------------------

test('AC6: no secret, token, or signature value is logged', async () => {
  const fetchImpl = stubFetch(async () => ({ ok: false, status: 500 }));
  const server = await startApp({ fetchImpl });
  const lines = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try {
    await postEvent(server.address().port, DEAUTH_EVENT);
    const all = lines.join('\n');
    assert.ok(!all.includes(SECRET), 'the webhook secret token must never be logged');
    assert.ok(!all.includes(CLIENT_SECRET), 'the client secret must never be logged');
    assert.ok(!all.includes('Basic '), 'the Basic auth header must never be logged');
    assert.ok(!/v0=[0-9a-f]{64}/.test(all), 'the signature must never be logged');
  } finally {
    console.log = origLog;
    console.error = origErr;
    server.close();
  }
});
