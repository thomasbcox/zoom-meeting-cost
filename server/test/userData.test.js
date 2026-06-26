import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createApp } from '../src/app.js';
import * as userData from '../src/userData.js';
import * as rateStore from '../src/store/rateStore.js';
import { encryptAppContextForTest } from '../src/zoom/appContext.js';

// Data-rights registry (userData.js) + the account-scoped /api/me endpoints. The registry is the
// single enumeration point across per-user stores; today the only adapter is the rate store.

const SECRET = 'userdata-endpoint-secret';
const CLIENT_ID = 'userdata-app';
let dir;
const saved = {};

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'userdata-'));
  for (const k of ['DATA_DIR', 'RATE_STORE_KEY', 'ZOOM_CLIENT_SECRET', 'ZOOM_CLIENT_ID']) saved[k] = process.env[k];
  process.env.DATA_DIR = dir;
  process.env.RATE_STORE_KEY = 'userdata-master-key';
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

const cfg = (name) => ({ rateTable: [{ id: 'r1', name, rate: 95 }], aliases: [], defaultRate: 125 });

function start() {
  const server = createApp().listen(0);
  return new Promise((resolve) => server.once('listening', () => resolve(server)));
}

function ctx(uid) {
  return encryptAppContextForTest(
    { iss: 'marketplace.zoom.us', aud: CLIENT_ID, uid, exp: Math.floor(Date.now() / 1000) + 600 },
    SECRET
  );
}

// --- Registry primitives ----------------------------------------------------

test('exportUser gathers all uid-scoped data; purgeUser removes it and is idempotent', async () => {
  await rateStore.save('reg-1', cfg('Jane'));
  assert.deepEqual(await userData.exportUser('reg-1'), { rates: cfg('Jane') });

  const stores = await userData.purgeUser('reg-1');
  assert.deepEqual(stores, ['rates']); // covered store keys returned for logging/confirmation
  assert.equal(await rateStore.load('reg-1'), null);
  assert.deepEqual(await userData.exportUser('reg-1'), { rates: null });

  // Second purge with nothing stored must not throw.
  await assert.doesNotReject(userData.purgeUser('reg-1'));
});

test('exportUser on an unknown uid returns nulls, never throws', async () => {
  assert.deepEqual(await userData.exportUser('reg-unknown'), { rates: null });
});

test('purging one uid never touches another uid', async () => {
  await rateStore.save('reg-a', cfg('A'));
  await rateStore.save('reg-b', cfg('B'));
  await userData.purgeUser('reg-a');
  assert.equal(await rateStore.load('reg-a'), null);
  assert.deepEqual(await rateStore.load('reg-b'), cfg('B')); // untouched
});

// --- Endpoints --------------------------------------------------------------

test('DELETE /api/me/data purges, is idempotent, and 401s without a context', async () => {
  const server = await start();
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'x-zoom-app-context': ctx('me-del'), 'content-type': 'application/json' };
  try {
    await rateStore.save('me-del', cfg('Del'));

    const res = await fetch(`${base}/api/me/data`, { method: 'DELETE', headers });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { deleted: true, stores: ['rates'] });
    assert.equal(await rateStore.load('me-del'), null);

    // Idempotent: a second delete still 200s.
    const again = await fetch(`${base}/api/me/data`, { method: 'DELETE', headers });
    assert.equal(again.status, 200);

    // No context → 401.
    const noctx = await fetch(`${base}/api/me/data`, { method: 'DELETE' });
    assert.equal(noctx.status, 401);
  } finally {
    server.close();
  }
});

test('DELETE /api/me/data succeeds even when RATE_STORE_KEY is unset (crypto-independent)', async () => {
  await rateStore.save('me-nokey', cfg('NoKey'));
  const prev = process.env.RATE_STORE_KEY;
  delete process.env.RATE_STORE_KEY;
  const server = await start();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/me/data`, {
      method: 'DELETE',
      headers: { 'x-zoom-app-context': ctx('me-nokey') },
    });
    assert.equal(res.status, 200, 'delete must work without the rate-blob crypto key');
  } finally {
    server.close();
    process.env.RATE_STORE_KEY = prev;
  }
});

test('DELETE /api/me/data is 503 only when Zoom identity config is absent', async () => {
  const prev = process.env.ZOOM_CLIENT_ID;
  delete process.env.ZOOM_CLIENT_ID;
  const server = await start();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/me/data`, {
      method: 'DELETE',
      headers: { 'x-zoom-app-context': ctx('me-id') },
    });
    assert.equal(res.status, 503);
  } finally {
    server.close();
    process.env.ZOOM_CLIENT_ID = prev;
  }
});

test('GET /api/me/export returns the data as a download; 401 without context, 503 without key', async () => {
  const server = await start();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await rateStore.save('me-exp', cfg('Exp'));
    const res = await fetch(`${base}/api/me/export`, { headers: { 'x-zoom-app-context': ctx('me-exp') } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition') || '', /attachment/);
    const body = await res.json();
    assert.deepEqual(body.data, { rates: cfg('Exp') });
    assert.ok(typeof body.exportedAt === 'string');

    // No context → 401.
    const noctx = await fetch(`${base}/api/me/export`);
    assert.equal(noctx.status, 401);
  } finally {
    server.close();
  }
});

test('GET /api/me/export is 503 when RATE_STORE_KEY is unset (decrypt needed)', async () => {
  const prev = process.env.RATE_STORE_KEY;
  delete process.env.RATE_STORE_KEY;
  const server = await start();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/me/export`, { headers: { 'x-zoom-app-context': ctx('me-exp2') } });
    assert.equal(res.status, 503);
  } finally {
    server.close();
    process.env.RATE_STORE_KEY = prev;
  }
});
