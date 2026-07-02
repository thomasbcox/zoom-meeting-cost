import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';

// /api/version reports the build stamp (env + deployed commit + server boot time) so you
// can tell dev from prod from a browser, no Zoom needed. Public, non-sensitive.

const saved = {};

before(() => {
  for (const k of ['RAILWAY_ENVIRONMENT_NAME', 'RAILWAY_GIT_COMMIT_SHA']) saved[k] = process.env[k];
});
after(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function startApp() {
  const server = createApp().listen(0);
  return new Promise((resolve) => server.once('listening', () => resolve(server)));
}

test('GET /api/version echoes RAILWAY_ENVIRONMENT_NAME + RAILWAY_GIT_COMMIT_SHA when set', async () => {
  process.env.RAILWAY_ENVIRONMENT_NAME = 'production';
  process.env.RAILWAY_GIT_COMMIT_SHA = 'abcdef1234567890';
  const server = await startApp();
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/version`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.env, 'production');
    assert.equal(body.commit, 'abcdef1234567890'); // full SHA, not shortened
    assert.equal(typeof body.startedAt, 'string');
    assert.ok(!Number.isNaN(Date.parse(body.startedAt)), 'startedAt is an ISO timestamp');
  } finally {
    server.close();
  }
});

test('GET /api/version falls back to local/unknown when the Railway vars are unset', async () => {
  delete process.env.RAILWAY_ENVIRONMENT_NAME;
  delete process.env.RAILWAY_GIT_COMMIT_SHA;
  const server = await startApp();
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/version`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.env, 'local');
    assert.equal(body.commit, 'unknown');
  } finally {
    server.close();
  }
});
