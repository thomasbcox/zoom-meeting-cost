import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createApp } from '../src/app.js';
import { encryptAppContextForTest } from '../src/zoom/appContext.js';

const SECRET = 'rates-endpoint-secret';
const CLIENT_ID = 'rates-app';
let dir;
const saved = {};

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rates-api-'));
  for (const k of ['DATA_DIR', 'RATE_STORE_KEY', 'ZOOM_CLIENT_SECRET', 'ZOOM_CLIENT_ID']) saved[k] = process.env[k];
  process.env.DATA_DIR = dir;
  process.env.RATE_STORE_KEY = 'rates-endpoint-master-key';
  process.env.ZOOM_CLIENT_SECRET = SECRET;
  process.env.ZOOM_CLIENT_ID = CLIENT_ID;
});

after(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fs.rm(dir, { recursive: true, force: true });
});

function start() {
  const server = createApp().listen(0);
  return new Promise((resolve) => server.once('listening', () => resolve(server)));
}

function validContext() {
  return encryptAppContextForTest(
    { iss: 'marketplace.zoom.us', aud: CLIENT_ID, uid: 'endpoint-uid', exp: Math.floor(Date.now() / 1000) + 600 },
    SECRET
  );
}

test('GET /api/rates without an app context is 401', async () => {
  const server = await start();
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/rates`);
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('GET → defaults, then PUT → GET round-trips for the authenticated presenter', async () => {
  const server = await start();
  const base = `http://127.0.0.1:${server.address().port}/api/rates`;
  const headers = { 'x-zoom-app-context': validContext(), 'content-type': 'application/json' };
  try {
    const empty = await (await fetch(base, { headers })).json();
    assert.equal(empty, null); // no stored config yet → null; client uses its defaults

    // New client omits the removed loaded-cost multiplier — PUT must still succeed.
    const cfg = { rateTable: [{ id: 'r1', name: 'Jane', rate: 95 }], aliases: [], defaultRate: 125, costModel: 'perParticipant' };
    const putRes = await fetch(base, { method: 'PUT', headers, body: JSON.stringify(cfg) });
    assert.equal(putRes.status, 200);

    const got = await (await fetch(base, { headers })).json();
    assert.deepEqual(got, cfg);

    // A non-object body is rejected.
    const bad = await fetch(base, { method: 'PUT', headers, body: JSON.stringify('nope') });
    assert.equal(bad.status, 400);

    // A malformed config (rateTable not an array) is rejected before persisting.
    const malformed = await fetch(base, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ rateTable: 'oops', aliases: [], defaultRate: 0 }),
    });
    assert.equal(malformed.status, 400);
  } finally {
    server.close();
  }
});

test('GET /api/rates is 503 when RATE_STORE_KEY is unset (fail closed)', async () => {
  const prev = process.env.RATE_STORE_KEY;
  delete process.env.RATE_STORE_KEY;
  const server = await start();
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/rates`, {
      headers: { 'x-zoom-app-context': validContext() },
    });
    assert.equal(res.status, 503);
  } finally {
    server.close();
    process.env.RATE_STORE_KEY = prev;
  }
});

test('GET /api/rates is 503 when ZOOM_CLIENT_ID is unset (no aud-bypass)', async () => {
  const prev = process.env.ZOOM_CLIENT_ID;
  delete process.env.ZOOM_CLIENT_ID;
  const server = await start();
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/rates`, {
      headers: { 'x-zoom-app-context': validContext() },
    });
    assert.equal(res.status, 503);
  } finally {
    server.close();
    process.env.ZOOM_CLIENT_ID = prev;
  }
});
