import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';

// createApp() reads no .env, so this exercises the "no env file present" path
// (what Railway sees — config injected as env vars, no committed .env).

function startApp() {
  const app = createApp();
  const server = app.listen(0);
  return new Promise((resolve) => server.once('listening', () => resolve(server)));
}

test('GET /api/health returns 200 {ok:true} with no .env / no rooms field', async () => {
  const server = await startApp();
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal('rooms' in body, false, 'health must not reference rooms after WS removal');
  } finally {
    server.close();
  }
});

test('railway.json declares build, start, and the health-check path', () => {
  const url = new URL('../../railway.json', import.meta.url);
  const cfg = JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
  assert.equal(cfg.build.buildCommand, 'npm run build');
  assert.equal(cfg.deploy.startCommand, 'npm start');
  assert.equal(cfg.deploy.healthcheckPath, '/api/health');
});
