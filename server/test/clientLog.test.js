import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';

// /api/log routes by payload kind: benign diagnostics → stdout (console.log),
// genuine client errors (kind 'client-error') → stderr (console.error). Output is
// a single compact line. See reviews/quiet-server-logs.md.

function startApp() {
  const app = createApp();
  const server = app.listen(0);
  return new Promise((resolve) => server.once('listening', () => resolve(server)));
}

async function postLog(port, body) {
  const out = [];
  const err = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, out, err };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

test('AC1: a diagnostic payload logs to stdout, not stderr (204)', async () => {
  const server = await startApp();
  const { port } = server.address();
  try {
    const { status, out, err } = await postLog(port, {
      kind: 'lifecycle',
      event: 'boot',
      instanceId: 'i_test',
    });
    assert.equal(status, 204);
    const outJoined = out.join('\n');
    assert.ok(outJoined.includes('[client-log]'), 'diagnostic should be on stdout');
    assert.ok(outJoined.includes('"event":"boot"'), 'payload should be present');
    assert.ok(
      !err.join('\n').includes('[client-log]'),
      'diagnostic must NOT be on stderr'
    );
  } finally {
    server.close();
  }
});

test('AC1: a client-error payload logs to stderr', async () => {
  const server = await startApp();
  const { port } = server.address();
  try {
    const { status, out, err } = await postLog(port, {
      kind: 'client-error',
      message: 'boom',
    });
    assert.equal(status, 204);
    assert.ok(err.join('\n').includes('[client-log]'), 'error should be on stderr');
    assert.ok(
      !out.join('\n').includes('[client-log]'),
      'error must NOT be on stdout'
    );
  } finally {
    server.close();
  }
});

test('AC2: the client-log line is single-line (no pretty-print newlines)', async () => {
  const server = await startApp();
  const { port } = server.address();
  try {
    const { out } = await postLog(port, {
      kind: 'lifecycle',
      event: 'overlay-message',
      keys: ['attendees', 'costPerSecond', 'status'],
    });
    const line = out.find((l) => l.includes('[client-log]'));
    assert.ok(line, 'expected a client-log line');
    assert.ok(!line.includes('\n'), 'client-log line must be single-line JSON');
  } finally {
    server.close();
  }
});
