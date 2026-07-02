import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { encryptAppContextForTest } from '../src/zoom/appContext.js';

// The identity gate (requireIdentity) must LOG WHY it rejects an app context, so a
// production 401 on /api/rates is diagnosable (decrypt failed / aud mismatch / …).
// The reason goes to stderr only — never the raw context blob or the secret, and the
// client still sees an opaque 401. (Story: app-context-diagnostics.)

const SECRET = 'identity-log-secret';
const CLIENT_ID = 'identity-log-app';
const saved = {};

before(() => {
  for (const k of ['ZOOM_CLIENT_SECRET', 'ZOOM_CLIENT_ID', 'RATE_STORE_KEY']) saved[k] = process.env[k];
  process.env.ZOOM_CLIENT_SECRET = SECRET;
  process.env.ZOOM_CLIENT_ID = CLIENT_ID;
  process.env.RATE_STORE_KEY = 'identity-log-master-key';
});

after(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function start() {
  const server = createApp().listen(0);
  return new Promise((resolve) => server.once('listening', () => resolve(server)));
}

// Capture console.error for the duration of `fn`, restoring it afterward.
async function captureStderr(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return lines;
}

test('AC1/AC2/AC3: a malformed context logs a reason to stderr, not the blob, and still 401s', async () => {
  const server = await start();
  const blob = 'MALFORMED_CONTEXT_SENTINEL_abc123';
  try {
    let res;
    const lines = await captureStderr(async () => {
      res = await fetch(`http://127.0.0.1:${server.address().port}/api/rates`, {
        method: 'PUT',
        headers: { 'x-zoom-app-context': blob, 'content-type': 'application/json' },
        body: JSON.stringify({ rateTable: [], aliases: [], defaultRate: 0 }),
      });
    });

    // AC3: response unchanged — opaque 401, reason not exposed to the client.
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'invalid-app-context' });

    // AC1: exactly one [server] reason line, carrying a decrypt-failure reason.
    const reasonLines = lines.filter((l) => l.startsWith('[server] app-context rejected:'));
    assert.equal(reasonLines.length, 1, 'expected one app-context-rejected log line');
    assert.match(reasonLines[0], /decrypt failed/);

    // AC2: the raw context blob never appears in any logged line.
    assert.ok(!lines.some((l) => l.includes(blob)), 'context blob must never be logged');
  } finally {
    server.close();
  }
});

test('AC1: the logged reason is specific — a valid blob with a wrong aud logs "aud mismatch"', async () => {
  const server = await start();
  // Decrypts cleanly (correct SECRET) but aud is another app → resolveUid throws "aud mismatch".
  const blob = encryptAppContextForTest(
    { iss: 'marketplace.zoom.us', aud: 'some-other-app', uid: 'u1', exp: Math.floor(Date.now() / 1000) + 600 },
    SECRET
  );
  try {
    const lines = await captureStderr(async () => {
      await fetch(`http://127.0.0.1:${server.address().port}/api/rates`, {
        headers: { 'x-zoom-app-context': blob },
      });
    });
    const reasonLines = lines.filter((l) => l.startsWith('[server] app-context rejected:'));
    assert.equal(reasonLines.length, 1);
    assert.match(reasonLines[0], /aud mismatch/);
    assert.ok(!lines.some((l) => l.includes(blob)), 'context blob must never be logged');
  } finally {
    server.close();
  }
});

test('AC4: the 503 identity-unconfigured path emits no reason log', async () => {
  const prevId = process.env.ZOOM_CLIENT_ID;
  const prevSecret = process.env.ZOOM_CLIENT_SECRET;
  delete process.env.ZOOM_CLIENT_ID;
  delete process.env.ZOOM_CLIENT_SECRET;
  const server = await start();
  try {
    let res;
    const lines = await captureStderr(async () => {
      res = await fetch(`http://127.0.0.1:${server.address().port}/api/rates`, {
        headers: { 'x-zoom-app-context': 'anything' },
      });
    });
    assert.equal(res.status, 503);
    assert.ok(
      !lines.some((l) => l.startsWith('[server] app-context rejected:')),
      'the config-absent 503 path must not emit a reason log'
    );
  } finally {
    server.close();
    process.env.ZOOM_CLIENT_ID = prevId;
    process.env.ZOOM_CLIENT_SECRET = prevSecret;
  }
});
